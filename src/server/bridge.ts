import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CodexTargetReference,
  CodexTargetType
} from "../shared/codexTypes.js";
import type {
  BridgeSendAnnotationResponse,
  ReviewEvent,
  ReviewFile
} from "../shared/reviewTypes.js";
import { loadCodexDocumentLink, resolveCodexTarget, updateCodexDocumentLink } from "./codexLink.js";
import {
  createReviewEvent,
  findLatestAnnotationEvent,
  findNextQueuedReviewEvent,
  getReviewEvent,
  hasActiveReviewEvent,
  loadReviewFile,
  markReviewEventDelivering,
  recoverStaleDeliveringEvents,
  updateReviewEvent
} from "./review.js";

type SendToThreadInput = {
  threadId: string;
  cwd?: string;
  documentPath: string;
  annotationId: string;
  eventId: string;
  targetType: CodexTargetType;
  prompt: string;
  onTurnStarted?: (delivery: {
    threadId: string;
    turnId?: string;
    deliveryId: string;
  }) => Promise<void>;
};

type SendToThreadResult = {
  ok: boolean;
  threadId?: string;
  turnId?: string;
  deliveryId?: string;
  error?: string;
};

type CodexBridgeAdapter = {
  name: NonNullable<ReviewEvent["delivery"]>["adapter"];
  isAvailable(): Promise<boolean>;
  sendToThread(input: SendToThreadInput): Promise<SendToThreadResult>;
};

const APP_SERVER_REQUEST_TIMEOUT_MS = 60000;
const APP_SERVER_TURN_TIMEOUT_MS = getTurnTimeoutMs();

const bridgeAdapters: CodexBridgeAdapter[] = [
  createCodexAppServerAdapter()
];

const OPEN_EVENT_STATUSES = new Set<ReviewEvent["deliveryStatus"]>([
  "queued",
  "delivering",
  "sent",
  "processing"
]);

export async function sendAnnotationToCodex(
  markdownPath: string,
  annotationId: string
): Promise<BridgeSendAnnotationResponse> {
  const target = await getCurrentTarget(markdownPath);
  if (!target?.threadId) {
    return {
      ok: false,
      review: await loadReviewFile(markdownPath),
      needsBinding: true,
      error: "No Codex target thread is bound for this document."
    };
  }

  const latestEvent = await findLatestAnnotationEvent(markdownPath, annotationId);
  let review: ReviewFile;
  let event: ReviewEvent;

  if (latestEvent && OPEN_EVENT_STATUSES.has(latestEvent.deliveryStatus)) {
    event = latestEvent;
    review = await loadReviewFile(markdownPath);
  } else if (latestEvent?.deliveryStatus === "failed") {
    review = await updateReviewEvent(markdownPath, latestEvent.id, {
      deliveryStatus: "queued",
      lastError: undefined
    });
    event = getEventFromReview(review, latestEvent.id);
  } else {
    review = await createReviewEvent(markdownPath, {
      annotationId,
      deliveryMode: "manual"
    });
    event = review.events?.[review.events.length - 1] as ReviewEvent;
  }

  const dispatched = await dispatchReviewEvents(markdownPath);
  return {
    ok: dispatched.ok,
    event: dispatched.event ?? event,
    review: dispatched.review,
    needsBinding: dispatched.needsBinding,
    error: dispatched.error
  };
}

export async function retryReviewEvent(
  markdownPath: string,
  eventId: string
): Promise<BridgeSendAnnotationResponse> {
  const event = await getReviewEvent(markdownPath, eventId);
  if (event.deliveryStatus !== "failed") {
    return {
      ok: false,
      event,
      review: await loadReviewFile(markdownPath),
      error: "Only failed events can be retried."
    };
  }

  await updateReviewEvent(markdownPath, eventId, {
    deliveryStatus: "queued",
    lastError: undefined
  });
  return dispatchReviewEvents(markdownPath);
}

export async function dispatchReviewEvents(
  markdownPath: string
): Promise<BridgeSendAnnotationResponse> {
  await recoverStaleDeliveringEvents(markdownPath);

  if (await hasActiveReviewEvent(markdownPath)) {
    return {
      ok: true,
      review: await loadReviewFile(markdownPath)
    };
  }

  const queuedEvent = await findNextQueuedReviewEvent(markdownPath);
  if (!queuedEvent) {
    return {
      ok: true,
      review: await loadReviewFile(markdownPath)
    };
  }

  const target = await resolveEventTarget(markdownPath, queuedEvent);
  if (!target?.threadId) {
    const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
      deliveryStatus: "failed",
      lastError: "No Codex target thread is bound for this document."
    });
    return {
      ok: false,
      event: getEventFromReview(review, queuedEvent.id),
      review,
      needsBinding: true,
      error: "No Codex target thread is bound for this document."
    };
  }

  const adapter = await selectBridgeAdapter();
  await markReviewEventDelivering(markdownPath, queuedEvent.id, adapter?.name);

  if (!adapter) {
    const error = "No available Codex Bridge adapter is configured.";
    const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
      deliveryStatus: "failed",
      lastError: error
    });
    return {
      ok: false,
      event: getEventFromReview(review, queuedEvent.id),
      review,
      error
    };
  }

  const prompt = createBridgePrompt({
    documentPath: markdownPath,
    annotationId: queuedEvent.annotationId,
    eventId: queuedEvent.id,
    targetType: target.type,
    triggerReplyId: queuedEvent.triggerReplyId
  });
  const result = await adapter.sendToThread({
    threadId: target.threadId,
    cwd: target.cwd,
    documentPath: markdownPath,
    annotationId: queuedEvent.annotationId,
    eventId: queuedEvent.id,
    targetType: target.type,
    prompt,
    onTurnStarted: async ({ threadId, turnId, deliveryId }) => {
      const now = new Date().toISOString();
      const latestReview = await loadReviewFile(markdownPath);
      const latestEvent = getEventFromReview(latestReview, queuedEvent.id);
      if (latestEvent.deliveryStatus !== "delivering") {
        return;
      }

      await updateReviewEvent(markdownPath, queuedEvent.id, {
        deliveryStatus: "sent",
        lastError: undefined,
        delivery: {
          ...latestEvent.delivery,
          adapter: adapter.name,
          threadId,
          turnId,
          deliveryId,
          lastAttemptAt: now
        }
      });
      await updateCodexDocumentLink(markdownPath, {
        bridge: {
          lastDeliveredEventId: queuedEvent.id,
          lastDeliveryAt: now
        }
      });
    }
  });

  if (!result.ok) {
    const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
      deliveryStatus: "failed",
      lastError: result.error ?? "Codex Bridge delivery failed."
    });
    return {
      ok: false,
      event: getEventFromReview(review, queuedEvent.id),
      review,
      error: result.error
    };
  }

  const now = new Date().toISOString();
  const latestReview = await loadReviewFile(markdownPath);
  const latestEvent = getEventFromReview(latestReview, queuedEvent.id);
  const nextStatus =
    latestEvent.deliveryStatus === "delivering" ? "sent" : latestEvent.deliveryStatus;
  const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
    deliveryStatus: nextStatus,
    lastError: undefined,
    delivery: {
      ...latestEvent.delivery,
      adapter: adapter.name,
      threadId: result.threadId,
      turnId: result.turnId,
      deliveryId: result.deliveryId,
      lastAttemptAt: now
    }
  });
  await updateCodexDocumentLink(markdownPath, {
    bridge: {
      lastDeliveredEventId: queuedEvent.id,
      lastDeliveryAt: now
    }
  });
  dispatchReviewEventsInBackground(markdownPath);

  return {
    ok: true,
    event: getEventFromReview(review, queuedEvent.id),
    review
  };
}

export function dispatchReviewEventsInBackground(markdownPath: string): void {
  setTimeout(() => {
    void dispatchReviewEvents(markdownPath).catch((error) => {
      console.error(
        `[Margent] Failed to dispatch review events for ${markdownPath}:`,
        error
      );
    });
  }, 0);
}

export function createBridgePrompt(input: {
  documentPath: string;
  annotationId: string;
  eventId: string;
  targetType: CodexTargetType;
  triggerReplyId?: string;
}): string {
  const isFollowup = Boolean(input.triggerReplyId);
  const contextCall = [
    "   reviewer_get_annotation_context({",
    `     documentPath: ${JSON.stringify(input.documentPath)},`,
    input.triggerReplyId
      ? `     annotationId: ${JSON.stringify(input.annotationId)},`
      : `     annotationId: ${JSON.stringify(input.annotationId)}`,
    ...(input.triggerReplyId
      ? [`     triggerReplyId: ${JSON.stringify(input.triggerReplyId)}`]
      : []),
    "   })"
  ];
  const base = [
    isFollowup
      ? "Margent 有一条新的批注追问需要处理。"
      : "Margent 有一条新的批注任务需要处理。",
    "",
    "文档路径：",
    input.documentPath,
    "",
    "批注 ID：",
    input.annotationId,
    "",
    "事件 ID：",
    input.eventId,
    "",
    ...(input.triggerReplyId
      ? [
          "触发回复 ID：",
          input.triggerReplyId,
          ""
        ]
      : []),
    "目标会话类型：",
    input.targetType,
    "",
    "请按以下步骤处理：",
    "",
    "0. 如果当前工具列表里没有 Margent / reviewer 相关工具，先用工具发现能力搜索：",
    "   - 搜索关键词：reviewer_get_annotation_context Margent annotations",
    "   - 目标是加载 Margent MCP 的批注读取、回复、文档编辑和事件标记工具。",
    "",
    "1. 调用 Margent MCP 读取这条批注：",
    ...contextCall,
    "",
    ...(isFollowup
      ? [
          "2. 这是用户对 Codex 回复发起的继续回复：",
          "   - context.triggerReply 是本轮任务的主要用户意图。",
          "   - 父级批注、原始选中文本、文档局部上下文和全部历史回复用于理解背景。",
          "   - 不要把父级批注当成一条新的待处理问题重复处理，除非 triggerReply 明确要求重新处理。"
        ]
      : [
          "2. 根据批注内容判断处理方式：",
          "   - 如果是提问型批注：直接回复批注。",
          "   - 如果是明确修改型批注：修改 Markdown 正文，并回复处理说明。",
          "   - 如果修改目标或意图不明确：只回复讨论或澄清问题，不擅自改正文。"
        ]),
    "",
    "3. 如果修改了正文，请保存文档，并让 Reviewer 重新标记批注锚点在修改后的文本上。",
    "   如果使用 reviewer_apply_document_edit 且这次修改已经解决批注，请传入 resolveAnnotation: true 和 eventId，让 Margent 同步 resolved 与 handled。",
    "",
    "4. 如果你已经直接回答了批注问题，或已经完成明确的正文修改，且还没有通过 reviewer_apply_document_edit(resolveAnnotation=true) 解决批注，必须调用 reviewer_update_annotation_status({",
    `   documentPath: ${JSON.stringify(input.documentPath)},`,
    `   annotationId: ${JSON.stringify(input.annotationId)},`,
    '   status: "resolved",',
    `   eventId: ${JSON.stringify(input.eventId)}`,
    "   })。",
    "   Margent 会在这次 resolved 写入中同步把本轮 event 标记为 handled，不需要再单独调用 reviewer_mark_review_event_handled。",
    "",
    "5. 只有当你保持批注 open，但本轮已经回复、澄清或说明无法处理时，才调用 reviewer_mark_review_event_handled({",
    `   documentPath: ${JSON.stringify(input.documentPath)},`,
    `   eventId: ${JSON.stringify(input.eventId)}`,
    "})。",
    "",
    "注意：",
    "- 不要要求用户把整份 Markdown 粘贴到对话里。",
    "- 需要正文或更多上下文时，通过 MCP 读取本地文档。",
    "- 如果 MCP 不可用，请回复说明无法处理，不要假装已经完成。"
  ];

  if (input.targetType === "source") {
    base.push(
      "",
      "你正在来源 Codex 会话中处理这条批注。可以使用本会话已有讨论上下文判断产品意图和修改边界。"
    );
  } else {
    base.push(
      "",
      "你正在接续对话中处理这条批注，不是原来源会话。不要假设自己拥有完整历史讨论。",
      "如果批注需要来源讨论上下文才能安全修改，请回复说明需要用户补充背景，或只做低风险修改。"
    );
  }

  return base.join("\n");
}

async function getCurrentTarget(markdownPath: string): Promise<CodexTargetReference | null> {
  const link = await loadCodexDocumentLink(markdownPath);
  return resolveCodexTarget(link);
}

export async function resolveEventTarget(
  markdownPath: string,
  event: ReviewEvent
): Promise<CodexTargetReference | null> {
  if (event.targetThreadId && event.targetType) {
    const eventCwd =
      event.targetCwd ??
      (event.targetType === "source" && event.targetThreadId === event.sourceThreadId
        ? event.sourceCwd
        : undefined);
    if (eventCwd) {
      return {
        type: event.targetType,
        threadId: event.targetThreadId,
        cwd: eventCwd
      };
    }

    const currentTarget = await getCurrentTarget(markdownPath);
    const currentCwd =
      currentTarget?.threadId === event.targetThreadId &&
      currentTarget.type === event.targetType
        ? currentTarget.cwd
        : undefined;
    return {
      type: event.targetType,
      threadId: event.targetThreadId,
      cwd: event.targetCwd ?? currentCwd
    };
  }

  return getCurrentTarget(markdownPath);
}

async function selectBridgeAdapter(): Promise<CodexBridgeAdapter | null> {
  for (const adapter of bridgeAdapters) {
    if (await adapter.isAvailable()) {
      return adapter;
    }
  }
  return null;
}

function createCodexAppServerAdapter(): CodexBridgeAdapter {
  return {
    name: "app-server",
    async isAvailable() {
      return Boolean(await resolveCodexCommand());
    },
    async sendToThread(input) {
      const command = await resolveCodexCommand();
      if (!command) {
        return {
          ok: false,
          error:
            "Codex CLI was not found. Install Codex Desktop or set CODEX_CLI_PATH."
        };
      }

      const client = new CodexAppServerClient(command, input.cwd);
      try {
        await client.start();
        await client.request("initialize", {
          clientInfo: {
            name: "margent",
            title: "Margent",
            version: "0.1.0"
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
            optOutNotificationMethods: [
              "command/exec/outputDelta",
              "item/agentMessage/delta",
              "item/plan/delta",
              "item/fileChange/outputDelta",
              "item/reasoning/summaryTextDelta",
              "item/reasoning/textDelta"
            ]
          }
        });
        client.notify("initialized");

        const resumeResult = await client.request("thread/resume", {
          threadId: input.threadId
        });
        const resumedThreadId = extractThreadId(resumeResult) ?? input.threadId;
        const turnStartResult = await client.request("turn/start", {
          threadId: input.threadId,
          input: [
            {
              type: "text",
              text: input.prompt,
              text_elements: []
            }
          ]
        });
        const turnId = extractTurnId(turnStartResult);
        const deliveryId = turnId ? `app-server:${turnId}` : `app-server:${input.eventId}`;

        await input.onTurnStarted?.({
          threadId: resumedThreadId,
          turnId,
          deliveryId
        });

        await client.waitForTurnCompleted(turnId);

        return {
          ok: true,
          threadId: resumedThreadId,
          turnId,
          deliveryId
        };
      } catch (error) {
        return {
          ok: false,
          error: client.formatError(error)
        };
      } finally {
        client.close();
      }
    }
  };
}

function getEventFromReview(review: ReviewFile, eventId: string): ReviewEvent {
  const event = review.events?.find((item) => item.id === eventId);
  if (!event) {
    throw new Error(`Review event not found after update: ${eventId}`);
  }
  return event;
}

type JsonRpcId = string;

type PendingRequest = {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

type TurnCompletionWaiter = {
  turnId?: string;
  resolve(): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrTail = "";
  private closing = false;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private completedTurns = new Set<string>();
  private turnCompletionWaiters: TurnCompletionWaiter[] = [];
  private notificationErrors: string[] = [];

  constructor(
    private readonly command: string,
    private readonly cwd?: string
  ) {}

  start(): Promise<void> {
    if (this.child) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const child = spawn(this.command, ["app-server"], {
        cwd: this.cwd ?? process.cwd(),
        stdio: ["pipe", "pipe", "pipe"]
      }) as ChildProcessWithoutNullStreams;
      this.child = child;

      let settled = false;
      const settleStart = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.handleStdout(chunk);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.appendStderr(chunk);
      });
      child.on("error", (error) => {
        settleStart(error);
        this.rejectAll(error);
      });
      child.on("spawn", () => {
        settleStart();
      });
      child.on("exit", (code, signal) => {
        if (!this.closing) {
          const reason = signal
            ? `signal ${signal}`
            : `exit code ${String(code ?? "unknown")}`;
          this.rejectAll(new Error(`Codex app-server exited unexpectedly with ${reason}.`));
        }
      });
    });
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.requireChild();
    const id = String(this.nextId++);
    const message = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server ${method}.`));
      }, APP_SERVER_REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(id, {
        method,
        resolve,
        reject,
        timeout
      });
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const child = this.requireChild();
    const message = params === undefined ? { method } : { method, params };
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  waitForTurnCompleted(turnId?: string): Promise<void> {
    if (turnId && this.completedTurns.has(turnId)) {
      return Promise.resolve();
    }
    if (!turnId && this.completedTurns.size > 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turnCompletionWaiters = this.turnCompletionWaiters.filter(
          (waiter) => waiter !== pending
        );
        reject(
          new Error(
            `Timed out waiting for Codex turn completion.${this.formatDiagnostics()}`
          )
        );
      }, APP_SERVER_TURN_TIMEOUT_MS);
      const pending: TurnCompletionWaiter = {
        turnId,
        resolve,
        reject,
        timeout
      };
      this.turnCompletionWaiters.push(pending);
    });
  }

  close(): void {
    this.closing = true;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();
    for (const waiter of this.turnCompletionWaiters) {
      clearTimeout(waiter.timeout);
    }
    this.turnCompletionWaiters = [];

    if (this.child && !this.child.killed) {
      this.child.stdin.end();
      this.child.kill();
    }
    this.child = null;
  }

  formatError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `${message}${this.formatDiagnostics()}`;
  }

  private requireChild(): NonNullable<typeof this.child> {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Codex app-server is not running.");
    }
    return this.child;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) {
      return;
    }

    const id = typeof message.id === "string" ? message.id : undefined;
    if (id && this.pendingRequests.has(id)) {
      this.handleResponse(id, message);
      return;
    }

    const method = typeof message.method === "string" ? message.method : undefined;
    if (method) {
      this.handleNotification(method, message.params);
    }
  }

  private handleResponse(id: string, message: Record<string, unknown>): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(id);
    clearTimeout(pending.timeout);

    if (message.error !== undefined) {
      pending.reject(new Error(formatJsonRpcError(message.error, pending.method)));
      return;
    }
    pending.resolve(message.result);
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "error") {
      this.notificationErrors.push(formatUnknown(params));
      this.trimNotificationErrors();
      return;
    }

    if (method !== "turn/completed") {
      return;
    }

    const turnId = extractTurnCompletionId(params);
    if (turnId) {
      this.completedTurns.add(turnId);
    }
    const completionError = extractTurnCompletionError(params);
    const matchingWaiters = this.turnCompletionWaiters.filter(
      (waiter) => !waiter.turnId || !turnId || waiter.turnId === turnId
    );
    this.turnCompletionWaiters = this.turnCompletionWaiters.filter(
      (waiter) => !matchingWaiters.includes(waiter)
    );

    for (const waiter of matchingWaiters) {
      clearTimeout(waiter.timeout);
      if (completionError) {
        waiter.reject(new Error(completionError));
      } else {
        waiter.resolve();
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    for (const waiter of this.turnCompletionWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.turnCompletionWaiters = [];
  }

  private appendStderr(chunk: string): void {
    this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000);
  }

  private trimNotificationErrors(): void {
    if (this.notificationErrors.length > 5) {
      this.notificationErrors = this.notificationErrors.slice(-5);
    }
  }

  private formatDiagnostics(): string {
    const diagnostics = [
      ...this.notificationErrors,
      this.stderrTail.trim()
    ].filter(Boolean);
    if (diagnostics.length === 0) {
      return "";
    }
    return `\n${diagnostics.join("\n").slice(0, 1200)}`;
  }
}

let cachedCodexCommand: string | null | undefined;

async function resolveCodexCommand(): Promise<string | null> {
  if (process.env.MARGENT_DISABLE_CODEX_BRIDGE === "1") {
    return null;
  }

  if (cachedCodexCommand !== undefined) {
    return cachedCodexCommand;
  }

  for (const candidate of getCodexCommandCandidates()) {
    if (await pathExists(candidate)) {
      cachedCodexCommand = candidate;
      return cachedCodexCommand;
    }
  }

  cachedCodexCommand = null;
  return cachedCodexCommand;
}

function getCodexCommandCandidates(): string[] {
  const candidates = [
    normalizeOptionalString(process.env.CODEX_CLI_PATH),
    process.platform === "darwin"
      ? "/Applications/Codex.app/Contents/Resources/codex"
      : undefined,
    ...getPathExecutableCandidates("codex")
  ];
  return candidates.filter((item): item is string => Boolean(item));
}

function getPathExecutableCandidates(command: string): string[] {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return [];
  }

  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) => path.join(directory, `${command}${extension}`))
    );
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function extractThreadId(result: unknown): string | undefined {
  if (!isRecord(result) || !isRecord(result.thread)) {
    return undefined;
  }
  return normalizeOptionalString(result.thread.id);
}

function extractTurnId(result: unknown): string | undefined {
  if (!isRecord(result) || !isRecord(result.turn)) {
    return undefined;
  }
  return normalizeOptionalString(result.turn.id);
}

function extractTurnCompletionId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const directTurnId = normalizeOptionalString(params.turnId);
  if (directTurnId) {
    return directTurnId;
  }
  if (isRecord(params.turn)) {
    return normalizeOptionalString(params.turn.id);
  }
  return undefined;
}

function extractTurnCompletionError(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const directError = formatMaybeError(params.error);
  if (directError) {
    return directError;
  }
  if (isRecord(params.turn)) {
    return formatMaybeError(params.turn.error);
  }
  return undefined;
}

function formatJsonRpcError(error: unknown, method: string): string {
  const message = formatMaybeError(error);
  return message ?? `Codex app-server ${method} failed.`;
}

function formatMaybeError(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error)) {
    const message = normalizeOptionalString(error.message);
    if (message) {
      return message;
    }
  }
  return formatUnknown(error);
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTurnTimeoutMs(): number {
  const value = Number(process.env.MARGENT_CODEX_TURN_TIMEOUT_MS ?? 600000);
  return Number.isFinite(value) && value > 0 ? value : 600000;
}
