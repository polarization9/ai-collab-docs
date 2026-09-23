import path from "node:path";
import { parse as parseShell } from "shell-quote";
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
  endpoint?: string;
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
  "Write",
  "Edit",
  "MultiEdit",
  "write",
  "edit",
  "multiedit",
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
    addToolUseEvidence(evidence, parsed, normalizedPath);
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
  normalizedPath: string
): void {
  const toolUses = extractToolUses(parsed);
  for (const toolUse of toolUses) {
    const operation = resolveToolOperation(toolUse);
    if (!operation || !operatesOnDocument(operation, normalizedPath)) {
      continue;
    }

    const toolName = operation.name;
    if (EXPLICIT_BIND_PATTERNS.includes(toolName)) {
      evidence.explicitBindCount += 1;
      incrementRoleEvidence(evidence, extractSessionRole(operation.input));
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

type ToolOperation = { name: string; input: unknown };

function parseToolInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function resolveToolOperation(tool: DiscoveryToolUse): ToolOperation | null {
  const name = normalizeToolName(tool.name);
  if (!name) return null;
  const input = parseToolInput(tool.input);
  if (["bash", "Bash", "exec_command", "shell_command"].includes(name)) {
    const command = isRecord(input) ? input.command ?? input.cmd : input;
    return typeof command === "string" ? parseMcporterCall(command) : null;
  }
  return { name, input };
}

function parseMcporterCall(command: string): ToolOperation | null {
  // Only recognize a single direct call. Scripts, searches and echoed examples
  // are path mentions, not evidence that Margent was called.
  if (/[\r\n`]/.test(command)) return null;
  try {
    const tokens = parseShell(command, () => { throw new Error("Dynamic shell argument"); });
    if (!tokens.every((token): token is string => typeof token === "string")) return null;
    const [executable, subcommand, selector, ...args] = tokens;
    if (!executable || path.basename(executable) !== "mcporter" || subcommand !== "call") return null;
    const match = /^(?:margent|prd_reviewer)\.(reviewer_\w+)$/.exec(selector ?? "");
    if (!match) return null;
    const input: Record<string, unknown> = Object.create(null);
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--output" && ["json", "text", "raw", "markdown"].includes(args[index + 1])) {
        index += 1;
        continue;
      }
      const entries = arg === "--args"
        ? parseToolInput(args[++index])
        : (() => {
            const pair = /^([a-zA-Z]\w*)[=:](.*)$/.exec(arg);
            return pair ? { [pair[1]]: pair[2] } : null;
          })();
      if (!isRecord(entries) || Array.isArray(entries)) return null;
      for (const [key, value] of Object.entries(entries)) {
        if (Object.hasOwn(input, key)) return null;
        input[key] = value;
      }
    }
    return { name: match[1], input };
  } catch {
    return null;
  }
}

function operatesOnDocument(operation: ToolOperation, normalizedPath: string): boolean {
  const { name, input } = operation;
  const matchesPath = (value: unknown) =>
    typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === normalizedPath;
  if (name.startsWith("reviewer_")) {
    return isRecord(input) && matchesPath(input.documentPath);
  }
  if (name === "apply_patch") {
    const patch = typeof input === "string" ? input : isRecord(input) ? input.patch ?? input.input : undefined;
    return typeof patch === "string" && patch.split(/\r?\n/).some(line => {
      const match = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/.exec(line);
      return match && matchesPath(match[1]);
    });
  }
  if (!DOCUMENT_EDIT_PATTERNS.includes(name)) return false;
  if (Array.isArray(input)) return matchesPath(input[0]);
  return isRecord(input) && matchesPath(input.file_path ?? input.filePath ?? input.path ?? input.target_file);
}

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
  if (parsed.type === "custom_tool_call") {
    toolUses.push({ name: parsed.name, input: parsed.input });
  }

  const payload = isRecord(parsed.payload) ? parsed.payload : undefined;
  if (payload?.type === "function_call") {
    toolUses.push({ name: payload.name, input: payload.arguments });
  }
  if (payload?.type === "custom_tool_call") {
    toolUses.push({ name: payload.name, input: payload.input });
  }

  const message = isRecord(parsed.message) ? parsed.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : [];
  toolUses.push(...content.filter(isToolUseLike).map(normalizeStructuredToolUse));

  const data = isRecord(parsed.data) ? parsed.data : undefined;
  if (parsed.type === "tool/call" && data) {
    toolUses.push({ name: data.name, input: data.arguments });
  }
  const dataMessage = isRecord(data?.message) ? data.message : undefined;
  const dataContent = Array.isArray(dataMessage?.content) ? dataMessage.content : [];
  toolUses.push(...dataContent.filter(isToolUseLike).map(normalizeStructuredToolUse));
  return toolUses;
}

function isToolUseLike(value: unknown): value is DiscoveryToolUse {
  return isRecord(value) && (value.type === "tool_use" || value.type === "tool-call");
}

function normalizeStructuredToolUse(value: DiscoveryToolUse): DiscoveryToolUse {
  const record = value as Record<string, unknown>;
  return {
    name: record.name,
    input: record.input ?? record.arguments
  };
}

function normalizeToolName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const mcpTool = /^mcp__.+__(reviewer_.+)$/.exec(value);
  return mcpTool?.[1] ?? value;
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
  const match =
    /目标会话类型[：:\s]+(source|successor)\b/.exec(value) ??
    /(?:role|targetRole)["'\s:=]+(source|successor)\b/i.exec(value);
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
