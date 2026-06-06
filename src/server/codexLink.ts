import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  CodexDocumentLink,
  CodexLinkResponse,
  CodexTargetReference,
  CodexTargetType,
  SuccessorInstructionResponse,
  UpdateCodexLinkRequest
} from "../shared/codexTypes.js";
import { getCodexLinkPath } from "./paths.js";

const CODEX_LINK_VERSION = 1;
const codexLinkMutationQueues = new Map<string, Promise<unknown>>();

export async function loadCodexDocumentLink(
  markdownPath: string
): Promise<CodexDocumentLink | null> {
  const codexLinkPath = getCodexLinkPath(markdownPath);

  try {
    const raw = await fs.readFile(codexLinkPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCodexDocumentLinkLike(parsed)) {
      return null;
    }
    return normalizeCodexDocumentLink(parsed, markdownPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Codex link file is not valid JSON: ${codexLinkPath}`);
    }
    throw error;
  }
}

export async function saveCodexDocumentLink(
  markdownPath: string,
  link: CodexDocumentLink
): Promise<CodexDocumentLink> {
  const normalized = normalizeCodexDocumentLink(link, markdownPath);
  const codexLinkPath = getCodexLinkPath(markdownPath);
  const temporaryPath = path.join(
    path.dirname(codexLinkPath),
    `.${path.basename(codexLinkPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  await fs.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, codexLinkPath);
  return normalized;
}

export async function updateCodexDocumentLink(
  markdownPath: string,
  request: UpdateCodexLinkRequest
): Promise<CodexDocumentLink> {
  return withCodexLinkMutation(markdownPath, async () => {
    const existing = await loadCodexDocumentLink(markdownPath);
    const base = existing ?? createEmptyCodexDocumentLink(markdownPath);
    const updated: CodexDocumentLink = {
      ...base,
      source: request.source ? normalizeSource(request.source) : base.source,
      target: request.target ? normalizeTarget(request.target) : base.target,
      bridge: request.bridge
        ? {
            ...base.bridge,
            ...request.bridge
          }
        : base.bridge
    };

    if (updated.source && !updated.target) {
      updated.target = {
        type: "source",
        threadId: updated.source.threadId,
        cwd: updated.source.cwd,
        configuredAt: updated.source.updatedAt ?? updated.source.createdAt,
        configuredBy: "codex",
        configuredVia: "source"
      };
    }

    return saveCodexDocumentLink(markdownPath, updated);
  });
}

export async function applyDiscoveredCodexSource(
  markdownPath: string,
  source: NonNullable<CodexDocumentLink["source"]>,
  target: CodexTargetReference
): Promise<CodexDocumentLink> {
  return withCodexLinkMutation(markdownPath, async () => {
    const existing = await loadCodexDocumentLink(markdownPath);
    if (existing?.source?.threadId) {
      return existing;
    }

    const base = existing ?? createEmptyCodexDocumentLink(markdownPath);
    return saveCodexDocumentLink(markdownPath, {
      ...base,
      source,
      target
    });
  });
}

export async function getCodexLinkResponse(markdownPath: string): Promise<CodexLinkResponse> {
  const link = await loadCodexDocumentLink(markdownPath);
  const target = resolveCodexTarget(link);
  return {
    documentPath: markdownPath,
    codexLinkPath: getCodexLinkPath(markdownPath),
    link,
    connection: {
      hasSource: Boolean(getSourceThreadId(link)),
      hasTarget: Boolean(target?.threadId),
      targetType: target?.type ?? null,
      autoSendNewAnnotations: Boolean(link?.bridge?.autoSendNewAnnotations),
      sourceAvailable: link?.source?.threadId ? null : false
    }
  };
}

export function createEmptyCodexDocumentLink(markdownPath: string): CodexDocumentLink {
  return {
    version: CODEX_LINK_VERSION,
    documentPath: markdownPath
  };
}

export function getSourceThreadId(link: CodexDocumentLink | null): string | null {
  const threadId = link?.source?.threadId;
  return typeof threadId === "string" && threadId.trim() ? threadId : null;
}

export function resolveCodexTarget(
  link: CodexDocumentLink | null
): CodexTargetReference | null {
  if (!link) {
    return null;
  }

  if (link.target?.threadId) {
    return link.target;
  }

  if (link.source?.threadId) {
    return {
      type: "source",
      threadId: link.source.threadId,
      cwd: link.source.cwd,
      configuredAt: link.source.updatedAt ?? link.source.createdAt,
      configuredBy: "codex",
      configuredVia: "source"
    };
  }

  return link.target ?? null;
}

export function createSuccessorInstruction(
  markdownPath: string
): SuccessorInstructionResponse {
  return {
    documentPath: markdownPath,
    instruction: [
      "请把你当前这个 Codex 会话绑定为 Margent 的接续对话。",
      "",
      "文档路径：",
      markdownPath,
      "",
      "请调用 Margent MCP：",
      "reviewer_bind_current_codex_thread({",
      `  documentPath: ${JSON.stringify(markdownPath)},`,
      '  role: "successor"',
      "})",
      "",
      "绑定成功后，请回复我：已连接接续对话。"
    ].join("\n")
  };
}

export async function bindCodexThread(
  markdownPath: string,
  input: {
    role: CodexTargetType;
    threadId?: string;
    cwd?: string;
    autoSendNewAnnotations?: boolean;
  }
): Promise<CodexDocumentLink> {
  return withCodexLinkMutation(markdownPath, async () => {
    const threadId = normalizeOptionalString(input.threadId ?? getCurrentCodexThreadId());
    const cwd = normalizeOptionalString(input.cwd ?? getCurrentCodexCwd());

    if (!threadId) {
      throw new Error("Unable to detect the current Codex thread id for automatic binding.");
    }

    const now = new Date().toISOString();
    const existing = await loadCodexDocumentLink(markdownPath);
    const base = existing ?? createEmptyCodexDocumentLink(markdownPath);
    const source =
      input.role === "source"
        ? {
            type: "codex" as const,
            threadId,
            cwd,
            createdAt: base.source?.createdAt ?? now,
            updatedAt: now
          }
        : base.source;
    const target: CodexTargetReference =
      input.role === "source"
        ? {
            type: "source",
            threadId,
            cwd,
            configuredAt: now,
            configuredBy: "codex",
            configuredVia: "source"
          }
        : {
            type: "successor",
            threadId,
            cwd,
            configuredAt: now,
            configuredBy: "codex",
            configuredVia: "mcp-bind-instruction"
          };

    return saveCodexDocumentLink(markdownPath, {
      ...base,
      source,
      target,
      bridge: {
        ...base.bridge,
        ...(input.autoSendNewAnnotations === undefined
          ? {}
          : { autoSendNewAnnotations: input.autoSendNewAnnotations })
      }
    });
  });
}

function normalizeCodexDocumentLink(
  link: Partial<CodexDocumentLink>,
  markdownPath: string
): CodexDocumentLink {
  const normalized: CodexDocumentLink = {
    version: CODEX_LINK_VERSION,
    documentPath: markdownPath
  };

  if (link.source) {
    normalized.source = normalizeSource(link.source);
  }

  if (link.target) {
    normalized.target = normalizeTarget(link.target);
  } else if (normalized.source?.threadId) {
    normalized.target = {
      type: "source",
      threadId: normalized.source.threadId,
      cwd: normalized.source.cwd,
      configuredAt: normalized.source.updatedAt ?? normalized.source.createdAt,
      configuredBy: "codex",
      configuredVia: "source"
    };
  }

  if (link.bridge) {
    normalized.bridge = {
      autoSendNewAnnotations: Boolean(link.bridge.autoSendNewAnnotations),
      lastDeliveredEventId: normalizeOptionalString(link.bridge.lastDeliveredEventId),
      lastDeliveryAt: normalizeOptionalString(link.bridge.lastDeliveryAt)
    };
  }

  return normalized;
}

function normalizeSource(source: NonNullable<CodexDocumentLink["source"]>) {
  return {
    type: "codex" as const,
    threadId: normalizeOptionalString(source.threadId),
    turnId: normalizeOptionalString(source.turnId),
    cwd: normalizeOptionalString(source.cwd),
    createdAt: normalizeOptionalString(source.createdAt),
    updatedAt: normalizeOptionalString(source.updatedAt)
  };
}

function normalizeTarget(target: CodexTargetReference): CodexTargetReference {
  return {
    type: target.type === "successor" ? "successor" : "source",
    threadId: normalizeOptionalString(target.threadId),
    cwd: normalizeOptionalString(target.cwd),
    configuredAt: normalizeOptionalString(target.configuredAt),
    configuredBy: target.configuredBy === "user" ? "user" : "codex",
    configuredVia:
      target.configuredVia === "manual" || target.configuredVia === "mcp-bind-instruction"
        ? target.configuredVia
        : "source"
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function withCodexLinkMutation<T>(
  markdownPath: string,
  mutation: () => Promise<T>
): Promise<T> {
  const queueKey = path.resolve(markdownPath);
  const previous = codexLinkMutationQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  const queued = next.catch(() => undefined).then(() => {
    if (codexLinkMutationQueues.get(queueKey) === queued) {
      codexLinkMutationQueues.delete(queueKey);
    }
  });
  codexLinkMutationQueues.set(queueKey, queued);
  return next;
}

function getCurrentCodexThreadId(): string | undefined {
  return (
    normalizeOptionalString(process.env.CODEX_THREAD_ID) ??
    normalizeOptionalString(process.env.CODEX_SESSION_ID) ??
    normalizeOptionalString(process.env.CODEX_CONVERSATION_ID)
  );
}

function getCurrentCodexCwd(): string | undefined {
  return normalizeOptionalString(process.env.CODEX_WORKSPACE) ?? process.cwd();
}

function isCodexDocumentLinkLike(value: unknown): value is Partial<CodexDocumentLink> {
  return typeof value === "object" && value !== null && "version" in value;
}
