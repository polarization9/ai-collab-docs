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

export function parseMarkdownBlocks(markdown: string): ParsedMarkdownBlocks {
  const headings = parseHeadings(markdown);
  const blocks: Omit<MarkdownBlock, "fingerprint">[] = [];
  const lines = markdown.split(/\r?\n/);
  let offset = 0;
  let index = 0;
  let headingIndex = 0;
  let currentHeading: Heading | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const nextOffset = lineEnd + 1;

    if (!line.trim()) {
      offset = nextOffset;
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
        const closeMatch = lines[cursor].match(/^ {0,3}(`{3,}|~{3,})/);
        const closeMarker = closeMatch?.[1]?.[0];
        const closeLength = closeMatch?.[1]?.length ?? 0;
        endOffset += lines[cursor].length + 1;
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
      offset = endOffset;
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = headings[headingIndex++] ?? currentHeading;
      blocks.push(createBlock(markdown, index++, "heading", lineStart, nextOffset, currentHeading));
      offset = nextOffset;
      continue;
    }

    if (isTableStart(lines, lineIndex)) {
      const tableStart = lineStart;
      let endOffset = nextOffset;
      let endLineIndex = lineIndex;
      for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
        if (!looksLikeTableLine(lines[cursor])) {
          break;
        }
        endOffset += lines[cursor].length + 1;
        endLineIndex = cursor;
      }
      blocks.push(createBlock(markdown, index++, "table", tableStart, endOffset, currentHeading));
      lineIndex = endLineIndex;
      offset = endOffset;
      continue;
    }

    if (/^ {0,3}([-*+]|\d+[.)])\s+/.test(line)) {
      blocks.push(createBlock(markdown, index++, "list-item", lineStart, nextOffset, currentHeading));
      offset = nextOffset;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      blocks.push(createBlock(markdown, index++, "blockquote", lineStart, nextOffset, currentHeading));
      offset = nextOffset;
      continue;
    }

    const paragraphStart = lineStart;
    let paragraphEnd = nextOffset;
    let paragraphEndLineIndex = lineIndex;
    for (let cursor = lineIndex + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
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
      paragraphEnd += candidate.length + 1;
      paragraphEndLineIndex = cursor;
    }
    blocks.push(
      createBlock(markdown, index++, "paragraph", paragraphStart, paragraphEnd, currentHeading)
    );
    lineIndex = paragraphEndLineIndex;
    offset = paragraphEnd;
  }

  return {
    headings,
    blocks: addNeighborFingerprints(blocks)
  };
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

function isTableStart(lines: string[], lineIndex: number): boolean {
  return looksLikeTableLine(lines[lineIndex]) && looksLikeTableDivider(lines[lineIndex + 1] ?? "");
}

function looksLikeTableLine(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

function looksLikeTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
