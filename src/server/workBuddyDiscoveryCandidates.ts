import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDiscoveryEvidence,
  inferDiscoveryCandidateRole,
  type AgentDiscoveryCandidate
} from "./agentDiscoveryTypes.js";

type WorkBuddySessionCandidate = {
  sessionId: string;
  cwd?: string;
  updatedAt: string;
  filePath: string;
};

const MAX_SESSION_FILES = 80;
const MAX_META_LINES = 120;

export async function findWorkBuddyDiscoveryCandidates(
  markdownPath: string
): Promise<AgentDiscoveryCandidate[]> {
  const candidates = await findExactPathCandidates(markdownPath);
  return candidates.map((candidate) => ({
    provider: "workbuddy",
    role: inferDiscoveryCandidateRole(candidate.evidence),
    sessionId: candidate.sessionId,
    cwd: candidate.cwd,
    updatedAt: candidate.updatedAt,
    filePath: candidate.filePath,
    displayName: "WorkBuddy",
    evidence: candidate.evidence
  }));
}

async function findExactPathCandidates(
  markdownPath: string
): Promise<
  Array<WorkBuddySessionCandidate & { evidence: AgentDiscoveryCandidate["evidence"] }>
> {
  const sessionFiles = await listRecentSessionFiles();
  const normalizedPath = path.resolve(markdownPath);
  const escapedPath = JSON.stringify(normalizedPath).slice(1, -1);
  const candidates: Array<
    WorkBuddySessionCandidate & { evidence: AgentDiscoveryCandidate["evidence"] }
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
    WorkBuddySessionCandidate & { evidence: AgentDiscoveryCandidate["evidence"] }
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
  const sessionRoot = path.join(os.homedir(), ".workbuddy", "projects");
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

function readSessionMeta(raw: string, filePath: string): WorkBuddySessionCandidate {
  const lines = raw.split("\n", MAX_META_LINES);
  let sessionId = extractSessionIdFromFilename(filePath);
  let cwd: string | undefined;
  let updatedAtMs = fsSync.statSync(filePath).mtimeMs;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as {
        timestamp?: string | number;
        sessionId?: string;
        cwd?: string;
      };
      sessionId = normalizeOptionalString(parsed.sessionId) ?? sessionId;
      cwd = normalizeOptionalString(parsed.cwd) ?? cwd;
      updatedAtMs = Math.max(updatedAtMs, normalizeTimestampMs(parsed.timestamp) ?? 0);
    } catch {
      // WorkBuddy session logs are JSONL; malformed lines are ignored.
    }
  }

  return {
    sessionId,
    cwd,
    updatedAt: new Date(updatedAtMs).toISOString(),
    filePath
  };
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
  const match =
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      basename
    );
  return match?.[1] ?? basename;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
