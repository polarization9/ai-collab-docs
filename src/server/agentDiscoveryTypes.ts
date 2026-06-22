import type { AgentProvider, AgentSessionRole } from "../shared/agentTypes.js";

export type AgentDiscoveryEvidence = {
  explicitBindCount: number;
  margentOperationCount: number;
  documentEditSignalCount: number;
  pathMentionCount: number;
  sourceRoleCount: number;
  successorRoleCount: number;
};

export type AgentDiscoveryCandidate = {
  provider: AgentProvider;
  role: AgentSessionRole;
  sessionId: string;
  cwd?: string;
  updatedAt: string;
  filePath: string;
  displayName: string;
  evidence: AgentDiscoveryEvidence;
};

const EXPLICIT_BIND_PATTERNS = [
  "reviewer_bind_current_codex_thread",
  "reviewer_bind_current_agent_session"
];

const MARGENT_OPERATION_PATTERNS = [
  "reviewer_get_annotation_context",
  "reviewer_add_annotation_reply",
  "reviewer_apply_document_edit",
  "reviewer_update_annotation_status",
  "reviewer_mark_review_event_handled",
  "reviewer_list_review_events",
  "reviewer_get_review_event",
  "reviewer_get_review_events"
];

const DOCUMENT_EDIT_PATTERNS = [
  "reviewer_apply_document_edit",
  "apply_patch",
  "*** Add File:",
  "*** Update File:",
  "Write",
  "Edit",
  "MultiEdit",
  "writeFile",
  "write_file",
  "fs.writeFile"
];

export function createDiscoveryEvidence(
  raw: string,
  normalizedPath: string,
  escapedPath: string
): AgentDiscoveryEvidence {
  const structured = createStructuredEvidence(raw, normalizedPath, escapedPath);
  return {
    explicitBindCount: structured.explicitBindCount,
    margentOperationCount: structured.margentOperationCount,
    documentEditSignalCount: structured.documentEditSignalCount,
    sourceRoleCount: structured.sourceRoleCount,
    successorRoleCount: structured.successorRoleCount,
    pathMentionCount:
      countOccurrences(raw, normalizedPath) +
      (escapedPath === normalizedPath ? 0 : countOccurrences(raw, escapedPath))
  };
}

function createStructuredEvidence(
  raw: string,
  normalizedPath: string,
  escapedPath: string
): Omit<AgentDiscoveryEvidence, "pathMentionCount"> {
  const lines = raw.split("\n");
  const evidence: Omit<AgentDiscoveryEvidence, "pathMentionCount"> = {
    explicitBindCount: 0,
    margentOperationCount: 0,
    documentEditSignalCount: 0,
    sourceRoleCount: 0,
    successorRoleCount: 0
  };

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    addQueueOperationEvidence(evidence, parsed, normalizedPath, escapedPath);
    addToolUseEvidence(evidence, parsed, normalizedPath, escapedPath);
  }

  return evidence;
}

function addQueueOperationEvidence(
  evidence: Omit<AgentDiscoveryEvidence, "pathMentionCount">,
  parsed: Record<string, unknown>,
  normalizedPath: string,
  escapedPath: string
): void {
  if (parsed.type !== "queue-operation" || parsed.operation !== "enqueue") {
    return;
  }

  const content = typeof parsed.content === "string" ? parsed.content : "";
  if (!mentionsDocument(content, normalizedPath, escapedPath)) {
    return;
  }

  evidence.margentOperationCount += 1;
  incrementRoleEvidence(evidence, extractSessionRole(content));
}

function addToolUseEvidence(
  evidence: Omit<AgentDiscoveryEvidence, "pathMentionCount">,
  parsed: Record<string, unknown>,
  normalizedPath: string,
  escapedPath: string
): void {
  const toolUses = extractToolUses(parsed);
  for (const toolUse of toolUses) {
    const toolName = normalizeToolName(toolUse.name);
    if (!toolName || !mentionsDocument(toolUse.input, normalizedPath, escapedPath)) {
      continue;
    }

    if (EXPLICIT_BIND_PATTERNS.includes(toolName)) {
      evidence.explicitBindCount += 1;
      incrementRoleEvidence(evidence, extractSessionRole(toolUse.input));
    }
    if (MARGENT_OPERATION_PATTERNS.includes(toolName)) {
      evidence.margentOperationCount += 1;
    }
    if (DOCUMENT_EDIT_PATTERNS.includes(toolName)) {
      evidence.documentEditSignalCount += 1;
    }
  }
}

type DiscoveryToolUse = {
  name?: unknown;
  input?: unknown;
};

export function inferDiscoveryCandidateRole(
  evidence: AgentDiscoveryEvidence
): AgentSessionRole {
  return evidence.successorRoleCount > evidence.sourceRoleCount ? "successor" : "source";
}

function extractToolUses(parsed: Record<string, unknown>): DiscoveryToolUse[] {
  const toolUses: DiscoveryToolUse[] = [];
  if (parsed.type === "function_call") {
    toolUses.push({ name: parsed.name, input: parsed.arguments });
  }

  const payload = isRecord(parsed.payload) ? parsed.payload : undefined;
  if (payload?.type === "function_call") {
    toolUses.push({ name: payload.name, input: payload.arguments });
  }

  const message = isRecord(parsed.message) ? parsed.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : [];
  toolUses.push(...content.filter(isToolUseLike));
  return toolUses;
}

function isToolUseLike(value: unknown): value is DiscoveryToolUse {
  return isRecord(value) && value.type === "tool_use";
}

function normalizeToolName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.startsWith("mcp__margent__")
    ? value.slice("mcp__margent__".length)
    : value;
}

function mentionsDocument(value: unknown, normalizedPath: string, escapedPath: string): boolean {
  if (typeof value === "string") {
    return value.includes(normalizedPath) || value.includes(escapedPath);
  }
  if (value === null || value === undefined) {
    return false;
  }
  return mentionsDocument(JSON.stringify(value), normalizedPath, escapedPath);
}

function incrementRoleEvidence(
  evidence: Omit<AgentDiscoveryEvidence, "pathMentionCount">,
  role: AgentSessionRole | undefined
): void {
  if (role === "source") {
    evidence.sourceRoleCount += 1;
  } else if (role === "successor") {
    evidence.successorRoleCount += 1;
  }
}

function extractSessionRole(value: unknown): AgentSessionRole | undefined {
  if (typeof value === "string") {
    const textRole = extractSessionRoleFromText(value);
    if (textRole) {
      return textRole;
    }
    try {
      return extractSessionRole(JSON.parse(value) as unknown);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (isAgentSessionRole(value.role)) {
    return value.role;
  }
  if (isAgentSessionRole(value.targetRole)) {
    return value.targetRole;
  }
  return undefined;
}

function extractSessionRoleFromText(value: string): AgentSessionRole | undefined {
  const match = /目标会话类型[：:\s]+(source|successor)\b/.exec(value);
  if (isAgentSessionRole(match?.[1])) {
    return match[1];
  }
  return undefined;
}

function isAgentSessionRole(value: unknown): value is AgentSessionRole {
  return value === "source" || value === "successor";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function countAny(raw: string, patterns: string[]): number {
  return patterns.reduce((total, pattern) => total + countOccurrences(raw, pattern), 0);
}

function countOccurrences(raw: string, pattern: string): number {
  if (!pattern) {
    return 0;
  }

  let count = 0;
  let index = raw.indexOf(pattern);
  while (index >= 0) {
    count += 1;
    index = raw.indexOf(pattern, index + pattern.length);
  }
  return count;
}
