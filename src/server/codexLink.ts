import type {
  CodexDocumentLink,
  CodexLinkConnection,
  CodexLinkResponse,
  CodexTargetReference,
  CodexTargetType,
  SuccessorInstructionResponse,
  UpdateCodexLinkRequest
} from "../shared/codexTypes.js";
import type { AgentSessionReference } from "../shared/agentTypes.js";
import {
  agentLinkToCodexLink,
  applyDiscoveredAgentSource,
  bindAgentSession,
  codexLinkToAgentLink,
  createAgentSuccessorInstruction,
  getAgentLinkResponse,
  loadAgentDocumentLink,
  saveAgentDocumentLink,
  updateAgentDocumentLink
} from "./agentLink.js";
import { getCodexLinkPath } from "./paths.js";

export async function loadCodexDocumentLink(
  markdownPath: string
): Promise<CodexDocumentLink | null> {
  return agentLinkToCodexLink(await loadAgentDocumentLink(markdownPath));
}

export async function saveCodexDocumentLink(
  markdownPath: string,
  link: CodexDocumentLink
): Promise<CodexDocumentLink> {
  const saved = await saveAgentDocumentLink(markdownPath, codexLinkToAgentLink(link, markdownPath));
  const codexLink = agentLinkToCodexLink(saved);
  return codexLink ?? createEmptyCodexDocumentLink(markdownPath);
}

export async function updateCodexDocumentLink(
  markdownPath: string,
  request: UpdateCodexLinkRequest
): Promise<CodexDocumentLink> {
  const updated = await updateAgentDocumentLink(markdownPath, {
    source: request.source ? codexSourceToAgentSession(request.source) : undefined,
    target: request.target ? codexTargetToAgentSession(request.target) : undefined,
    bridge: request.bridge
  });
  const codexLink = agentLinkToCodexLink(updated);
  return codexLink ?? createEmptyCodexDocumentLink(markdownPath);
}

export async function applyDiscoveredCodexSource(
  markdownPath: string,
  source: NonNullable<CodexDocumentLink["source"]>,
  target: CodexTargetReference
): Promise<CodexDocumentLink> {
  const updated = await applyDiscoveredAgentSource(
    markdownPath,
    codexSourceToAgentSession(source),
    codexTargetToAgentSession(target)
  );
  const codexLink = agentLinkToCodexLink(updated);
  return codexLink ?? createEmptyCodexDocumentLink(markdownPath);
}

export async function getCodexLinkResponse(markdownPath: string): Promise<CodexLinkResponse> {
  const agentResponse = await getAgentLinkResponse(markdownPath);
  const link = agentLinkToCodexLink(agentResponse.link);
  const target = resolveCodexTarget(link);
  const connection: CodexLinkConnection = {
    hasSource: Boolean(getSourceThreadId(link)),
    hasTarget: Boolean(target?.threadId),
    targetType: target?.type ?? null,
    autoSendNewAnnotations: agentResponse.connection.autoSendNewAnnotations,
    sourceAvailable: link?.source?.threadId ? null : false
  };

  return {
    documentPath: markdownPath,
    codexLinkPath: getCodexLinkPath(markdownPath),
    link,
    connection
  };
}

export function createEmptyCodexDocumentLink(markdownPath: string): CodexDocumentLink {
  return {
    version: 1,
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
  const instruction = createAgentSuccessorInstruction(markdownPath, "codex");
  return {
    documentPath: instruction.documentPath,
    instruction: instruction.instruction.replace(
      "请把你当前这个 Agent 会话绑定为 Margent 的接续对话。",
      "请把你当前这个 Codex 会话绑定为 Margent 的接续对话。"
    )
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
  const updated = await bindAgentSession(markdownPath, {
    provider: "codex",
    role: input.role,
    sessionId: input.threadId,
    cwd: input.cwd,
    displayName: "Codex",
    autoSendNewAnnotations: input.autoSendNewAnnotations
  });
  const codexLink = agentLinkToCodexLink(updated);
  return codexLink ?? createEmptyCodexDocumentLink(markdownPath);
}

function codexSourceToAgentSession(
  source: NonNullable<CodexDocumentLink["source"]>
): AgentSessionReference {
  return {
    provider: "codex",
    role: "source",
    sessionId: source.threadId,
    turnId: source.turnId,
    cwd: source.cwd,
    displayName: "Codex",
    configuredAt: source.updatedAt ?? source.createdAt,
    configuredBy: "agent",
    configuredVia: "source"
  };
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
