import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentProvider,
  AgentSessionReference,
  AgentSessionRole
} from "../shared/agentTypes.js";
import type {
  BridgeSendAnnotationResponse,
  ReviewEvent,
  ReviewFile
} from "../shared/reviewTypes.js";
import { loadAgentDocumentLink, resolveAgentTarget, updateAgentDocumentLink } from "./agentLink.js";
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

type SendToAgentInput = {
  provider: AgentProvider;
  sessionId?: string;
  cwd?: string;
  documentPath: string;
  annotationId: string;
  eventId: string;
  targetRole?: AgentSessionRole;
  prompt: string;
  createPrompt?: (options?: { reviewerMcpServerName?: string }) => string;
  onTurnStarted?: (delivery: {
    provider: AgentProvider;
    sessionId?: string;
    turnId?: string;
    deliveryId: string;
  }) => Promise<void>;
};

type SendToAgentResult = {
  ok: boolean;
  provider: AgentProvider;
  sessionId?: string;
  turnId?: string;
  deliveryId?: string;
  error?: string;
};

type AgentBridgeAdapter = {
  provider: AgentProvider;
  name: NonNullable<ReviewEvent["delivery"]>["adapter"];
  requiresSessionId?: boolean;
  isAvailable(): Promise<boolean>;
  send(input: SendToAgentInput): Promise<SendToAgentResult>;
};

const APP_SERVER_REQUEST_TIMEOUT_MS = 60000;
const APP_SERVER_TURN_TIMEOUT_MS = getTurnTimeoutMs();
const APP_SERVER_MCP_PREFLIGHT_TIMEOUT_MS = 20000;
const CLI_AGENT_OUTPUT_LIMIT = 96_000;
const REVIEWER_MCP_TOOL_NAMES = [
  "reviewer_get_annotation_context",
  "reviewer_add_annotation_reply",
  "reviewer_apply_document_edit",
  "reviewer_update_annotation_status",
  "reviewer_mark_review_event_handled"
];
const CODEX_REVIEWER_MCP_SERVER_CANDIDATES = ["prd_reviewer", "margent"];
const MARGENT_MCP_ALLOWED_TOOLS = [
  "mcp__margent__reviewer_get_annotation_context",
  "mcp__margent__reviewer_add_annotation_reply",
  "mcp__margent__reviewer_apply_document_edit",
  "mcp__margent__reviewer_update_annotation_status",
  "mcp__margent__reviewer_mark_review_event_handled",
  "mcp__margent__reviewer_list_review_events",
  "mcp__margent__reviewer_get_review_event",
  "mcp__margent__reviewer_bind_current_agent_session"
];

const bridgeAdapters: AgentBridgeAdapter[] = [
  createCodexAppServerAdapter(),
  createClaudeCodeCliAdapter(),
  createWorkBuddyCliAdapter()
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
  return sendAnnotationToAgent(markdownPath, annotationId);
}

export async function sendAnnotationToAgent(
  markdownPath: string,
  annotationId: string
): Promise<BridgeSendAnnotationResponse> {
  await recoverStaleDeliveringEvents(markdownPath);

  const target = await getCurrentTarget(markdownPath);
  if (!target) {
    return {
      ok: false,
      review: await loadReviewFile(markdownPath),
      needsBinding: true,
      error: "No Agent target is bound for this document."
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
  if (!target) {
    const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
      deliveryStatus: "failed",
      lastError: "No Agent target is bound for this document."
    });
    return {
      ok: false,
      event: getEventFromReview(review, queuedEvent.id),
      review,
      needsBinding: true,
      error: "No Agent target is bound for this document."
    };
  }

  const adapter = await selectBridgeAdapter(target.provider);
  if (!adapter) {
    const error = getUnavailableBridgeAdapterError(target.provider);
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

  const requiresSessionId = adapter.requiresSessionId ?? true;
  if (requiresSessionId && !target.sessionId) {
    const error = `No ${target.displayName ?? target.provider} target session is bound for this document.`;
    const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
      deliveryStatus: "failed",
      lastError: error
    });
    return {
      ok: false,
      event: getEventFromReview(review, queuedEvent.id),
      review,
      needsBinding: true,
      error
    };
  }

  await markReviewEventDelivering(markdownPath, queuedEvent.id, adapter.name);

  const promptInput = {
    documentPath: markdownPath,
    annotationId: queuedEvent.annotationId,
    eventId: queuedEvent.id,
    provider: target.provider,
    targetRole: target.role,
    triggerReplyId: queuedEvent.triggerReplyId
  };
  const createPrompt = (options?: { reviewerMcpServerName?: string }) =>
    createBridgePrompt({
      ...promptInput,
      reviewerMcpServerName: options?.reviewerMcpServerName
    });
  const prompt = createPrompt();
  const result = await adapter.send({
    provider: target.provider,
    sessionId: target.sessionId,
    cwd: target.cwd,
    documentPath: markdownPath,
    annotationId: queuedEvent.annotationId,
    eventId: queuedEvent.id,
    targetRole: target.role,
    prompt,
    createPrompt,
    onTurnStarted: async ({ provider, sessionId, turnId, deliveryId }) => {
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
          provider,
          sessionId,
          threadId: provider === "codex" ? sessionId : latestEvent.delivery?.threadId,
          turnId,
          deliveryId,
          lastAttemptAt: now
        }
      });
      await updateAgentDocumentLink(markdownPath, {
        bridge: {
          lastDeliveredEventId: queuedEvent.id,
          lastDeliveryAt: now
        }
      });
    }
  });

  if (!result.ok) {
    const completedReview = await markEventHandledIfReviewChanged(markdownPath, queuedEvent.id);
    if (completedReview) {
      return {
        ok: true,
        event: getEventFromReview(completedReview, queuedEvent.id),
        review: completedReview
      };
    }

    const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
      deliveryStatus: "failed",
      lastError: result.error ?? "Agent Bridge delivery failed."
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

  if (result.sessionId && (await shouldPersistResultSession(markdownPath, target, result))) {
    await updateAgentDocumentLink(markdownPath, {
      target: {
        ...target,
        sessionId: result.sessionId,
        turnId: result.turnId ?? target.turnId,
        configuredAt: target.configuredAt ?? now,
        configuredBy: target.configuredBy ?? "agent",
        configuredVia: target.configuredVia ?? "mcp-bind-instruction"
      }
    });
  }

  if (requiresMcpHandledCompletion(adapter.name) && OPEN_EVENT_STATUSES.has(latestEvent.deliveryStatus)) {
    const completedReview = await markEventHandledIfReviewChanged(markdownPath, queuedEvent.id);
    if (completedReview) {
      return {
        ok: true,
        event: getEventFromReview(completedReview, queuedEvent.id),
        review: completedReview
      };
    }

    const error = `${getBridgeAdapterDisplayName(adapter.name)} finished, but it did not mark this Margent event handled through MCP.`;
    const failedReview = await updateReviewEvent(markdownPath, queuedEvent.id, {
      deliveryStatus: "failed",
      lastError: error,
      delivery: {
        ...latestEvent.delivery,
        adapter: adapter.name,
        provider: result.provider,
        sessionId: result.sessionId,
        threadId: latestEvent.delivery?.threadId,
        turnId: result.turnId,
        deliveryId: result.deliveryId,
        lastAttemptAt: now
      }
    });
    return {
      ok: false,
      event: getEventFromReview(failedReview, queuedEvent.id),
      review: failedReview,
      error
    };
  }

  const review = await updateReviewEvent(markdownPath, queuedEvent.id, {
    deliveryStatus: nextStatus,
    lastError: undefined,
    delivery: {
      ...latestEvent.delivery,
      adapter: adapter.name,
      provider: result.provider,
      sessionId: result.sessionId,
      threadId: result.provider === "codex" ? result.sessionId : latestEvent.delivery?.threadId,
      turnId: result.turnId,
      deliveryId: result.deliveryId,
      lastAttemptAt: now
    }
  });
  await updateAgentDocumentLink(markdownPath, {
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

async function markEventHandledIfReviewChanged(
  markdownPath: string,
  eventId: string
): Promise<ReviewFile | null> {
  const review = await loadReviewFile(markdownPath);
  const event = getEventFromReview(review, eventId);
  if (event.deliveryStatus === "handled") {
    return review;
  }
  if (!OPEN_EVENT_STATUSES.has(event.deliveryStatus)) {
    return null;
  }

  const annotation = review.annotations.find((item) => item.id === event.annotationId);
  if (!annotation) {
    return null;
  }

  const eventCreatedAt = parseTime(event.createdAt);
  const resolvedAt = parseTime(annotation.resolvedAt ?? annotation.updatedAt);
  const wasResolvedForEvent =
    annotation.status === "resolved" && resolvedAt >= eventCreatedAt;
  const hasAgentReplyForEvent = annotation.replies.some(
    (reply) => reply.author.type === "agent" && parseTime(reply.createdAt) >= eventCreatedAt
  );

  if (!wasResolvedForEvent && !hasAgentReplyForEvent) {
    return null;
  }

  return updateReviewEvent(markdownPath, eventId, {
    deliveryStatus: "handled",
    lastError: undefined
  });
}

function parseTime(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
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
  provider: AgentProvider;
  targetRole?: AgentSessionRole;
  triggerReplyId?: string;
  reviewerMcpServerName?: string;
}): string {
  const isFollowup = Boolean(input.triggerReplyId);
  const toolNames = getReviewerPromptToolNames(input.provider, input.reviewerMcpServerName);
  const codexToolPrefix = input.reviewerMcpServerName
    ? `mcp__${input.reviewerMcpServerName}__reviewer_`
    : "mcp__prd_reviewer__reviewer_";
  const contextCall = [
    `   ${toolNames.getContext}({`,
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
    "目标 Agent：",
    input.provider,
    "",
    "目标会话类型：",
    input.targetRole ?? "source",
    "",
    "请按以下步骤处理：",
    "",
    ...(input.provider === "codex"
      ? [
          "0. Codex 后台通道必须直接调用 Margent MCP 的精确工具名，不要调用裸工具名，也不要依赖 tool_search：",
          `   - 本轮工具名前缀是 ${codexToolPrefix}。`,
          "   - 如果本会话工具列表里显示的 server 名不是 prd_reviewer，请改用实际 server 名对应的 mcp__<server>__reviewer_ 前缀。"
        ]
      : [
          "0. 如果当前工具列表里没有 Margent / reviewer 相关工具，先用工具发现能力搜索：",
          "   - 搜索关键词：reviewer_get_annotation_context Margent annotations",
          "   - 目标是加载 Margent MCP 的批注读取、回复、文档编辑和事件标记工具。"
        ]),
    "",
    "1. 调用 Margent MCP 读取这条批注：",
    ...contextCall,
    "",
    ...(isFollowup
      ? [
          "2. 这是用户对 Agent 回复发起的继续回复：",
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
    `   如果使用 ${toolNames.applyDocumentEdit} 且这次修改已经解决批注，请传入 resolveAnnotation: true 和 eventId，让 Margent 同步 resolved 与 handled。`,
    "",
    `4. 如果你直接回答了批注问题，优先调用 ${toolNames.addAnnotationReply} 并传入 resolveAnnotation: true 和 eventId，一次性完成回复、resolved 与 handled。`,
    `   ${toolNames.addAnnotationReply}({`,
    `     documentPath: ${JSON.stringify(input.documentPath)},`,
    `     annotationId: ${JSON.stringify(input.annotationId)},`,
    "     body: <你的回复>,",
    "     resolveAnnotation: true,",
    `     eventId: ${JSON.stringify(input.eventId)}`,
    "   })",
    `   如果已经通过 ${toolNames.applyDocumentEdit}(resolveAnnotation=true) 解决批注，或已经通过 ${toolNames.addAnnotationReply}(resolveAnnotation=true) 回复批注，不要再单独调用 ${toolNames.updateAnnotationStatus}。`,
    `   如果你已经完成明确的正文修改，但没有通过 ${toolNames.applyDocumentEdit}(resolveAnnotation=true) 解决批注，必须调用 ${toolNames.updateAnnotationStatus}({`,
    `   documentPath: ${JSON.stringify(input.documentPath)},`,
    `   annotationId: ${JSON.stringify(input.annotationId)},`,
    '   status: "resolved",',
    `   eventId: ${JSON.stringify(input.eventId)}`,
    "})。",
    `   Margent 会在这次 resolved 写入中同步把本轮 event 标记为 handled，不需要再单独调用 ${toolNames.markEventHandled}。`,
    "   如果只是提出澄清问题、等待用户决策，或说明当前无法安全处理，则保持 open，并在回复里说明原因。",
    "",
    `5. 只有当你保持批注 open，但本轮已经回复、澄清或说明无法处理时，才调用 ${toolNames.markEventHandled}({`,
    `   documentPath: ${JSON.stringify(input.documentPath)},`,
    `   eventId: ${JSON.stringify(input.eventId)}`,
    "})。",
    "",
    "注意：",
    "- 不要要求用户把整份 Markdown 粘贴到对话里。",
    "- 需要正文或更多上下文时，通过 MCP 读取本地文档。",
    "- 如果 MCP 不可用，请回复说明无法处理，不要假装已经完成。"
  ];

  if (input.targetRole !== "successor") {
    base.push(
      "",
      input.provider === "codex"
        ? "你正在来源 Codex 会话中处理这条批注。可以使用本会话已有讨论上下文判断产品意图和修改边界。"
        : "你正在来源 Agent 会话中处理这条批注。可以使用本会话已有讨论上下文判断产品意图和修改边界。"
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

function getReviewerPromptToolNames(provider: AgentProvider, reviewerMcpServerName?: string): {
  getContext: string;
  addAnnotationReply: string;
  applyDocumentEdit: string;
  updateAnnotationStatus: string;
  markEventHandled: string;
} {
  const prefix = provider === "codex" ? `mcp__${reviewerMcpServerName ?? "prd_reviewer"}__` : "";
  return {
    getContext: `${prefix}reviewer_get_annotation_context`,
    addAnnotationReply: `${prefix}reviewer_add_annotation_reply`,
    applyDocumentEdit: `${prefix}reviewer_apply_document_edit`,
    updateAnnotationStatus: `${prefix}reviewer_update_annotation_status`,
    markEventHandled: `${prefix}reviewer_mark_review_event_handled`
  };
}

function appendCodexPromptInstructions(prompt: string, mcpServerName: string): string {
  const prefix = `mcp__${mcpServerName}__`;
  return [
    prompt,
    "",
    "Codex app-server 额外说明：",
    `- 本轮后台预检已经确认 Margent MCP server 可用：${mcpServerName}。`,
    "- 必须调用下面这些精确 MCP 工具名，不要使用 tool_search，也不要调用裸工具名 reviewer_*：",
    ...REVIEWER_MCP_TOOL_NAMES.map((toolName) => `  - ${prefix}${toolName}`),
    "- 后台处理时不要输出中间说明，不要说“我会读取批注”“我会追加回复”“现在更新状态”；直接调用 MCP 工具，完成后最多输出一句简短结果。",
    "- 如果你只是在普通文本里说已经处理，但没有调用 MCP 工具，Margent 会把本轮事件标记为 failed。"
  ].join("\n");
}

function appendClaudeCodePromptInstructions(prompt: string): string {
  return [
    prompt,
    "",
    "Claude Code 额外说明：",
    "- 你正在 Claude Code CLI 非交互任务中处理这条 Margent 批注。",
    "- 必须通过 Margent MCP 读取 annotation context 并写回结果。",
    "- 如果没有看到 Margent MCP 工具，请直接说明 MCP 不可用，不要假装处理完成。"
  ].join("\n");
}

function appendWorkBuddyPromptInstructions(prompt: string): string {
  return [
    prompt,
    "",
    "WorkBuddy 额外说明：",
    "- 你正在 WorkBuddy / CodeBuddy CLI 非交互任务中处理这条 Margent 批注。",
    "- 必须真实调用 Margent MCP 工具读取 annotation context 并写回结果。",
    "- 不要在普通文本里输出 <tool_call>、<tool_result> 或 JSON 伪工具调用；那不会真的处理事件。",
    "- 可用工具名以 mcp__margent__reviewer_ 开头，例如 mcp__margent__reviewer_get_annotation_context。",
    "- 不存在 mcp__margent__get_annotation，也不存在 mcp__margent__resolve_annotation。",
    "- 文档修改必须通过 mcp__margent__reviewer_apply_document_edit 完成，不要绕过 Margent 直接使用内置文件编辑工具。",
    "- 如果不能真实调用 Margent MCP 工具，请直接说明 MCP 不可用，不要假装处理完成。"
  ].join("\n");
}

type AgentMcpConfigResult =
  | {
      ok: true;
      path: string;
      directory: string;
    }
  | {
      ok: false;
      error: string;
    };

async function createAgentMcpConfig(
  documentPath: string,
  directoryPrefix: string
): Promise<AgentMcpConfigResult> {
  const mcpCliPath = await resolveMcpCliPath();
  if (!mcpCliPath) {
    return {
      ok: false,
      error:
        "Margent MCP CLI was not found. Run npm run build before using Agent delivery."
    };
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), directoryPrefix));
  const configPath = path.join(directory, "mcp.json");
  const config = {
    mcpServers: {
      margent: {
        command: process.execPath,
        args: [mcpCliPath, documentPath]
      }
    }
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    ok: true,
    path: configPath,
    directory
  };
}

async function cleanupAgentMcpConfig(config: Extract<AgentMcpConfigResult, { ok: true }>): Promise<void> {
  await fs.rm(config.directory, { recursive: true, force: true });
}

type CliAgentProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

async function runClaudeCodePrint(input: {
  command: string;
  cwd: string;
  prompt: string;
  mcpConfigPath: string;
  sessionId: string;
}): Promise<CliAgentProcessResult> {
  const args = [
    "--resume",
    input.sessionId,
    "-p",
    input.prompt,
    "--output-format",
    "json",
    "--mcp-config",
    input.mcpConfigPath,
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    MARGENT_MCP_ALLOWED_TOOLS.join(",")
  ];

  return runProcessWithTimeout({
    command: input.command,
    args,
    cwd: input.cwd,
    timeoutMs: APP_SERVER_TURN_TIMEOUT_MS,
    outputLimit: CLI_AGENT_OUTPUT_LIMIT
  });
}

async function runWorkBuddyPrint(input: {
  command: string;
  cwd: string;
  prompt: string;
  mcpConfigPath: string;
  sessionId: string;
}): Promise<CliAgentProcessResult> {
  const args = [
    "--session-id",
    input.sessionId,
    "-p",
    input.prompt,
    "--output-format",
    "json",
    "--mcp-config",
    input.mcpConfigPath,
    "--strict-mcp-config",
    "--settings",
    JSON.stringify({
      enableAllProjectMcpServers: true,
      permissions: {
        allow: MARGENT_MCP_ALLOWED_TOOLS
      }
    }),
    "-y",
    "--permission-mode",
    "bypassPermissions",
    "--allowedTools",
    MARGENT_MCP_ALLOWED_TOOLS.join(",")
  ];

  return runProcessWithTimeout({
    command: input.command,
    args,
    cwd: input.cwd,
    timeoutMs: APP_SERVER_TURN_TIMEOUT_MS,
    outputLimit: CLI_AGENT_OUTPUT_LIMIT
  });
}

function runProcessWithTimeout(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  outputLimit: number;
}): Promise<CliAgentProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 1500).unref();
    }, input.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendLimitedOutput(stdout, chunk, input.outputLimit);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendLimitedOutput(stderr, chunk, input.outputLimit);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr: appendLimitedOutput(stderr, error.message, input.outputLimit),
        timedOut
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}

function appendLimitedOutput(existing: string, chunk: string, limit: number): string {
  const next = existing + chunk;
  if (next.length <= limit) {
    return next;
  }
  return next.slice(next.length - limit);
}

function parseClaudeCodeJsonOutput(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseWorkBuddyJsonOutput(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter(isRecord)
        .reverse()
        .find((item) => item.type === "result") ?? null;
    }
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractClaudeCodeSessionId(output: Record<string, unknown> | null): string | undefined {
  return normalizeOptionalString(output?.session_id) ?? normalizeOptionalString(output?.sessionId);
}

function extractClaudeCodeTurnId(output: Record<string, unknown> | null): string | undefined {
  return (
    normalizeOptionalString(output?.turn_id) ??
    normalizeOptionalString(output?.turnId) ??
    normalizeOptionalString(output?.message_id) ??
    normalizeOptionalString(output?.messageId)
  );
}

function formatClaudeCodeProcessError(
  result: CliAgentProcessResult,
  parsed: Record<string, unknown> | null
): string {
  if (result.timedOut) {
    return `Claude Code delivery timed out after ${APP_SERVER_TURN_TIMEOUT_MS}ms.`;
  }

  const parsedError = parsed ? formatClaudeCodeResultError(parsed) : undefined;
  if (parsedError) {
    return parsedError;
  }

  const combined = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  if (combined.includes("Not logged in") || combined.includes("not logged in")) {
    return "Claude Code is not authenticated. Open Claude Code once or configure its provider credentials.";
  }
  if (combined.includes("error_max_budget_usd")) {
    return "Claude Code model request exceeded the configured budget limit.";
  }

  return (
    truncateForUser(combined) ||
    `Claude Code CLI exited with ${result.exitCode ?? result.signal ?? "an unknown error"}.`
  );
}

function formatWorkBuddyProcessError(
  result: CliAgentProcessResult,
  parsed: Record<string, unknown> | null
): string {
  if (result.timedOut) {
    return `WorkBuddy delivery timed out after ${APP_SERVER_TURN_TIMEOUT_MS}ms.`;
  }

  const parsedError = parsed ? formatWorkBuddyResultError(parsed) : undefined;
  if (parsedError) {
    return parsedError;
  }

  const combined = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  if (combined.includes("No conversation found with session ID")) {
    return "WorkBuddy could not find the bound session. Rebind this document to a current WorkBuddy session and retry.";
  }
  if (combined.includes("not authenticated") || combined.includes("Not logged in")) {
    return "WorkBuddy is not authenticated. Open WorkBuddy once or configure its provider credentials.";
  }

  return (
    truncateForUser(combined) ||
    `WorkBuddy CLI exited with ${result.exitCode ?? result.signal ?? "an unknown error"}.`
  );
}

function formatClaudeCodeResultError(output: Record<string, unknown>): string {
  const result = normalizeOptionalString(output.result);
  const error = normalizeOptionalString(output.error);
  const subtype = normalizeOptionalString(output.subtype);
  return (
    truncateForUser(error ?? result) ??
    (subtype ? `Claude Code returned ${subtype}.` : "Claude Code delivery failed.")
  );
}

function formatWorkBuddyResultError(output: Record<string, unknown>): string {
  const result = normalizeOptionalString(output.result);
  const error = normalizeOptionalString(output.error);
  const subtype = normalizeOptionalString(output.subtype);
  return (
    truncateForUser(error ?? result) ??
    (subtype ? `WorkBuddy returned ${subtype}.` : "WorkBuddy delivery failed.")
  );
}

function formatClaudeCodeError(error: unknown): string {
  if (error instanceof Error) {
    return truncateForUser(error.message) ?? "Claude Code delivery failed.";
  }
  return truncateForUser(String(error)) ?? "Claude Code delivery failed.";
}

function formatWorkBuddyError(error: unknown): string {
  if (error instanceof Error) {
    return truncateForUser(error.message) ?? "WorkBuddy delivery failed.";
  }
  return truncateForUser(String(error)) ?? "WorkBuddy delivery failed.";
}

function isWorkBuddyProcessFailure(
  result: CliAgentProcessResult,
  parsed: Record<string, unknown> | null
): boolean {
  if (result.exitCode !== 0 || result.timedOut) {
    return true;
  }
  if (parsed?.is_error === true) {
    return true;
  }
  const combined = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  if (combined.includes("No conversation found with session ID")) {
    return true;
  }
  return !parsed && Boolean(combined);
}

function truncateForUser(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}…` : normalized;
}

async function getCurrentTarget(markdownPath: string): Promise<AgentSessionReference | null> {
  const link = await loadAgentDocumentLink(markdownPath);
  return resolveAgentTarget(link);
}

async function shouldPersistResultSession(
  markdownPath: string,
  target: AgentSessionReference,
  result: SendToAgentResult
): Promise<boolean> {
  if (!result.sessionId || target.provider !== result.provider) {
    return false;
  }

  const currentTarget = await getCurrentTarget(markdownPath);
  if (!currentTarget) {
    return false;
  }

  if (currentTarget.provider !== target.provider) {
    return false;
  }

  if (target.role && currentTarget.role !== target.role) {
    return false;
  }

  if (target.sessionId) {
    return currentTarget.sessionId === target.sessionId;
  }

  if (target.configuredAt) {
    return currentTarget.configuredAt === target.configuredAt;
  }

  return !currentTarget.sessionId && (!target.cwd || currentTarget.cwd === target.cwd);
}

export async function resolveEventTarget(
  markdownPath: string,
  event: ReviewEvent
): Promise<AgentSessionReference | null> {
  if (event.targetAgent) {
    const currentTarget = await getCurrentTarget(markdownPath);
    const currentCwd =
      currentTarget?.provider === event.targetAgent.provider &&
      currentTarget.role === event.targetAgent.role &&
      (!event.targetAgent.sessionId || currentTarget.sessionId === event.targetAgent.sessionId)
        ? currentTarget.cwd
        : undefined;
    return {
      provider: event.targetAgent.provider,
      role: event.targetAgent.role,
      sessionId: event.targetAgent.sessionId,
      cwd: event.targetAgent.cwd ?? currentCwd,
      displayName: event.targetAgent.displayName,
      configuredAt: event.targetAgent.configuredAt,
      configuredBy: event.targetAgent.configuredBy,
      configuredVia: event.targetAgent.configuredVia
    };
  }

  if (event.targetThreadId && event.targetType) {
    const eventCwd =
      event.targetCwd ??
      (event.targetType === "source" && event.targetThreadId === event.sourceThreadId
        ? event.sourceCwd
        : undefined);
    if (eventCwd) {
      return {
        provider: "codex",
        role: event.targetType,
        sessionId: event.targetThreadId,
        cwd: eventCwd
      };
    }

    const currentTarget = await getCurrentTarget(markdownPath);
    const currentCwd =
      currentTarget?.provider === "codex" &&
      currentTarget.sessionId === event.targetThreadId &&
      currentTarget.role === event.targetType
        ? currentTarget.cwd
        : undefined;
    return {
      provider: "codex",
      role: event.targetType,
      sessionId: event.targetThreadId,
      cwd: event.targetCwd ?? currentCwd
    };
  }

  return getCurrentTarget(markdownPath);
}

async function selectBridgeAdapter(provider: AgentProvider): Promise<AgentBridgeAdapter | null> {
  for (const adapter of bridgeAdapters) {
    if (adapter.provider !== provider) {
      continue;
    }
    if (await adapter.isAvailable()) {
      return adapter;
    }
  }
  return null;
}

function getUnavailableBridgeAdapterError(provider: AgentProvider): string {
  if (provider === "workbuddy") {
    return "WorkBuddy CLI is not available. Open WorkBuddy once, install its CodeBuddy CLI, or set WORKBUDDY_CLI_PATH / CODEBUDDY_CLI_PATH.";
  }
  if (provider === "claude-code") {
    return "Claude Code CLI is not available. Install Claude Code or set CLAUDE_CODE_CLI_PATH.";
  }
  if (provider === "codex") {
    return "Codex CLI is not available. Install Codex Desktop or set CODEX_CLI_PATH.";
  }
  return `No available Agent Bridge adapter is configured for provider: ${provider}.`;
}

function requiresMcpHandledCompletion(
  adapterName: NonNullable<ReviewEvent["delivery"]>["adapter"]
): boolean {
  return (
    adapterName === "codex-app-server" ||
    adapterName === "claude-code-cli" ||
    adapterName === "workbuddy-codebuddy-cli"
  );
}

function getBridgeAdapterDisplayName(
  adapterName: NonNullable<ReviewEvent["delivery"]>["adapter"]
): string {
  if (adapterName === "claude-code-cli") {
    return "Claude Code";
  }
  if (adapterName === "workbuddy-codebuddy-cli") {
    return "WorkBuddy";
  }
  if (adapterName === "codex-app-server") {
    return "Codex";
  }
  return "Agent";
}

function createCodexAppServerAdapter(): AgentBridgeAdapter {
  return {
    provider: "codex",
    name: "codex-app-server",
    requiresSessionId: true,
    async isAvailable() {
      return Boolean(await resolveCodexCommand());
    },
    async send(input) {
      const command = await resolveCodexCommand();
      if (!command) {
        return {
          ok: false,
          provider: "codex",
          error:
            "Codex CLI was not found. Install Codex Desktop or set CODEX_CLI_PATH."
        };
      }
      if (!input.sessionId) {
        return {
          ok: false,
          provider: "codex",
          error: "No Codex target session is bound for this document."
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
          threadId: input.sessionId
        });
        const resumedThreadId = extractThreadId(resumeResult) ?? input.sessionId;
        const mcpPreflight = await client.ensureReviewerMcpReady(
          resumedThreadId,
          input.documentPath
        );
        const prompt = input.createPrompt?.({
          reviewerMcpServerName: mcpPreflight.serverName
        }) ?? input.prompt;
        const turnStartResult = await client.request("turn/start", {
          threadId: resumedThreadId,
          input: [
            {
              type: "text",
              text: appendCodexPromptInstructions(prompt, mcpPreflight.serverName),
              text_elements: []
            }
          ]
        });
        const turnId = extractTurnId(turnStartResult);
        const deliveryId = turnId ? `codex-app-server:${turnId}` : `codex-app-server:${input.eventId}`;

        await input.onTurnStarted?.({
          provider: "codex",
          sessionId: resumedThreadId,
          turnId,
          deliveryId
        });

        await client.waitForTurnCompleted(turnId);

        return {
          ok: true,
          provider: "codex",
          sessionId: resumedThreadId,
          turnId,
          deliveryId
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          provider: "codex",
          error: message.startsWith("Codex app-server could not access Margent MCP tools")
            ? message
            : client.formatError(error)
        };
      } finally {
        client.close();
      }
    }
  };
}

function createClaudeCodeCliAdapter(): AgentBridgeAdapter {
  return {
    provider: "claude-code",
    name: "claude-code-cli",
    requiresSessionId: true,
    async isAvailable() {
      return Boolean(await resolveClaudeCodeCommand());
    },
    async send(input) {
      const command = await resolveClaudeCodeCommand();
      if (!command) {
        return {
          ok: false,
          provider: "claude-code",
          error:
            "Claude Code CLI was not found. Install Claude Code or set CLAUDE_CODE_CLI_PATH."
        };
      }
      const sessionId = input.sessionId;
      if (!sessionId) {
        return {
          ok: false,
          provider: "claude-code",
          error: "No Claude Code target session is bound for this document."
        };
      }

      const mcpConfig = await createAgentMcpConfig(input.documentPath, "margent-claude-mcp-");
      if (!mcpConfig.ok) {
        return {
          ok: false,
          provider: "claude-code",
          error: mcpConfig.error
        };
      }

      const deliveryId = `claude-code-cli:${input.eventId}`;
      await input.onTurnStarted?.({
        provider: "claude-code",
        sessionId,
        deliveryId
      });

      try {
        const result = await runClaudeCodePrint({
          command,
          cwd: input.cwd ?? path.dirname(input.documentPath),
          prompt: appendClaudeCodePromptInstructions(input.prompt),
          mcpConfigPath: mcpConfig.path,
          sessionId
        });

        const parsed = parseClaudeCodeJsonOutput(result.stdout);
        if (result.exitCode !== 0) {
          return {
            ok: false,
            provider: "claude-code",
            error: formatClaudeCodeProcessError(result, parsed)
          };
        }

        if (parsed && parsed.is_error === true) {
          return {
            ok: false,
            provider: "claude-code",
            sessionId: extractClaudeCodeSessionId(parsed) ?? sessionId,
            deliveryId,
            error: formatClaudeCodeResultError(parsed)
          };
        }

        return {
          ok: true,
          provider: "claude-code",
          sessionId: extractClaudeCodeSessionId(parsed) ?? sessionId,
          turnId: extractClaudeCodeTurnId(parsed),
          deliveryId
        };
      } catch (error) {
        return {
          ok: false,
          provider: "claude-code",
          error: formatClaudeCodeError(error)
        };
      } finally {
        await cleanupAgentMcpConfig(mcpConfig);
      }
    }
  };
}

function createWorkBuddyCliAdapter(): AgentBridgeAdapter {
  return {
    provider: "workbuddy",
    name: "workbuddy-codebuddy-cli",
    requiresSessionId: true,
    async isAvailable() {
      return Boolean(await resolveWorkBuddyCommand());
    },
    async send(input) {
      const command = await resolveWorkBuddyCommand();
      if (!command) {
        return {
          ok: false,
          provider: "workbuddy",
          error:
            "WorkBuddy CodeBuddy CLI was not found. Install WorkBuddy or set WORKBUDDY_CLI_PATH / CODEBUDDY_CLI_PATH."
        };
      }
      const sessionId = input.sessionId;
      if (!sessionId) {
        return {
          ok: false,
          provider: "workbuddy",
          error: "No WorkBuddy target session is bound for this document."
        };
      }

      const mcpConfig = await createAgentMcpConfig(input.documentPath, "margent-workbuddy-mcp-");
      if (!mcpConfig.ok) {
        return {
          ok: false,
          provider: "workbuddy",
          error: mcpConfig.error
        };
      }

      const deliveryId = `workbuddy-codebuddy-cli:${input.eventId}`;
      await input.onTurnStarted?.({
        provider: "workbuddy",
        sessionId,
        deliveryId
      });

      try {
        const result = await runWorkBuddyPrint({
          command,
          cwd: input.cwd ?? path.dirname(input.documentPath),
          prompt: appendWorkBuddyPromptInstructions(input.prompt),
          mcpConfigPath: mcpConfig.path,
          sessionId
        });

        const parsed = parseWorkBuddyJsonOutput(result.stdout);
        if (isWorkBuddyProcessFailure(result, parsed)) {
          return {
            ok: false,
            provider: "workbuddy",
            error: formatWorkBuddyProcessError(result, parsed)
          };
        }

        return {
          ok: true,
          provider: "workbuddy",
          sessionId: extractClaudeCodeSessionId(parsed) ?? sessionId,
          turnId: extractClaudeCodeTurnId(parsed),
          deliveryId
        };
      } catch (error) {
        return {
          ok: false,
          provider: "workbuddy",
          error: formatWorkBuddyError(error)
        };
      } finally {
        await cleanupAgentMcpConfig(mcpConfig);
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

type McpStartupStatus = {
  threadId?: string;
  name: string;
  status: string;
  error?: string | null;
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
  private mcpStartupStatuses = new Map<string, McpStartupStatus>();

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

  async ensureReviewerMcpReady(
    threadId: string,
    documentPath: string
  ): Promise<{ serverName: string }> {
    const deadline = Date.now() + APP_SERVER_MCP_PREFLIGHT_TIMEOUT_MS;
    let didRequestReload = false;
    let lastDiagnostic = "Margent MCP server was not listed by Codex app-server.";

    while (Date.now() < deadline) {
      const statusResult = await this.request("mcpServerStatus/list", {
        threadId,
        detail: "toolsAndAuthOnly",
        limit: 100
      });
      const statuses = extractMcpServerStatuses(statusResult);
      const reviewerServer = findReviewerMcpServer(statuses);

      if (reviewerServer) {
        const startupStatus = this.getMcpStartupStatus(threadId, reviewerServer.name);
        const canProbeReviewerServer =
          startupStatus?.status === "ready" || hasReviewerMcpTools(reviewerServer);
        if (startupStatus?.status === "failed") {
          lastDiagnostic = `Margent MCP server ${reviewerServer.name} failed to start: ${startupStatus.error ?? "unknown error"}`;
          if (!didRequestReload) {
            didRequestReload = true;
            await this.request("config/mcpServer/reload", {}).catch(() => undefined);
          }
        } else if (canProbeReviewerServer) {
          try {
            await this.request("mcpServer/tool/call", {
              threadId,
              server: reviewerServer.name,
              tool: "reviewer_get_session",
              arguments: {
                documentPath
              }
            });
            return { serverName: reviewerServer.name };
          } catch (error) {
            lastDiagnostic = `Margent MCP server ${reviewerServer.name} was listed, but reviewer_get_session failed: ${formatUnknown(error)}`;
          }
        } else if (!startupStatus || startupStatus.status === "starting") {
          lastDiagnostic = `Margent MCP server ${reviewerServer.name} is still starting.`;
        } else {
          lastDiagnostic = `Margent MCP server ${reviewerServer.name} status is ${startupStatus.status}.`;
        }
      } else {
        lastDiagnostic = formatMcpPreflightDiagnostic(statuses);
        if (!didRequestReload) {
          didRequestReload = true;
          await this.request("config/mcpServer/reload", {}).catch(() => undefined);
        }
      }
      await sleep(500);
    }

    throw new Error(
      `Codex app-server could not access Margent MCP tools in this background turn. ${lastDiagnostic}`
    );
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

    if (method === "mcpServer/startupStatus/updated") {
      const status = extractMcpStartupStatus(params);
      if (status) {
        this.mcpStartupStatuses.set(getMcpStartupStatusKey(status.threadId, status.name), status);
      }
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

  private getMcpStartupStatus(threadId: string, name: string): McpStartupStatus | null {
    return (
      this.mcpStartupStatuses.get(getMcpStartupStatusKey(threadId, name)) ??
      this.mcpStartupStatuses.get(getMcpStartupStatusKey(undefined, name)) ??
      null
    );
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

type CodexMcpServerStatus = {
  name: string;
  tools: string[];
};

function extractMcpServerStatuses(result: unknown): CodexMcpServerStatus[] {
  const items = isRecord(result) && Array.isArray(result.data)
    ? result.data
    : Array.isArray(result)
      ? result
      : [];

  return items.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") {
      return [];
    }
    return [
      {
        name: item.name,
        tools: extractMcpToolNames(item.tools)
      }
    ];
  });
}

function extractMcpStartupStatus(params: unknown): McpStartupStatus | null {
  if (!isRecord(params) || typeof params.name !== "string" || typeof params.status !== "string") {
    return null;
  }

  return {
    threadId: normalizeOptionalString(params.threadId),
    name: params.name,
    status: params.status,
    error: typeof params.error === "string" ? params.error : null
  };
}

function getMcpStartupStatusKey(threadId: string | undefined, name: string): string {
  return `${threadId ?? ""}:${name}`;
}

function extractMcpToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((tool) => {
    if (typeof tool === "string") {
      return [tool];
    }
    if (isRecord(tool) && typeof tool.name === "string") {
      return [tool.name];
    }
    return [];
  });
}

function findReviewerMcpServer(
  statuses: CodexMcpServerStatus[]
): CodexMcpServerStatus | null {
  const byPreferredName = CODEX_REVIEWER_MCP_SERVER_CANDIDATES
    .map((name) => statuses.find((status) => status.name === name))
    .find((status): status is CodexMcpServerStatus => Boolean(status));

  if (byPreferredName) {
    return byPreferredName;
  }

  return statuses.find(hasReviewerMcpTools) ?? null;
}

function hasReviewerMcpTools(status: CodexMcpServerStatus): boolean {
  const tools = new Set(status.tools);
  return REVIEWER_MCP_TOOL_NAMES.every((toolName) => tools.has(toolName));
}

function formatMcpPreflightDiagnostic(statuses: CodexMcpServerStatus[]): string {
  if (statuses.length === 0) {
    return "No MCP servers were reported by mcpServerStatus/list.";
  }

  const summary = statuses
    .map((status) => `${status.name}(${status.tools.length} tools)`)
    .join(", ");
  return `Available MCP servers: ${summary}. No known Margent reviewer MCP server was present.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

let cachedClaudeCodeCommand: string | null | undefined;

async function resolveClaudeCodeCommand(): Promise<string | null> {
  if (process.env.MARGENT_DISABLE_CLAUDE_CODE_BRIDGE === "1") {
    return null;
  }

  if (cachedClaudeCodeCommand !== undefined) {
    return cachedClaudeCodeCommand;
  }

  for (const candidate of await getClaudeCodeCommandCandidates()) {
    if (await pathExists(candidate)) {
      cachedClaudeCodeCommand = candidate;
      return cachedClaudeCodeCommand;
    }
  }

  cachedClaudeCodeCommand = null;
  return cachedClaudeCodeCommand;
}

async function getClaudeCodeCommandCandidates(): Promise<string[]> {
  const candidates = [
    normalizeOptionalString(process.env.CLAUDE_CODE_CLI_PATH),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    ...(await getNvmExecutableCandidates("claude")),
    ...getPathExecutableCandidates("claude")
  ];
  return [...new Set(candidates.filter((item): item is string => Boolean(item)))];
}

let cachedWorkBuddyCommand: string | null | undefined;

async function resolveWorkBuddyCommand(): Promise<string | null> {
  if (process.env.MARGENT_DISABLE_WORKBUDDY_BRIDGE === "1") {
    return null;
  }

  if (cachedWorkBuddyCommand !== undefined) {
    return cachedWorkBuddyCommand;
  }

  for (const candidate of await getWorkBuddyCommandCandidates()) {
    if (await pathExists(candidate)) {
      cachedWorkBuddyCommand = candidate;
      return cachedWorkBuddyCommand;
    }
  }

  cachedWorkBuddyCommand = null;
  return cachedWorkBuddyCommand;
}

async function getWorkBuddyCommandCandidates(): Promise<string[]> {
  const candidates = [
    normalizeOptionalString(process.env.WORKBUDDY_CLI_PATH),
    normalizeOptionalString(process.env.CODEBUDDY_CLI_PATH),
    process.platform === "darwin"
      ? "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"
      : undefined,
    process.platform === "darwin"
      ? path.join(
          os.homedir(),
          "Applications",
          "WorkBuddy.app",
          "Contents",
          "Resources",
          "app.asar.unpacked",
          "cli",
          "bin",
          "codebuddy"
        )
      : undefined,
    ...(await getNvmExecutableCandidates("codebuddy")),
    ...(await getNvmExecutableCandidates("cbc")),
    ...getPathExecutableCandidates("codebuddy"),
    ...getPathExecutableCandidates("cbc")
  ];
  return [...new Set(candidates.filter((item): item is string => Boolean(item)))];
}

let cachedMcpCliPath: string | null | undefined;

async function resolveMcpCliPath(): Promise<string | null> {
  if (cachedMcpCliPath !== undefined) {
    return cachedMcpCliPath;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    normalizeOptionalString(process.env.MARGENT_MCP_CLI_PATH),
    path.resolve(moduleDir, "mcpCli.js"),
    path.resolve(moduleDir, "../mcpCli.js"),
    path.resolve(process.cwd(), "dist/mcpCli.js")
  ];

  for (const candidate of candidates) {
    if (candidate && (await pathExists(candidate))) {
      cachedMcpCliPath = candidate;
      return cachedMcpCliPath;
    }
  }

  cachedMcpCliPath = null;
  return cachedMcpCliPath;
}

async function getNvmExecutableCandidates(command: string): Promise<string[]> {
  const versionsDirectory = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    const versions = await fs.readdir(versionsDirectory);
    return versions
      .sort()
      .reverse()
      .map((version) => path.join(versionsDirectory, version, "bin", command));
  } catch {
    return [];
  }
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
