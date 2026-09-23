import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bindAgentSession } from "../src/server/agentLink.js";
import { createBridgePrompt, sendAnnotationToAgent } from "../src/server/bridge.js";
import { CodexDesktopClient, cleanCodexDiagnostic } from "../src/server/codexDesktopBridge.js";
import { createAnnotation, loadReviewFile, updateAnnotationStatus, updateReviewEvent } from "../src/server/review.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "margent-codex-delivery-"));
const oldEnv = { ...process.env };
const stateFile = path.join(dir, "state.json");
const logFile = path.join(dir, "rpc.jsonl");
const socketPath = path.join(dir, "ipc", "ipc.sock");
let mode: "success" | "missing-mcp" | "rejected" | "legacy" | "busy" | "resume" | "interrupted" | "disconnected" | "protocol" | "deleted" = "success";
let starts = 0;
let activePath = "";
let requests: string[] = [];
let turnId = "desktop-turn";
let asyncError: unknown;
const timers = new Set<NodeJS.Timeout>();
const sockets = new Set<net.Socket>();
const followers = new Set<net.Socket>();
let revision = 1;
let liveTurns: { id: string; status: string }[] = [];
const frame = (socket: net.Socket, message: unknown) => {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  const data = Buffer.concat([header, body]);
  socket.write(data.subarray(0, 2));
  socket.write(data.subarray(2, 17));
  socket.write(data.subarray(17));
};
const stream = (socket: net.Socket, change: unknown) => frame(socket, {
  type: "broadcast", sourceClientId: "desktop-owner", method: "thread-stream-state-changed",
  version: mode === "protocol" ? 999 : 11,
  params: { hostId: "local", conversationId: "bound-thread", change }
});
const liveState = () => {
  const turns = liveTurns.map(turn => ({ turnId: turn.id, status: turn.status }));
  return { turns: mode === "busy" ? turns : [],
    threadRuntimeStatus: { type: turns.some(t => t.status === "inProgress") ? "active" : "idle" },
    turnHistory: mode === "busy" ? { kind: "legacy" } : { kind: "canonical", history: {
      entitiesByKey: Object.fromEntries(turns.map(turn => [`turn:${turn.turnId}`, turn]))
    } }
  };
};
const setTurns = (turns: typeof liveTurns) => {
  liveTurns = turns;
  const baseRevision = revision++;
  const patches = Object.entries(liveState()).map(([key, value]) => ({ op: "replace", path: [key], value }));
  for (const socket of followers) stream(socket, { type: "patches", baseRevision, revision, patches });
};
const later = (callback: () => Promise<void>) => {
  const timer = setTimeout(() => { timers.delete(timer); void callback().catch((error) => { asyncError = error; }); }, 80);
  timers.add(timer);
};
const saveState = (turns: unknown[]) => fs.writeFile(stateFile, JSON.stringify({ turns }));
const finish = async () => {
  const review = await loadReviewFile(activePath);
  const event = review.events!.at(-1)!;
  await updateAnnotationStatus(activePath, event.annotationId, { status: "resolved", eventId: event.id });
  await saveState([{ id: turnId, status: "completed" }]);
  setTurns([{ id: turnId, status: "completed" }]);
};
const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => { sockets.delete(socket); followers.delete(socket); });
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const length = buffer.readUInt32LE(0);
      const request = JSON.parse(buffer.subarray(4, length + 4).toString());
      buffer = buffer.subarray(length + 4);
      requests.push(request.method);
      if (request.type === "broadcast") {
        if (request.method === "thread-stream-following-changed") {
          if (request.params.following) {
            followers.add(socket);
            stream(socket, { type: "snapshot", revision, conversationState: liveState() });
          } else followers.delete(socket);
        }
        continue;
      }
      let response: Record<string, unknown> = { type: "response", requestId: request.requestId,
        resultType: "success", handledByClientId: "desktop-owner" };
      if (request.method === "initialize") response.result = { clientId: "margent-client" };
      if (request.method === "thread-owner-discovery") {
        assert.equal(request.version, 1);
        response.result = {};
        if (mode === "legacy") response = { ...response, resultType: "error", error: "no-client-found" };
      }
      if (request.method === "thread-follower-start-turn") {
        starts++;
        assert.equal(request.version, 2);
        assert.equal(request.targetClientId, "desktop-owner");
        assert.equal(request.params.turnStart.context.inheritThreadSettings, true);
        assert.match(request.params.turnStart.request.input[0].text, /工具发现/);
        assert.doesNotMatch(request.params.turnStart.request.input[0].text, /后台预检已经确认|不要依赖 tool_search/);
        if (mode === "rejected") response = { ...response, resultType: "error", error: "owner-unavailable" };
        else {
          response.result = { result: { turn: { id: turnId } } };
          setTurns([{ id: turnId, status: "inProgress" }]);
          later(async () => {
            if (mode === "disconnected") socket.destroy();
            else if (mode === "deleted") {
              const { deleteAnnotation } = await import("../src/server/review.js");
              const review = await loadReviewFile(activePath);
              await deleteAnnotation(activePath, review.annotations[0].id);
            }
            else if (mode === "missing-mcp" || mode === "interrupted") setTurns([{ id: turnId, status: mode === "interrupted" ? "interrupted" : "completed" }]);
            else await finish();
          });
        }
      }
      // Exercise framing across split headers and multibyte payload boundaries.
      frame(socket, response);
    }
  });
});

try {
  await fs.mkdir(path.dirname(socketPath));
  await fs.copyFile(fileURLToPath(new URL("./fixtures/mock-codex-cli.mjs", import.meta.url)), path.join(dir, "codex"));
  await fs.chmod(path.join(dir, "codex"), 0o755);
  process.env.CODEX_HOME = dir;
  process.env.CODEX_CLI_PATH = path.join(dir, "codex");
  process.env.MARGENT_CODEX_TEST_STATE = stateFile;
  process.env.MARGENT_CODEX_TEST_LOG = logFile;
  delete process.env.MARGENT_DISABLE_CODEX_BRIDGE;
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  assert.equal(cleanCodexDiagnostic('{"level":"WARN","fields":{"message":"plugin warning"}}\n{"level":"ERROR","fields":{"message":"active writer"}}'), "active writer");
  assert.match(createBridgePrompt({ documentPath: "/test.md", annotationId: "ann", eventId: "evt", provider: "codex" }), /不要依赖 tool_search/);
  for (const nextMode of ["success", "missing-mcp", "rejected", "busy", "resume", "interrupted", "disconnected", "protocol", "deleted", "legacy"] as const) {
    mode = nextMode;
    starts = 0; requests = []; asyncError = undefined;
    activePath = path.join(dir, `${mode}.md`);
    turnId = `turn-${mode}`;
    followers.clear(); revision = 1;
    liveTurns = mode === "busy" ? [{ id: "user-turn", status: "inProgress" }] : [];
    await fs.writeFile(activePath, "# Test\n");
    await fs.writeFile(logFile, "");
    // Persisted history can disagree with the live owner; it must not determine completion.
    await saveState([{ id: turnId, status: "interrupted" }]);
    await bindAgentSession(activePath, { provider: "codex", role: "successor", sessionId: "bound-thread", cwd: dir });
    const review = await createAnnotation(activePath, { body: "Reply.", anchor: { kind: "document", headingId: null, headingText: null, selectedText: "" } });
    const annotationId = review.annotations.at(-1)!.id;
    if (mode === "busy") later(async () => { assert.equal(starts, 0); setTurns([]); });
    if (mode === "legacy") {
      const timer = setInterval(() => { void fs.readFile(logFile, "utf8").then(async text => {
        if (text.includes('"turn/start"')) { clearInterval(timer); timers.delete(timer); await finish(); }
      }).catch(error => { asyncError = error; }); }, 20);
      timers.add(timer);
    }
    if (mode === "resume") {
      const { createReviewEvent } = await import("../src/server/review.js");
      const created = await createReviewEvent(activePath, { annotationId, deliveryMode: "manual" });
      await updateReviewEvent(activePath, created.events!.at(-1)!.id, { deliveryStatus: "failed", delivery: {
        adapter: "codex-app-server", turnId, deliveryId: `codex-desktop:${turnId}`
      } });
      liveTurns = [{ id: turnId, status: "inProgress" }];
      later(finish);
    }
    const result = await sendAnnotationToAgent(activePath, annotationId);
    assert.equal(asyncError, undefined);
    const rpcLog = await fs.readFile(logFile, "utf8");
    if (mode === "legacy") assert.match(rpcLog, /"thread\/resume"/);
    else assert.equal(rpcLog, "", "Desktop delivery must not launch an independent app-server");
    if (["missing-mcp", "rejected", "interrupted", "disconnected", "protocol"].includes(mode)) {
      assert.equal(result.ok, false);
      assert.equal(result.event?.deliveryStatus, "failed");
      const errors = { "missing-mcp": /did not mark/, rejected: /owner-unavailable/, interrupted: /interrupted/, disconnected: /connection closed/, protocol: /Unsupported/ };
      assert.match(result.error!, errors[mode as keyof typeof errors]);
    } else if (mode === "deleted") {
      assert.equal(result.ok, true);
      assert.equal(result.event?.deliveryStatus, "ignored");
      assert.equal(result.review?.annotations.length, 0);
    } else {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.event?.deliveryStatus, "handled");
    }
    assert.equal(starts, ["legacy", "resume", "protocol"].includes(mode) ? 0 : 1);
  }
  assert.equal(await CodexDesktopClient.findOwner("thread", path.join(dir, "missing.sock")), null);
  console.log("codex-delivery-ok");
} finally {
  for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const key of ["CODEX_HOME", "CODEX_CLI_PATH", "MARGENT_CODEX_TEST_STATE", "MARGENT_CODEX_TEST_LOG", "MARGENT_DISABLE_CODEX_BRIDGE"]) {
    if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
  }
  await fs.rm(dir, { recursive: true, force: true });
}
