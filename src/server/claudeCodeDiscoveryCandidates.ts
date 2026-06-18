import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDiscoveryEvidence,
  inferDiscoveryCandidateRole,
  type AgentDiscoveryCandidate
} from "./agentDiscoveryTypes.js";

type ClaudeCodeSessionCandidate = {
  sessionId: string;
  cwd?: string;
  updatedAt: string;
  filePath: string;
};

const MAX_SESSION_FILES = 80;
const MAX_META_LINES = 80;

export async function findClaudeCodeDiscoveryCandidates(
  markdownPath: string
): Promise<AgentDiscoveryCandidate[]> {
  const candidates = await findExactPathCandidates(markdownPath);
  return candidates.map((candidate) => ({
    provider: "claude-code",
    role: inferDiscoveryCandidateRole(candidate.evidence),
    sessionId: candidate.sessionId,
    cwd: candidate.cwd,
    updatedAt: candidate.updatedAt,
    filePath: candidate.filePath,
    displayName: "Claude Code",
    evidence: candidate.evidence
  }));
}

async function findExactPathCandidates(
  markdownPath: string
): Promise<
  Array<ClaudeCodeSessionCandidate & { evidence: AgentDiscoveryCandidate["evidence"] }>
> {
  const sessionFiles = await listRecentSessionFiles();
  const normalizedPath = path.resolve(markdownPath);
  const escapedPath = JSON.stringify(normalizedPath).slice(1, -1);
  const candidates: Array<
    ClaudeCodeSessionCandidate & { evidence: AgentDiscoveryCandidate["evidence"] }
  > = [];

  for (const filePath of sessionFiles) {
    const raw = await readFileSafely(filePath);
    if (!raw || (!raw.includes(normalizedPath) && !raw.includes(escapedPath))) {
      continue;
    }

    const meta = readSessionMeta(raw, filePath);
    if (!meta.sessionId) {
      continue;
    }
    candidates.push({
      ...meta,
      evidence: createDiscoveryEvidence(raw, normalizedPath, escapedPath)
    });
  }

  const bySessionId = new Map<
    string,
    ClaudeCodeSessionCandidate & { evidence: AgentDiscoveryCandidate["evidence"] }
  >();
  for (const candidate of candidates) {
    const existing = bySessionId.get(candidate.sessionId);
    if (!existing || existing.updatedAt < candidate.updatedAt) {
      bySessionId.set(candidate.sessionId, candidate);
    }
  }
  return Array.from(bySessionId.values());
}

async function listRecentSessionFiles(): Promise<string[]> {
  const sessionRoot = path.join(os.homedir(), ".claude", "projects");
  const files: Array<{ path: string; mtimeMs: number }> = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const stat = fsSync.statSync(entryPath);
        files.push({ path: entryPath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  await walk(sessionRoot);
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_SESSION_FILES)
    .map((item) => item.path);
}

function readSessionMeta(raw: string, filePath: string): ClaudeCodeSessionCandidate {
  const lines = raw.split("\n", MAX_META_LINES);
  let sessionId = extractSessionIdFromFilename(filePath);
  let cwd: string | undefined;
  let updatedAt = new Date(fsSync.statSync(filePath).mtimeMs).toISOString();

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as {
        timestamp?: string;
        sessionId?: string;
        cwd?: string;
      };
      sessionId = normalizeOptionalString(parsed.sessionId) ?? sessionId;
      cwd = normalizeOptionalString(parsed.cwd) ?? cwd;
      if (sessionId && cwd) {
        break;
      }
    } catch {
      // Claude Code session logs are JSONL; malformed lines are ignored.
    }
  }

  return { sessionId, cwd, updatedAt, filePath };
}

async function readFileSafely(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function extractSessionIdFromFilename(filePath: string): string {
  const basename = path.basename(filePath, ".jsonl");
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    basename
  );
  return match?.[1] ?? basename;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
