import { parseHeadings } from "./markdownHeadings.js";
import type { BlockFingerprint } from "./reviewTypes.js";
import type { Heading } from "./types.js";

export type MarkdownBlockKind =
  | "heading"
  | "paragraph"
  | "list-item"
  | "blockquote"
  | "code"
  | "mermaid"
  | "table"
  | "thematic-break";

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

    if (isThematicBreak(line)) {
      blocks.push(
        createBlock(markdown, index++, "thematic-break", lineStart, nextOffset, currentHeading)
      );
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
        isThematicBreak(candidate) ||
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
    .replace(/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/gm, "")
    .replace(/[*~]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function textHash(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }

  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((highBits >>> shift) & 0xff);
  }
  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((lowBits >>> shift) & 0xff);
  }

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    const words = new Array<number>(80);
    for (let index = 0; index < 16; index += 1) {
      const offset = chunkStart + index * 4;
      words[index] =
        ((bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3]) >>>
        0;
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotateLeft(
        words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16],
        1
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      const { f, k } = getSha1Round(index, b, c, d);
      const temp = (rotateLeft(a, 5) + f + e + k + words[index]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("")
    .slice(0, 16);
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint > 0xffff) {
      index += 1;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function getSha1Round(index: number, b: number, c: number, d: number): { f: number; k: number } {
  if (index < 20) {
    return { f: (b & c) | (~b & d), k: 0x5a827999 };
  }
  if (index < 40) {
    return { f: b ^ c ^ d, k: 0x6ed9eba1 };
  }
  if (index < 60) {
    return { f: (b & c) | (b & d) | (c & d), k: 0x8f1bbcdc };
  }
  return { f: b ^ c ^ d, k: 0xca62c1d6 };
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

function isThematicBreak(line: string): boolean {
  return /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
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
