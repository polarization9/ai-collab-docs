import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { enablePatches, Immer } from "immer";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
enablePatches();
const patches = new Immer({ autoFreeze: false });

type DesktopTurn = { turnId: string; status: string; error?: { message?: string } };
type DesktopState = {
  turns?: DesktopTurn[];
  threadRuntimeStatus?: { type: string };
  turnHistory?: { kind: string; history?: { entitiesByKey?: Record<string, DesktopTurn> } };
};

type IpcResponse = {
  type: "response";
  requestId: string;
  resultType: "success" | "error";
  handledByClientId?: string;
  result?: Record<string, unknown>;
  error?: string;
};

// Only the desktop owner has authoritative live state. Reading persisted turns
// from another app-server can report a still-running turn as interrupted.
export class CodexDesktopClient {
  private buffer = Buffer.alloc(0);
  private clientId?: string;
  private ownerId?: string;
  private threadId?: string;
  private state?: DesktopState;
  private revision?: number;
  private failure?: Error;
  private snapshotWaiter?: { resolve: () => void; reject: (error: Error) => void };
  private readonly pending = new Map<string, {
    resolve: (response: IpcResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("Codex Desktop connection closed.")));
  }

  static async findOwner(
    threadId: string,
    socketPath = process.platform === "win32"
      ? "\\\\.\\pipe\\codex-ipc"
      : path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "ipc", "ipc.sock")
  ): Promise<CodexDesktopClient | null> {
    const socket = net.createConnection(socketPath);
    const client = new CodexDesktopClient(socket);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error("Timed out connecting to Codex Desktop."));
        }, 5_000);
        socket.once("connect", () => { clearTimeout(timeout); resolve(); });
        socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
      });
      const initialized = await client.request("initialize", { clientType: "margent" }, 0);
      client.clientId = initialized.result?.clientId as string | undefined;
      if (!client.clientId) throw new Error("Codex Desktop returned no IPC client ID.");
      const owner = await client.request("thread-owner-discovery", {
        hostId: "local",
        conversationId: threadId
      }, 1, 10_000);
      if (owner.resultType === "error" && owner.error === "no-client-found") {
        client.close();
        return null;
      }
      if (owner.resultType !== "success" || !owner.handledByClientId) {
        throw new Error(`Codex Desktop owner discovery failed: ${owner.error ?? "invalid response"}`);
      }
      client.ownerId = owner.handledByClientId;
      return client;
    } catch (error) {
      client.close();
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ECONNREFUSED") return null;
      throw error;
    }
  }

  async observe(threadId: string): Promise<void> {
    this.assertConnected();
    this.threadId = threadId;
    let timer: NodeJS.Timeout | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        this.snapshotWaiter = { resolve, reject };
        timer = setTimeout(() => reject(new Error("Codex Desktop did not provide live conversation state. No task was sent.")), 10_000);
        this.follow(true);
      });
    } finally {
      clearTimeout(timer);
      this.snapshotWaiter = undefined;
    }
  }

  isBusy(): boolean {
    this.assertConnected();
    if (!this.state) throw new Error("Codex Desktop live state is not ready.");
    return this.state.threadRuntimeStatus?.type === "active" || this.turns().some(turn => turn.status === "inProgress");
  }

  getTurn(turnId: string): DesktopTurn | undefined {
    this.assertConnected();
    return this.turns().find(turn => turn.turnId === turnId);
  }

  private turns(): DesktopTurn[] {
    if (this.state?.turnHistory?.kind === "canonical") {
      return Object.values(this.state.turnHistory.history?.entitiesByKey ?? {})
        .filter(turn => typeof turn.turnId === "string" && typeof turn.status === "string");
    }
    return this.state?.turns ?? [];
  }

  private follow(following: boolean): void {
    this.write({ type: "broadcast", sourceClientId: this.clientId, targetClientIds: [this.ownerId],
      method: "thread-stream-following-changed", version: 1,
      params: { conversationId: this.threadId, hostId: "local", following } });
  }

  private assertConnected(): void {
    if (this.failure) throw this.failure;
    if (this.socket.destroyed) throw new Error("Codex Desktop connection closed.");
  }

  async startTurn(threadId: string, prompt: string, clientUserMessageId: string): Promise<string> {
    this.assertConnected();
    const response = await this.request("thread-follower-start-turn", {
      conversationId: threadId,
      turnStart: {
        request: {
          threadId,
          input: [{ type: "text", text: prompt, text_elements: [] }],
          clientUserMessageId
        },
        context: { inheritThreadSettings: true }
      }
    }, 2);
    if (response.resultType !== "success") {
      throw new Error(`Codex Desktop delivery failed: ${response.error ?? "unknown error"}`);
    }
    const result = response.result?.result as { turn?: { id?: string } } | undefined;
    if (!result?.turn?.id) {
      // Do not fall back or resend: the owner might already have accepted the input.
      throw new Error("Codex Desktop accepted the request without a turn ID. Check the target conversation before retrying.");
    }
    return result.turn.id;
  }

  close(): void {
    if (!this.socket.destroyed) {
      if (this.threadId) this.follow(false);
      this.socket.destroySoon();
    }
    this.fail(new Error("Codex Desktop connection closed."));
  }

  private request(method: string, params: Record<string, unknown>, version: number,
    timeoutMs = REQUEST_TIMEOUT_MS): Promise<IpcResponse> {
    if (this.socket.destroyed) return Promise.reject(new Error("Codex Desktop connection closed."));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timed out waiting for Codex Desktop ${method}. Check the target conversation before retrying.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.write({ type: "request", requestId, sourceClientId: this.clientId,
        targetClientId: this.ownerId, version, method, params, timeoutMs });
    });
  }

  private write(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    this.socket.write(Buffer.concat([header, body]));
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (!length || length > MAX_FRAME_BYTES) {
        this.fail(new Error("Invalid Codex Desktop IPC frame."));
        this.socket.destroy();
        return;
      }
      if (this.buffer.length < length + 4) return;
      const body = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      try {
        const message = JSON.parse(body.toString("utf8"));
        if (message.type === "client-discovery-request") {
          this.write({ type: "client-discovery-response", requestId: message.requestId,
            response: { canHandle: false } });
        } else if (message.type === "response") {
          const pending = this.pending.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.requestId);
            pending.resolve(message);
          }
        } else if (message.type === "broadcast" && message.method === "thread-stream-state-changed"
          && message.sourceClientId === this.ownerId && message.params?.conversationId === this.threadId
          && message.params?.hostId === "local") {
          if (message.version !== 11) throw new Error("Unsupported Codex Desktop live-state protocol. Update Margent before retrying.");
          const change = message.params.change;
          if (change.type === "snapshot") {
            const state = change.conversationState as DesktopState;
            if (!state || (!Array.isArray(state.turns) && state.turnHistory?.kind !== "canonical")) {
              throw new Error("Invalid Codex Desktop conversation state.");
            }
            this.state = state;
            this.revision = change.revision;
            this.snapshotWaiter?.resolve();
          } else if (change.type === "patches") {
            if (!this.state || this.revision !== change.baseRevision) {
              throw new Error("Codex Desktop live-state stream lost synchronization. Check the target conversation before retrying.");
            }
            // Text deltas do not affect turn status; only state patches are needed here.
            this.state = patches.applyPatches(this.state, change.patches);
            this.revision = change.revision;
          }
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("Invalid Codex Desktop IPC response."));
        this.socket.destroy();
      }
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.snapshotWaiter?.reject(error);
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
}

export function cleanCodexDiagnostic(output: string): string {
  return output.replace(/\x1b\[[0-9;]*m/g, "").split("\n").flatMap((line) => {
    const text = line.trim();
    if (!text) return [];
    try {
      const record = JSON.parse(text);
      if (["TRACE", "DEBUG", "INFO", "WARN"].includes(record.level)) return [];
      return [typeof record.fields?.message === "string" ? record.fields.message : text];
    } catch {
      return /\b(?:TRACE|DEBUG|INFO|WARN)\b/.test(text) ? [] : [text];
    }
  }).join("\n");
}
