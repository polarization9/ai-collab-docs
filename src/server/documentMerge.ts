import fs from "node:fs/promises";
import { createContentHash } from "./document.js";
import { parseMarkdownBlocks, type MarkdownBlock } from "./markdownBlocks.js";
import type {
  DocumentMergeConflict,
  DocumentMergeStatusRequest,
  DocumentMergeStatusResponse
} from "../shared/editTypes.js";

type DiffOperation = {
  start: number;
  end: number;
  insertText: string;
};

type LineSegment = {
  text: string;
  start: number;
  end: number;
};

type ChangeKey = string;

const LCS_CELL_LIMIT = 1_500_000;
const SNIPPET_LIMIT = 600;

export async function getDocumentMergeStatus(
  markdownPath: string,
  request: DocumentMergeStatusRequest
): Promise<DocumentMergeStatusResponse> {
  validateMergeStatusRequest(request);

  const externalContent = await fs.readFile(markdownPath, "utf8");
  return classifyDocumentMerge(request, externalContent);
}

export function classifyDocumentMerge(
  request: DocumentMergeStatusRequest,
  externalContent: string
): DocumentMergeStatusResponse {
  validateMergeStatusRequest(request);

  const externalContentHash = createContentHash(externalContent);
  if (externalContentHash === request.baseContentHash) {
    return { status: "unchanged", externalContentHash };
  }

  if (request.draftContent === request.baseContent) {
    return {
      status: "externalOnly",
      externalContent,
      externalContentHash
    };
  }

  const userOps = diffByLines(request.baseContent, request.draftContent);
  const externalOps = diffByLines(request.baseContent, externalContent);
  const blocks = parseMarkdownBlocks(request.baseContent).blocks;
  const userKeys = collectChangeKeys(userOps, blocks);
  const externalKeys = collectChangeKeys(externalOps, blocks);
  const conflictKeys = findConflictingKeys(userKeys, externalKeys, userOps, externalOps);

  if (conflictKeys.length > 0) {
    return {
      status: "conflict",
      externalContent,
      externalContentHash,
      conflicts: createConflictSummaries(
        conflictKeys,
        request.baseContent,
        blocks,
        userKeys,
        externalKeys
      )
    };
  }

  return {
    status: "merged",
    mergedContent: applyOperations(request.baseContent, [...userOps, ...externalOps]),
    externalContent,
    externalContentHash
  };
}

function validateMergeStatusRequest(request: DocumentMergeStatusRequest): void {
  if (typeof request !== "object" || request === null) {
    throw new Error("Merge status request is required.");
  }
  if (typeof request.baseContent !== "string") {
    throw new Error("baseContent is required.");
  }
  if (typeof request.baseContentHash !== "string" || !request.baseContentHash) {
    throw new Error("baseContentHash is required.");
  }
  if (typeof request.draftContent !== "string") {
    throw new Error("draftContent is required.");
  }
}

function diffByLines(baseContent: string, nextContent: string): DiffOperation[] {
  if (baseContent === nextContent) {
    return [];
  }

  const baseLines = splitLineSegments(baseContent);
  const nextLines = splitLineSegments(nextContent);
  if (baseLines.length * nextLines.length > LCS_CELL_LIMIT) {
    return [createFallbackOperation(baseContent, nextContent)];
  }

  const dp = Array.from({ length: baseLines.length + 1 }, () =>
    new Uint32Array(nextLines.length + 1)
  );

  for (let baseIndex = baseLines.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let nextIndex = nextLines.length - 1; nextIndex >= 0; nextIndex -= 1) {
      dp[baseIndex][nextIndex] =
        baseLines[baseIndex].text === nextLines[nextIndex].text
          ? dp[baseIndex + 1][nextIndex + 1] + 1
          : Math.max(dp[baseIndex + 1][nextIndex], dp[baseIndex][nextIndex + 1]);
    }
  }

  const matches: Array<[number, number]> = [];
  let baseCursor = 0;
  let nextCursor = 0;
  while (baseCursor < baseLines.length && nextCursor < nextLines.length) {
    if (baseLines[baseCursor].text === nextLines[nextCursor].text) {
      matches.push([baseCursor, nextCursor]);
      baseCursor += 1;
      nextCursor += 1;
      continue;
    }
    if (dp[baseCursor + 1][nextCursor] >= dp[baseCursor][nextCursor + 1]) {
      baseCursor += 1;
    } else {
      nextCursor += 1;
    }
  }

  matches.push([baseLines.length, nextLines.length]);
  const operations: DiffOperation[] = [];
  let previousBaseLine = 0;
  let previousNextLine = 0;

  for (const [matchedBaseLine, matchedNextLine] of matches) {
    if (matchedBaseLine > previousBaseLine || matchedNextLine > previousNextLine) {
      operations.push({
        start: lineStartOffset(baseContent, baseLines, previousBaseLine),
        end: lineStartOffset(baseContent, baseLines, matchedBaseLine),
        insertText: nextLines
          .slice(previousNextLine, matchedNextLine)
          .map((line) => line.text)
          .join("")
      });
    }

    previousBaseLine = matchedBaseLine + 1;
    previousNextLine = matchedNextLine + 1;
  }

  return operations.filter(
    (operation) => operation.start !== operation.end || operation.insertText.length > 0
  );
}

function splitLineSegments(content: string): LineSegment[] {
  const segments: LineSegment[] = [];
  const rawLines = content.split("\n");
  let offset = 0;

  rawLines.forEach((rawLine, index) => {
    const hasLineBreak = index < rawLines.length - 1;
    const text = `${rawLine}${hasLineBreak ? "\n" : ""}`;
    const start = offset;
    const end = start + text.length;
    segments.push({ text, start, end });
    offset = end;
  });

  return segments;
}

function lineStartOffset(content: string, lines: LineSegment[], lineIndex: number): number {
  return lineIndex >= lines.length ? content.length : lines[lineIndex].start;
}

function createFallbackOperation(baseContent: string, nextContent: string): DiffOperation {
  let prefix = 0;
  while (
    prefix < baseContent.length &&
    prefix < nextContent.length &&
    baseContent[prefix] === nextContent[prefix]
  ) {
    prefix += 1;
  }

  let baseSuffix = baseContent.length;
  let nextSuffix = nextContent.length;
  while (
    baseSuffix > prefix &&
    nextSuffix > prefix &&
    baseContent[baseSuffix - 1] === nextContent[nextSuffix - 1]
  ) {
    baseSuffix -= 1;
    nextSuffix -= 1;
  }

  return {
    start: prefix,
    end: baseSuffix,
    insertText: nextContent.slice(prefix, nextSuffix)
  };
}

function collectChangeKeys(
  operations: DiffOperation[],
  blocks: MarkdownBlock[]
): Map<ChangeKey, DiffOperation[]> {
  const keys = new Map<ChangeKey, DiffOperation[]>();

  for (const operation of operations) {
    const operationKeys =
      operation.start === operation.end
        ? keysForInsertion(operation.start, blocks)
        : keysForRange(operation.start, operation.end, blocks);

    for (const key of operationKeys) {
      const operationsForKey = keys.get(key) ?? [];
      operationsForKey.push(operation);
      keys.set(key, operationsForKey);
    }
  }

  return keys;
}

function keysForRange(start: number, end: number, blocks: MarkdownBlock[]): ChangeKey[] {
  const keys = blocks
    .filter((block) => block.end > start && block.start < end)
    .map((block) => keyForBlock(block, blocks));

  return unique(keys.length > 0 ? keys : [keyForNearestBoundary(start, blocks)]);
}

function keysForInsertion(offset: number, blocks: MarkdownBlock[]): ChangeKey[] {
  const containingBlock = blocks.find((block) => offset > block.start && offset < block.end);
  if (containingBlock) {
    return [keyForBlock(containingBlock, blocks)];
  }
  return [keyForNearestBoundary(offset, blocks)];
}

function keyForBlock(block: MarkdownBlock, blocks: MarkdownBlock[]): ChangeKey {
  if (block.kind !== "list-item" && block.kind !== "blockquote") {
    return `block:${block.index}`;
  }

  let start = block.index;
  let end = block.index;

  for (let cursor = block.index - 1; cursor >= 0; cursor -= 1) {
    const previous = blocks[cursor];
    if (!previous || previous.kind !== block.kind || previous.headingId !== block.headingId) {
      break;
    }
    start = previous.index;
  }

  for (let cursor = block.index + 1; cursor < blocks.length; cursor += 1) {
    const next = blocks[cursor];
    if (!next || next.kind !== block.kind || next.headingId !== block.headingId) {
      break;
    }
    end = next.index;
  }

  return `${block.kind}:${start}:${end}`;
}

function keyForNearestBoundary(offset: number, blocks: MarkdownBlock[]): ChangeKey {
  const previous = [...blocks].reverse().find((block) => block.end <= offset);
  const next = blocks.find((block) => block.start >= offset);
  return `between:${previous?.index ?? "start"}:${next?.index ?? "end"}`;
}

function findConflictingKeys(
  userKeys: Map<ChangeKey, DiffOperation[]>,
  externalKeys: Map<ChangeKey, DiffOperation[]>,
  userOps: DiffOperation[],
  externalOps: DiffOperation[]
): ChangeKey[] {
  const conflicts = [...userKeys.keys()].filter((key) => externalKeys.has(key));

  for (const userOp of userOps) {
    for (const externalOp of externalOps) {
      if (operationsOverlap(userOp, externalOp) && !conflicts.includes("range-overlap")) {
        conflicts.push("range-overlap");
      }
      if (
        userOp.start === userOp.end &&
        externalOp.start === externalOp.end &&
        userOp.start === externalOp.start &&
        !conflicts.includes(`insert:${userOp.start}`)
      ) {
        conflicts.push(`insert:${userOp.start}`);
      }
    }
  }

  return conflicts;
}

function operationsOverlap(left: DiffOperation, right: DiffOperation): boolean {
  if (left.start === left.end || right.start === right.end) {
    return false;
  }
  return left.end > right.start && right.end > left.start;
}

function createConflictSummaries(
  conflictKeys: ChangeKey[],
  baseContent: string,
  blocks: MarkdownBlock[],
  userKeys: Map<ChangeKey, DiffOperation[]>,
  externalKeys: Map<ChangeKey, DiffOperation[]>
): DocumentMergeConflict[] {
  return conflictKeys.slice(0, 8).map((key, index) => {
    const block = blockForKey(key, blocks);
    const userOps = userKeys.get(key) ?? [];
    const externalOps = externalKeys.get(key) ?? [];
    return {
      id: `conflict-${index + 1}`,
      blockKind: block?.kind ?? "boundary",
      headingText: block?.headingText ?? null,
      baseSnippet: snippet(block ? block.text : ""),
      draftSnippet: snippet(userOps.map((operation) => operation.insertText).join("\n")),
      externalSnippet: snippet(externalOps.map((operation) => operation.insertText).join("\n"))
    };
  });
}

function blockForKey(key: ChangeKey, blocks: MarkdownBlock[]): MarkdownBlock | null {
  const blockMatch = key.match(/^block:(\d+)$/);
  if (blockMatch) {
    return blocks.find((block) => block.index === Number(blockMatch[1])) ?? null;
  }
  const groupMatch = key.match(/^(list-item|blockquote):(\d+):(\d+)$/);
  if (groupMatch) {
    const start = Number(groupMatch[2]);
    const end = Number(groupMatch[3]);
    const groupBlocks = blocks.filter((block) => block.index >= start && block.index <= end);
    const first = groupBlocks[0];
    return first
      ? {
          ...first,
          text: groupBlocks.map((block) => block.text).join("")
        }
      : null;
  }
  return null;
}

function applyOperations(baseContent: string, operations: DiffOperation[]): string {
  return [...operations]
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce(
      (content, operation) =>
        `${content.slice(0, operation.start)}${operation.insertText}${content.slice(operation.end)}`,
      baseContent
    );
}

function snippet(text: string): string {
  const compact = text.trim();
  if (compact.length <= SNIPPET_LIMIT) {
    return compact;
  }
  const half = Math.floor((SNIPPET_LIMIT - 5) / 2);
  return `${compact.slice(0, half)} ... ${compact.slice(-half)}`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
