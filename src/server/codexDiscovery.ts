import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodexDocumentLink } from "../shared/codexTypes.js";
import {
  applyDiscoveredCodexSource,
  loadCodexDocumentLink
} from "./codexLink.js";

type SessionCandidate = {
  threadId: string;
  cwd?: string;
  updatedAt: string;
  filePath: string;
};

const MAX_SESSION_FILES = 40;

export async function discoverCodexSourceForDocument(
  markdownPath: string
): Promise<CodexDocumentLink | null> {
  const existing = await loadCodexDocumentLink(markdownPath);
  if (existing?.source?.threadId) {
    return existing;
  }

  const candidates = await findExactPathCandidates(markdownPath);
  if (candidates.length !== 1) {
    return null;
  }

  const candidate = candidates[0];
  const now = new Date().toISOString();
  return applyDiscoveredCodexSource(
    markdownPath,
    {
      type: "codex",
      threadId: candidate.threadId,
      cwd: candidate.cwd,
      createdAt: now,
      updatedAt: candidate.updatedAt
    },
    {
      type: "source",
      threadId: candidate.threadId,
      cwd: candidate.cwd,
      configuredAt: now,
      configuredBy: "codex",
      configuredVia: "local-log-discovery"
    }
  );
}

async function findExactPathCandidates(markdownPath: string): Promise<SessionCandidate[]> {
  const sessionFiles = await listRecentSessionFiles();
  const normalizedPath = path.resolve(markdownPath);
  const escapedPath = JSON.stringify(normalizedPath).slice(1, -1);
  const candidates: SessionCandidate[] = [];

  for (const filePath of sessionFiles) {
    const raw = await readFileSafely(filePath);
    if (!raw || (!raw.includes(normalizedPath) && !raw.includes(escapedPath))) {
      continue;
    }

    const meta = readSessionMeta(raw, filePath);
    if (!meta.threadId) {
      continue;
    }
    candidates.push(meta);
  }

  const byThreadId = new Map<string, SessionCandidate>();
  for (const candidate of candidates) {
    const existing = byThreadId.get(candidate.threadId);
    if (!existing || existing.updatedAt < candidate.updatedAt) {
      byThreadId.set(candidate.threadId, candidate);
    }
  }
  return Array.from(byThreadId.values());
}

async function listRecentSessionFiles(): Promise<string[]> {
  const sessionRoot = path.join(os.homedir(), ".codex", "sessions");
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

function readSessionMeta(raw: string, filePath: string): SessionCandidate {
  const firstLine = raw.split("\n", 1)[0];
  let threadId = extractThreadIdFromFilename(filePath);
  let cwd: string | undefined;
  let updatedAt = new Date(fsSync.statSync(filePath).mtimeMs).toISOString();

  try {
    const parsed = JSON.parse(firstLine) as {
      timestamp?: string;
      type?: string;
      payload?: {
        id?: string;
        cwd?: string;
        timestamp?: string;
      };
    };
    if (parsed.type === "session_meta") {
      threadId = parsed.payload?.id ?? threadId;
      cwd = parsed.payload?.cwd;
      updatedAt = parsed.payload?.timestamp ?? parsed.timestamp ?? updatedAt;
    }
  } catch {
    // The filename thread id is enough for the high-confidence exact-path match.
  }

  return { threadId, cwd, updatedAt, filePath };
}

async function readFileSafely(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function extractThreadIdFromFilename(filePath: string): string {
  const basename = path.basename(filePath, ".jsonl");
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    basename
  );
  return match?.[1] ?? basename;
}
