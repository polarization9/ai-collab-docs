import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { DEFAULT_DEEPSEEK_HARNESS_WEB_URL } from "./deepSeekHarnessBridge.js";
import {
  createDiscoveryEvidence,
  inferDiscoveryCandidateRole,
  type AgentDiscoveryCandidate
} from "./agentDiscoveryTypes.js";

type DeepSeekHarnessSessionMeta = {
  sessionId: string;
  cwd?: string;
  parentSessionId?: string;
  origin?: string;
};

type ZstdFrameRange = {
  start: number;
  end: number;
};

const MAX_SESSION_FILES = 80;
const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const ZSTD_MAGIC = 0xfd2fb528;

export async function findDeepSeekHarnessDiscoveryCandidates(
  markdownPath: string
): Promise<AgentDiscoveryCandidate[]> {
  const normalizedPath = path.resolve(markdownPath);
  const escapedPath = JSON.stringify(normalizedPath).slice(1, -1);
  const endpoint =
    normalizeOptionalString(process.env.DEEPSEEK_HARNESS_WEB_URL) ??
    normalizeOptionalString(process.env.DSH_WEB_URL) ??
    DEFAULT_DEEPSEEK_HARNESS_WEB_URL;
  const candidates: AgentDiscoveryCandidate[] = [];

  for (const item of await listRecentSessionFiles()) {
    const raw = await readSessionLog(item.filePath, item.size);
    if (!raw || (!raw.includes(normalizedPath) && !raw.includes(escapedPath))) {
      continue;
    }

    const meta = readSessionMeta(raw, item.filePath);
    // parentSession also records user forks; only an explicit origin marks a subagent.
    if (!meta.sessionId || meta.origin === "subagent") {
      continue;
    }
    const evidence = createDiscoveryEvidence(raw, normalizedPath, escapedPath);
    candidates.push({
      provider: "deepseek-harness",
      role: inferDiscoveryCandidateRole(evidence),
      sessionId: meta.sessionId,
      cwd: meta.cwd,
      endpoint,
      updatedAt: new Date(item.mtimeMs).toISOString(),
      filePath: item.filePath,
      displayName: "DeepSeek Harness",
      evidence
    });
  }

  const bySessionId = new Map<string, AgentDiscoveryCandidate>();
  for (const candidate of candidates) {
    const existing = bySessionId.get(candidate.sessionId);
    if (!existing || existing.updatedAt < candidate.updatedAt) {
      bySessionId.set(candidate.sessionId, candidate);
    }
  }
  return Array.from(bySessionId.values());
}

async function listRecentSessionFiles(): Promise<
  Array<{ filePath: string; mtimeMs: number; size: number }>
> {
  const configuredHome =
    normalizeOptionalString(process.env.DEEPSEEK_HARNESS_HOME) ??
    normalizeOptionalString(process.env.DSH_HOME);
  const sessionRoot = path.join(configuredHome ?? path.join(os.homedir(), ".dsh"), "sessions");
  const files: Array<{ filePath: string; mtimeMs: number; size: number }> = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (
        entry.isFile() &&
        (entry.name === "session.jsonl.zstd" || entry.name === "session.jsonl")
      ) {
        const stat = await fs.stat(entryPath).catch(() => null);
        if (stat) {
          files.push({ filePath: entryPath, mtimeMs: stat.mtimeMs, size: stat.size });
        }
      }
    }
  }

  await walk(sessionRoot);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSION_FILES);
}

async function readSessionLog(filePath: string, size: number): Promise<string | null> {
  if (size <= 0 || size > MAX_COMPRESSED_BYTES) {
    return null;
  }
  try {
    const buffer = await fs.readFile(filePath);
    if (!filePath.endsWith(".zstd")) {
      return buffer.toString("utf8");
    }
    return decodeZstdSessionFrames(buffer);
  } catch {
    return null;
  }
}

function decodeZstdSessionFrames(buffer: Buffer): string | null {
  const decompress = (
    zlib as unknown as { zstdDecompressSync?: (source: Buffer) => Buffer }
  ).zstdDecompressSync;
  if (!decompress) {
    return null;
  }

  const frames = scanZstdFrames(buffer);
  if (frames.length === 0) {
    return null;
  }

  const header = decompress(buffer.subarray(frames[0].start, frames[0].end));
  let decodedBytes = header.length;
  const tail: Buffer[] = [];
  for (let index = frames.length - 1; index >= 1; index -= 1) {
    const frame = frames[index];
    const decoded = decompress(buffer.subarray(frame.start, frame.end));
    if (decodedBytes + decoded.length > MAX_DECOMPRESSED_BYTES) {
      break;
    }
    decodedBytes += decoded.length;
    tail.push(decoded);
  }

  return Buffer.concat([header, ...tail.reverse()], decodedBytes).toString("utf8");
}

function scanZstdFrames(buffer: Buffer): ZstdFrameRange[] {
  const frames: ZstdFrameRange[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      break;
    }
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) {
      break;
    }

    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes =
      contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeader = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeader) {
      break;
    }
    offset += remainingHeader;

    let complete = false;
    while (buffer.length - offset >= 3) {
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        return frames;
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        return frames;
      }
      offset += payloadBytes;
      if (lastBlock) {
        complete = true;
        break;
      }
    }
    if (!complete || (checksum && buffer.length - offset < 4)) {
      break;
    }
    if (checksum) {
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

function readSessionMeta(raw: string, filePath: string): DeepSeekHarnessSessionMeta {
  const firstLine = raw.split("\n", 1)[0];
  try {
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    return {
      sessionId:
        normalizeOptionalString(parsed.id) ??
        normalizeOptionalString(parsed.sessionId) ??
        path.basename(path.dirname(filePath)),
      cwd: normalizeOptionalString(parsed.cwd),
      parentSessionId:
        normalizeOptionalString(parsed.parentSession) ??
        normalizeOptionalString(parsed.parentSessionId),
      origin: normalizeOptionalString(parsed.origin)
    };
  } catch {
    return { sessionId: path.basename(path.dirname(filePath)) };
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
