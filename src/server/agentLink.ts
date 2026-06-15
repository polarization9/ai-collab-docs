import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentDocumentLink,
  AgentLinkResponse,
  AgentProvider,
  AgentSessionReference,
  AgentSessionRole,
  AgentSuccessorInstructionResponse,
  UpdateAgentLinkRequest
} from "../shared/agentTypes.js";
import type {
  CodexDocumentLink,
  CodexTargetReference
} from "../shared/codexTypes.js";
import { getAgentLinkPath, getCodexLinkPath } from "./paths.js";

const AGENT_LINK_VERSION = 1;
const agentLinkMutationQueues = new Map<string, Promise<unknown>>();

export async function loadAgentDocumentLink(
  markdownPath: string
): Promise<AgentDocumentLink | null> {
  const agentLinkPath = getAgentLinkPath(markdownPath);
  const agentLink = await readAgentLinkFile(agentLinkPath, markdownPath);
  if (agentLink) {
    return agentLink;
  }

  const legacyCodexLinkPath = getCodexLinkPath(markdownPath);
  const legacyCodexLink = await readLegacyCodexLinkFile(legacyCodexLinkPath, markdownPath);
  return legacyCodexLink ? codexLinkToAgentLink(legacyCodexLink, markdownPath) : null;
}

export async function saveAgentDocumentLink(
  markdownPath: string,
  link: AgentDocumentLink
): Promise<AgentDocumentLink> {
  const normalized = normalizeAgentDocumentLink(link, markdownPath);
  const agentLinkPath = getAgentLinkPath(markdownPath);
  const temporaryPath = path.join(
    path.dirname(agentLinkPath),
    `.${path.basename(agentLinkPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  await fs.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, agentLinkPath);
  return normalized;
}

export async function updateAgentDocumentLink(
  markdownPath: string,
  request: UpdateAgentLinkRequest
): Promise<AgentDocumentLink> {
  return withAgentLinkMutation(markdownPath, async () => {
    const existing = await loadAgentDocumentLink(markdownPath);
    const base = existing ?? createEmptyAgentDocumentLink(markdownPath);
    const updated: AgentDocumentLink = {
      ...base,
      source: request.source ? normalizeSession(request.source, "source") : base.source,
      target: request.target ? normalizeSession(request.target) : base.target,
      bridge: request.bridge
        ? {
            ...base.bridge,
            ...normalizeBridge(request.bridge)
          }
        : base.bridge
    };

    if (updated.source && !updated.target) {
      updated.target = sourceToDefaultTarget(updated.source);
    }

    return saveAgentDocumentLink(markdownPath, updated);
  });
}

export async function applyDiscoveredAgentSource(
  markdownPath: string,
  source: AgentSessionReference,
  target: AgentSessionReference
): Promise<AgentDocumentLink> {
  return withAgentLinkMutation(markdownPath, async () => {
    const existing = await loadAgentDocumentLink(markdownPath);
    if (existing?.source?.sessionId) {
      return existing;
    }

    const base = existing ?? createEmptyAgentDocumentLink(markdownPath);
    return saveAgentDocumentLink(markdownPath, {
      ...base,
      source: normalizeSession(source, "source"),
      target: normalizeSession(target)
    });
  });
}

export async function getAgentLinkResponse(markdownPath: string): Promise<AgentLinkResponse> {
  const link = await loadAgentDocumentLink(markdownPath);
  const target = resolveAgentTarget(link);
  return {
    documentPath: markdownPath,
    agentLinkPath: getAgentLinkPath(markdownPath),
    legacyCodexLinkPath: getCodexLinkPath(markdownPath),
    link,
    connection: {
      hasSource: Boolean(getSourceSessionId(link)),
      hasTarget: Boolean(target?.sessionId),
      provider: target?.provider ?? null,
      targetRole: target?.role ?? null,
      autoSendNewAnnotations: Boolean(link?.bridge?.autoSendNewAnnotations),
      sourceAvailable: link?.source?.sessionId ? null : false
    }
  };
}

export function createEmptyAgentDocumentLink(markdownPath: string): AgentDocumentLink {
  return {
    version: AGENT_LINK_VERSION,
    documentPath: markdownPath
  };
}

export function getSourceSessionId(link: AgentDocumentLink | null): string | null {
  const sessionId = link?.source?.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

export function resolveAgentTarget(
  link: AgentDocumentLink | null
): AgentSessionReference | null {
  if (!link) {
    return null;
  }

  if (link.target?.sessionId) {
    return link.target;
  }

  if (link.source?.sessionId) {
    return sourceToDefaultTarget(link.source);
  }

  return link.target ?? null;
}

export function createAgentSuccessorInstruction(
  markdownPath: string,
  provider: AgentProvider = "codex"
): AgentSuccessorInstructionResponse {
  const toolName =
    provider === "codex"
      ? "reviewer_bind_current_codex_thread"
      : "reviewer_bind_current_agent_session";
  const providerLine =
    provider === "codex" ? undefined : `  provider: ${JSON.stringify(provider)},`;

  return {
    documentPath: markdownPath,
    provider,
    instruction: [
      "请把你当前这个 Agent 会话绑定为 Margent 的接续对话。",
      "",
      "文档路径：",
      markdownPath,
      "",
      "请调用 Margent MCP：",
      `${toolName}({`,
      `  documentPath: ${JSON.stringify(markdownPath)},`,
      ...(providerLine ? [providerLine] : []),
      '  role: "successor"',
      "})",
      "",
      "绑定成功后，请回复我：已连接接续对话。"
    ].join("\n")
  };
}

export async function bindAgentSession(
  markdownPath: string,
  input: {
    provider: AgentProvider;
    role: AgentSessionRole;
    sessionId?: string;
    cwd?: string;
    displayName?: string;
    autoSendNewAnnotations?: boolean;
  }
): Promise<AgentDocumentLink> {
  return withAgentLinkMutation(markdownPath, async () => {
    const sessionId = normalizeOptionalString(
      input.sessionId ?? getCurrentAgentSessionId(input.provider)
    );
    const cwd = normalizeOptionalString(input.cwd ?? getCurrentAgentCwd(input.provider));

    if (!sessionId) {
      throw new Error(
        `Unable to detect the current ${getProviderDisplayName(input.provider)} session id for automatic binding.`
      );
    }

    const now = new Date().toISOString();
    const existing = await loadAgentDocumentLink(markdownPath);
    const base = existing ?? createEmptyAgentDocumentLink(markdownPath);
    const source =
      input.role === "source"
        ? normalizeSession(
            {
              provider: input.provider,
              role: "source",
              sessionId,
              cwd,
              displayName: input.displayName ?? getProviderDisplayName(input.provider),
              configuredAt: base.source?.configuredAt ?? now,
              configuredBy: "agent",
              configuredVia: "source"
            },
            "source"
          )
        : base.source;
    const target = normalizeSession({
      provider: input.provider,
      role: input.role,
      sessionId,
      cwd,
      displayName: input.displayName ?? getProviderDisplayName(input.provider),
      configuredAt: now,
      configuredBy: "agent",
      configuredVia: input.role === "source" ? "source" : "mcp-bind-instruction"
    });

    return saveAgentDocumentLink(markdownPath, {
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

export function codexLinkToAgentLink(
  link: CodexDocumentLink,
  markdownPath: string
): AgentDocumentLink {
  const source = link.source
    ? normalizeSession(
        {
          provider: "codex",
          role: "source",
          sessionId: link.source.threadId,
          turnId: link.source.turnId,
          cwd: link.source.cwd,
          displayName: "Codex",
          configuredAt: link.source.updatedAt ?? link.source.createdAt,
          configuredBy: "agent",
          configuredVia: "source"
        },
        "source"
      )
    : undefined;
  const target = link.target
    ? normalizeSession(codexTargetToAgentSession(link.target))
    : source
      ? sourceToDefaultTarget(source)
      : undefined;
  return normalizeAgentDocumentLink(
    {
      version: AGENT_LINK_VERSION,
      documentPath: markdownPath,
      source,
      target,
      bridge: link.bridge
    },
    markdownPath
  );
}

export function agentLinkToCodexLink(link: AgentDocumentLink | null): CodexDocumentLink | null {
  if (!link) {
    return null;
  }

  const source =
    link.source?.provider === "codex"
      ? {
          type: "codex" as const,
          threadId: link.source.sessionId,
          turnId: link.source.turnId,
          cwd: link.source.cwd,
          createdAt: link.source.configuredAt,
          updatedAt: link.source.configuredAt
        }
      : undefined;
  const target: CodexTargetReference | undefined =
    link.target?.provider === "codex"
      ? {
          type: link.target.role === "successor" ? "successor" : "source",
          threadId: link.target.sessionId,
          cwd: link.target.cwd,
          configuredAt: link.target.configuredAt,
          configuredBy: link.target.configuredBy === "user" ? "user" : "codex",
          configuredVia: agentConfiguredViaToCodex(link.target.configuredVia)
        }
      : undefined;

  return {
    version: 1,
    documentPath: link.documentPath,
    source,
    target,
    bridge: link.bridge
  };
}

function agentConfiguredViaToCodex(
  value: AgentSessionReference["configuredVia"]
): CodexTargetReference["configuredVia"] {
  if (value === "local-discovery") {
    return "local-log-discovery";
  }
  return value;
}

export function getProviderDisplayName(provider: AgentProvider): string {
  if (provider === "claude-code") {
    return "Claude Code";
  }
  if (provider === "custom-cli") {
    return "Custom CLI";
  }
  return "Codex";
}

function codexTargetToAgentSession(target: CodexTargetReference): AgentSessionReference {
  return {
    provider: "codex",
    role: target.type,
    sessionId: target.threadId,
    cwd: target.cwd,
    displayName: "Codex",
    configuredAt: target.configuredAt,
    configuredBy: target.configuredBy === "user" ? "user" : "agent",
    configuredVia:
      target.configuredVia === "local-log-discovery"
        ? "local-discovery"
        : target.configuredVia
  };
}

function sourceToDefaultTarget(source: AgentSessionReference): AgentSessionReference {
  return {
    provider: source.provider,
    role: "source",
    sessionId: source.sessionId,
    cwd: source.cwd,
    displayName: source.displayName,
    configuredAt: source.configuredAt,
    configuredBy: source.configuredBy,
    configuredVia: "source"
  };
}

function normalizeAgentDocumentLink(
  link: Partial<AgentDocumentLink>,
  markdownPath: string
): AgentDocumentLink {
  const normalized: AgentDocumentLink = {
    version: AGENT_LINK_VERSION,
    documentPath: markdownPath
  };

  if (link.source) {
    normalized.source = normalizeSession(link.source, "source");
  }

  if (link.target) {
    normalized.target = normalizeSession(link.target);
  } else if (normalized.source?.sessionId) {
    normalized.target = sourceToDefaultTarget(normalized.source);
  }

  if (link.bridge) {
    normalized.bridge = normalizeBridge(link.bridge);
  }

  return normalized;
}

function normalizeSession(
  session: AgentSessionReference,
  defaultRole?: AgentSessionRole
): AgentSessionReference {
  const provider = normalizeProvider(session.provider);
  return {
    provider,
    role: normalizeRole(session.role ?? defaultRole),
    sessionId: normalizeOptionalString(session.sessionId),
    turnId: normalizeOptionalString(session.turnId),
    cwd: normalizeOptionalString(session.cwd),
    displayName: normalizeOptionalString(session.displayName) ?? getProviderDisplayName(provider),
    configuredAt: normalizeOptionalString(session.configuredAt),
    configuredBy: session.configuredBy === "user" ? "user" : "agent",
    configuredVia: normalizeConfiguredVia(session.configuredVia)
  };
}

function normalizeBridge(bridge: NonNullable<AgentDocumentLink["bridge"]>) {
  return {
    autoSendNewAnnotations: Boolean(bridge.autoSendNewAnnotations),
    lastDeliveredEventId: normalizeOptionalString(bridge.lastDeliveredEventId),
    lastDeliveryAt: normalizeOptionalString(bridge.lastDeliveryAt)
  };
}

function normalizeProvider(provider: unknown): AgentProvider {
  if (provider === "claude-code" || provider === "custom-cli") {
    return provider;
  }
  return "codex";
}

function normalizeRole(role: unknown): AgentSessionRole | undefined {
  if (role === "source" || role === "successor") {
    return role;
  }
  return undefined;
}

function normalizeConfiguredVia(value: unknown): AgentSessionReference["configuredVia"] {
  if (value === "local-log-discovery") {
    return "local-discovery";
  }
  if (
    value === "manual" ||
    value === "mcp-bind-instruction" ||
    value === "local-discovery" ||
    value === "source"
  ) {
    return value;
  }
  return undefined;
}

async function readAgentLinkFile(
  filePath: string,
  markdownPath: string
): Promise<AgentDocumentLink | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isAgentDocumentLinkLike(parsed)) {
      return null;
    }
    return normalizeAgentDocumentLink(parsed, markdownPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Agent link file is not valid JSON: ${filePath}`);
    }
    throw error;
  }
}

async function readLegacyCodexLinkFile(
  filePath: string,
  markdownPath: string
): Promise<CodexDocumentLink | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCodexDocumentLinkLike(parsed)) {
      return null;
    }
    return normalizeLegacyCodexLink(parsed, markdownPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Codex link file is not valid JSON: ${filePath}`);
    }
    throw error;
  }
}

function normalizeLegacyCodexLink(
  link: Partial<CodexDocumentLink>,
  markdownPath: string
): CodexDocumentLink {
  const normalized: CodexDocumentLink = {
    version: 1,
    documentPath: markdownPath
  };

  if (link.source) {
    normalized.source = {
      type: "codex",
      threadId: normalizeOptionalString(link.source.threadId),
      turnId: normalizeOptionalString(link.source.turnId),
      cwd: normalizeOptionalString(link.source.cwd),
      createdAt: normalizeOptionalString(link.source.createdAt),
      updatedAt: normalizeOptionalString(link.source.updatedAt)
    };
  }

  if (link.target) {
    normalized.target = {
      type: link.target.type === "successor" ? "successor" : "source",
      threadId: normalizeOptionalString(link.target.threadId),
      cwd: normalizeOptionalString(link.target.cwd),
      configuredAt: normalizeOptionalString(link.target.configuredAt),
      configuredBy: link.target.configuredBy === "user" ? "user" : "codex",
      configuredVia:
        link.target.configuredVia === "manual" ||
        link.target.configuredVia === "mcp-bind-instruction" ||
        link.target.configuredVia === "local-log-discovery"
          ? link.target.configuredVia
          : "source"
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

function withAgentLinkMutation<T>(
  markdownPath: string,
  mutation: () => Promise<T>
): Promise<T> {
  const queueKey = path.resolve(markdownPath);
  const previous = agentLinkMutationQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  const queued = next.catch(() => undefined).then(() => {
    if (agentLinkMutationQueues.get(queueKey) === queued) {
      agentLinkMutationQueues.delete(queueKey);
    }
  });
  agentLinkMutationQueues.set(queueKey, queued);
  return next;
}

function getCurrentAgentSessionId(provider: AgentProvider): string | undefined {
  if (provider === "codex") {
    return (
      normalizeOptionalString(process.env.CODEX_THREAD_ID) ??
      normalizeOptionalString(process.env.CODEX_SESSION_ID) ??
      normalizeOptionalString(process.env.CODEX_CONVERSATION_ID)
    );
  }
  if (provider === "claude-code") {
    return (
      normalizeOptionalString(process.env.CLAUDE_CODE_SESSION_ID) ??
      normalizeOptionalString(process.env.CLAUDE_SESSION_ID)
    );
  }
  return normalizeOptionalString(process.env.MARGENT_AGENT_SESSION_ID);
}

function getCurrentAgentCwd(provider: AgentProvider): string | undefined {
  if (provider === "codex") {
    return normalizeOptionalString(process.env.CODEX_WORKSPACE) ?? process.cwd();
  }
  if (provider === "claude-code") {
    return normalizeOptionalString(process.env.CLAUDE_CODE_WORKSPACE) ?? process.cwd();
  }
  return normalizeOptionalString(process.env.MARGENT_AGENT_WORKSPACE) ?? process.cwd();
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAgentDocumentLinkLike(value: unknown): value is Partial<AgentDocumentLink> {
  return typeof value === "object" && value !== null && "version" in value;
}

function isCodexDocumentLinkLike(value: unknown): value is Partial<CodexDocumentLink> {
  return typeof value === "object" && value !== null && "version" in value;
}
