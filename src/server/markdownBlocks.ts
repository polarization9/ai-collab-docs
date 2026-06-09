import crypto from "node:crypto";
import { parseHeadings } from "../shared/markdownHeadings.js";
import type { BlockFingerprint } from "../shared/reviewTypes.js";
import type { Heading } from "../shared/types.js";

export type MarkdownBlockKind =
  | "heading"
  | "paragraph"
  | "list-item"
  | "blockquote"
  | "code"
  | "mermaid"
  | "table";

export type MarkdownBlock = {
  id: string;
  index: number;
  kind: MarkdownBlockKind;
  start: number;
  end: number;
  text: string;
  normalizedText: string;
  heading: Heading | null;
  headingId: string | null;
  headingText: string | null;
  fingerprint: BlockFingerprint;
};

export type ParsedMarkdownBlocks = {
  headings: Heading[];
  blocks: MarkdownBlock[];
};

type MarkdownLine = {
  text: string;
  start: number;
  nextOffset: number;
};

export function parseMarkdownBlocks(markdown: string): ParsedMarkdownBlocks {
  const headings = parseHeadings(markdown);
  const blocks: Omit<MarkdownBlock, "fingerprint">[] = [];
  const lines = splitMarkdownLines(markdown);
  let index = 0;
  let headingIndex = 0;
  let currentHeading: Heading | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineRecord = lines[lineIndex];
    const line = lineRecord.text;
    const lineStart = lineRecord.start;
    const nextOffset = lineRecord.nextOffset;

    if (!line.trim()) {
      continue;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(\w+)?/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const fenceLength = fenceMatch[1].length;
      const language = fenceMatch[2] ?? "";
      let endLineIndex = lineIndex;
      let endOffset = nextOffset;

      for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
        const closeMatch = lines[cursor].text.match(/^ {0,3}(`{3,}|~{3,})/);
        const closeMarker = closeMatch?.[1]?.[0];
        const closeLength = closeMatch?.[1]?.length ?? 0;
        endOffset = lines[cursor].nextOffset;
        endLineIndex = cursor;
        if (closeMarker === marker && closeLength >= fenceLength) {
          break;
        }
      }

      blocks.push(
        createBlock(
          markdown,
          index++,
          language === "mermaid" ? "mermaid" : "code",
          lineStart,
          endOffset,
          currentHeading
        )
      );
      lineIndex = endLineIndex;
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = headings[headingIndex++] ?? currentHeading;
      blocks.push(createBlock(markdown, index++, "heading", lineStart, nextOffset, currentHeading));
      continue;
    }

    if (isTableStart(lines, lineIndex)) {
      const tableStart = lineStart;
      let endOffset = nextOffset;
      let endLineIndex = lineIndex;
      for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
        if (!looksLikeTableLine(lines[cursor].text)) {
          break;
        }
        endOffset = lines[cursor].nextOffset;
        endLineIndex = cursor;
      }
      blocks.push(createBlock(markdown, index++, "table", tableStart, endOffset, currentHeading));
      lineIndex = endLineIndex;
      continue;
    }

    if (/^ {0,3}([-*+]|\d+[.)])\s+/.test(line)) {
      blocks.push(createBlock(markdown, index++, "list-item", lineStart, nextOffset, currentHeading));
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      blocks.push(createBlock(markdown, index++, "blockquote", lineStart, nextOffset, currentHeading));
      continue;
    }

    const paragraphStart = lineStart;
    let paragraphEnd = nextOffset;
    let paragraphEndLineIndex = lineIndex;
    for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor].text;
      if (
        !candidate.trim() ||
        candidate.match(/^ {0,3}(#{1,6})\s+/) ||
        candidate.match(/^ {0,3}(`{3,}|~{3,})/) ||
        candidate.match(/^ {0,3}([-*+]|\d+[.)])\s+/) ||
        candidate.match(/^ {0,3}>\s?/) ||
        looksLikeTableLine(candidate)
      ) {
        break;
      }
      paragraphEnd = lines[cursor].nextOffset;
      paragraphEndLineIndex = cursor;
    }
    blocks.push(
      createBlock(markdown, index++, "paragraph", paragraphStart, paragraphEnd, currentHeading)
    );
    lineIndex = paragraphEndLineIndex;
  }

  return {
    headings,
    blocks: addNeighborFingerprints(blocks)
  };
}

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const rawLines = markdown.split("\n");
  let offset = 0;

  return rawLines.map((rawLine, index) => {
    const hasLineBreak = index < rawLines.length - 1;
    const text = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const start = offset;
    const nextOffset = start + rawLine.length + (hasLineBreak ? 1 : 0);
    offset = nextOffset;
    return { text, start, nextOffset };
  });
}

export function normalizeMarkdownText(text: string): string {
  return stripMarkdownSyntax(text).replace(/\s+/g, " ").trim().toLowerCase();
}

export function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/[*~]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function textHash(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
}

function createBlock(
  markdown: string,
  index: number,
  kind: MarkdownBlockKind,
  start: number,
  end: number,
  heading: Heading | null
): Omit<MarkdownBlock, "fingerprint"> {
  const text = markdown.slice(start, end);
  const normalizedText = normalizeMarkdownText(text);
  return {
    id: `block-${index}`,
    index,
    kind,
    start,
    end,
    text,
    normalizedText,
    heading,
    headingId: heading?.id ?? null,
    headingText: heading?.text ?? null
  };
}

function addNeighborFingerprints(blocks: Omit<MarkdownBlock, "fingerprint">[]): MarkdownBlock[] {
  return blocks.map((block, index) => {
    const previous = blocks[index - 1];
    const next = blocks[index + 1];
    return {
      ...block,
      fingerprint: {
        kind: block.kind,
        textHash: textHash(block.normalizedText),
        normalizedText: block.normalizedText,
        headingId: block.headingId,
        headingText: block.headingText,
        ...(previous ? { previousTextHash: textHash(previous.normalizedText) } : {}),
        ...(next ? { nextTextHash: textHash(next.normalizedText) } : {})
      }
    };
  });
}

function isTableStart(lines: MarkdownLine[], lineIndex: number): boolean {
  return (
    looksLikeTableLine(lines[lineIndex].text) &&
    looksLikeTableDivider(lines[lineIndex + 1]?.text ?? "")
  );
}

function looksLikeTableLine(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

function looksLikeTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
