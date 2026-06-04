import { parseHeadings } from "../shared/markdownHeadings.js";
import type { AnchorRepairResult, AnchorRepairSummary } from "../shared/editTypes.js";
import type {
  ReviewAnchor,
  ReviewAnnotation,
  ReviewFile
} from "../shared/reviewTypes.js";
import type { Heading } from "../shared/types.js";

type RepairReviewAnchorsOptions = {
  annotationId?: string;
  preferredSelectedText?: string;
};

type MarkdownBlock = {
  id: string;
  index: number;
  kind: string;
  start: number;
  end: number;
  heading: Heading | null;
};

type RepairContext = {
  markdown: string;
  headings: Heading[];
  blocks: MarkdownBlock[];
};

export function repairReviewAnchors(
  review: ReviewFile,
  nextMarkdown: string,
  options: RepairReviewAnchorsOptions = {}
): { review: ReviewFile; summary: AnchorRepairSummary } {
  const context: RepairContext = {
    markdown: nextMarkdown,
    headings: parseHeadings(nextMarkdown),
    blocks: parseMarkdownBlocks(nextMarkdown)
  };
  const summary = createEmptySummary(review.annotations.length);
  let changed = false;

  for (const annotation of review.annotations) {
    const preferredText =
      annotation.id === options.annotationId ? options.preferredSelectedText : undefined;
    const result = repairAnnotationAnchor(annotation, context, preferredText);
    summary[result] += 1;
    summary.items.push({ annotationId: annotation.id, result });
    changed = changed || result !== "unresolved";
  }

  if (changed) {
    review.updatedAt = new Date().toISOString();
  }

  return { review, summary };
}

function repairAnnotationAnchor(
  annotation: ReviewAnnotation,
  context: RepairContext,
  preferredText?: string
): AnchorRepairResult {
  if (annotation.anchor.kind === "document") {
    return "exact";
  }

  const candidateTexts = [preferredText, annotation.anchor.selectedText].filter(
    (value): value is string => Boolean(value?.trim())
  );

  for (const text of candidateTexts) {
    const index = context.markdown.indexOf(text);
    if (index < 0) {
      continue;
    }

    updateAnchorFromMatch(annotation.anchor, context, index, text);
    return "exact";
  }

  const heading = findFallbackHeading(annotation.anchor, context);
  if (heading) {
    updateAnchorHeading(annotation.anchor, heading);
    return "headingFallback";
  }

  return "unresolved";
}

function updateAnchorFromMatch(
  anchor: ReviewAnchor,
  context: RepairContext,
  matchIndex: number,
  selectedText: string
): void {
  const block = findBlockForIndex(context.blocks, matchIndex);
  const heading = block?.heading ?? findHeadingBeforeIndex(context.blocks, matchIndex);
  updateAnchorHeading(anchor, heading);

  if (anchor.kind === "document") {
    return;
  }

  if (anchor.kind === "mermaid") {
    return;
  }

  if (block) {
    anchor.blockId = block.id;
    anchor.blockIndex = block.index;
  }

  if (anchor.kind === "text") {
    const blockStart = block?.start ?? 0;
    const startOffset = Math.max(0, matchIndex - blockStart);
    anchor.startOffset = startOffset;
    anchor.endOffset = startOffset + selectedText.length;
    anchor.selectedText = selectedText;
    anchor.prefix = context.markdown.slice(Math.max(0, matchIndex - 40), matchIndex);
    anchor.suffix = context.markdown.slice(
      matchIndex + selectedText.length,
      matchIndex + selectedText.length + 40
    );
  } else {
    anchor.selectedText = selectedText;
  }
}

function updateAnchorHeading(anchor: ReviewAnchor, heading: Heading | null): void {
  anchor.headingId = heading?.id ?? null;
  anchor.headingText = heading?.text ?? null;
}

function findFallbackHeading(anchor: ReviewAnchor, context: RepairContext): Heading | null {
  if (anchor.headingId) {
    const byId = context.headings.find((heading) => heading.id === anchor.headingId);
    if (byId) {
      return byId;
    }
  }

  if (anchor.headingText) {
    const byText = context.headings.find((heading) => heading.text === anchor.headingText);
    if (byText) {
      return byText;
    }
  }

  return null;
}

function findBlockForIndex(blocks: MarkdownBlock[], index: number): MarkdownBlock | null {
  return blocks.find((block) => index >= block.start && index <= block.end) ?? null;
}

function findHeadingBeforeIndex(blocks: MarkdownBlock[], index: number): Heading | null {
  for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
    const block = blocks[blockIndex];
    if (block.start <= index && block.heading) {
      return block.heading;
    }
  }
  return null;
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const headings = parseHeadings(markdown);
  const blocks: MarkdownBlock[] = [];
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

      blocks.push(createBlock(index++, language === "mermaid" ? "mermaid" : "code", lineStart, endOffset, currentHeading));
      lineIndex = endLineIndex;
      offset = endOffset;
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = headings[headingIndex++] ?? currentHeading;
      blocks.push(createBlock(index++, "heading", lineStart, nextOffset, currentHeading));
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
      blocks.push(createBlock(index++, "table", tableStart, endOffset, currentHeading));
      lineIndex = endLineIndex;
      offset = endOffset;
      continue;
    }

    if (/^ {0,3}([-*+]|\d+[.)])\s+/.test(line)) {
      blocks.push(createBlock(index++, "list-item", lineStart, nextOffset, currentHeading));
      offset = nextOffset;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      blocks.push(createBlock(index++, "blockquote", lineStart, nextOffset, currentHeading));
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
    blocks.push(createBlock(index++, "paragraph", paragraphStart, paragraphEnd, currentHeading));
    lineIndex = paragraphEndLineIndex;
    offset = paragraphEnd;
  }

  return blocks;
}

function createBlock(
  index: number,
  kind: string,
  start: number,
  end: number,
  heading: Heading | null
): MarkdownBlock {
  return {
    id: `block-${index}`,
    index,
    kind,
    start,
    end,
    heading
  };
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

function createEmptySummary(total: number): AnchorRepairSummary {
  return {
    total,
    exact: 0,
    fuzzy: 0,
    headingFallback: 0,
    unresolved: 0,
    items: []
  };
}
