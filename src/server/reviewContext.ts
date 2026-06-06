import type { Heading } from "../shared/types.js";
import type {
  AnnotationContext,
  ReviewAnchor,
  ReviewAnnotation
} from "../shared/reviewTypes.js";
import { loadReviewDocument } from "./document.js";
import { parseMarkdownBlocks, type MarkdownBlock } from "./markdownBlocks.js";
import { AnnotationNotFoundError, loadReviewFile } from "./review.js";

const CONTEXT_RADIUS = 1200;

export async function getAnnotationContext(
  markdownPath: string,
  annotationId: string
): Promise<AnnotationContext> {
  const [document, review] = await Promise.all([
    loadReviewDocument(markdownPath),
    loadReviewFile(markdownPath)
  ]);
  const annotation = review.annotations.find((item) => item.id === annotationId);

  if (!annotation) {
    throw new AnnotationNotFoundError(annotationId);
  }

  const selectedText = getAnchorSelectedText(annotation.anchor);
  const heading = findHeading(document.headings, annotation.anchor);
  const focusIndex = findFocusIndex(document.content, annotation, heading);
  const beforeStart = Math.max(0, focusIndex - CONTEXT_RADIUS);
  const afterEnd = Math.min(document.content.length, focusIndex + selectedText.length + CONTEXT_RADIUS);

  return {
    annotation,
    selectedText,
    heading,
    beforeMarkdown: document.content.slice(beforeStart, focusIndex),
    afterMarkdown: document.content.slice(focusIndex + selectedText.length, afterEnd),
    relatedMarkdown: getRelatedMarkdown(document.content, focusIndex, heading),
    replies: annotation.replies
  };
}

function findFocusIndex(
  markdown: string,
  annotation: ReviewAnnotation,
  heading: Heading | null
): number {
  const selectedText = getAnchorSelectedText(annotation.anchor);
  const anchoredIndex = findAnchoredSelectedTextIndex(markdown, annotation.anchor, selectedText);
  if (anchoredIndex >= 0) {
    return anchoredIndex;
  }

  if (annotation.anchor.kind === "text") {
    const prefixIndex = annotation.anchor.prefix
      ? markdown.indexOf(annotation.anchor.prefix)
      : -1;
    if (prefixIndex >= 0) {
      return prefixIndex + annotation.anchor.prefix.length;
    }

    const suffixIndex = annotation.anchor.suffix
      ? markdown.indexOf(annotation.anchor.suffix)
      : -1;
    if (suffixIndex >= 0) {
      return suffixIndex;
    }
  }

  if (heading) {
    const headingIndex = findHeadingIndex(markdown, heading.text);
    if (headingIndex >= 0) {
      return headingIndex;
    }
  }

  return 0;
}

type FocusCandidate = {
  index: number;
  block: MarkdownBlock;
  score: number;
};

function findAnchoredSelectedTextIndex(
  markdown: string,
  anchor: ReviewAnchor,
  selectedText: string
): number {
  if (!selectedText) {
    return -1;
  }

  const parsed = parseMarkdownBlocks(markdown);
  const candidates = parsed.blocks.flatMap((block) =>
    findAllIndexes(block.text, selectedText).map((index) => ({
      index: block.start + index,
      block,
      score: 0
    }))
  );

  if (candidates.length === 0) {
    return markdown.indexOf(selectedText);
  }

  return scoreFocusCandidates(candidates, anchor, markdown)[0]?.index ?? -1;
}

function scoreFocusCandidates(
  candidates: FocusCandidate[],
  anchor: ReviewAnchor,
  markdown: string
): FocusCandidate[] {
  return candidates
    .map((candidate) => {
      let score = 1;

      if (anchor.headingId && candidate.block.headingId === anchor.headingId) {
        score += 32;
      } else if (anchor.headingText && candidate.block.headingText === anchor.headingText) {
        score += 24;
      }

      if ("blockId" in anchor && candidate.block.id === anchor.blockId) {
        score += 24;
      }
      if ("blockIndex" in anchor && candidate.block.index === anchor.blockIndex) {
        score += 10;
      }

      if (anchor.kind === "text") {
        if (typeof anchor.markdownOffset === "number") {
          const distance = Math.abs(anchor.markdownOffset - candidate.index);
          score += distance <= 2 ? 20 : distance <= 120 ? 10 : distance <= 1000 ? 4 : 0;
        }
        if (anchor.prefix && markdown.slice(0, candidate.index).endsWith(anchor.prefix)) {
          score += 18;
        }
        if (
          anchor.suffix &&
          markdown.slice(candidate.index + anchor.selectedText.length).startsWith(anchor.suffix)
        ) {
          score += 18;
        }
      }

      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score);
}

function findAllIndexes(text: string, query: string): number[] {
  if (!query) {
    return [];
  }

  const indexes: number[] = [];
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(query, offset);
    if (index < 0) {
      break;
    }
    indexes.push(index);
    offset = index + Math.max(1, query.length);
  }
  return indexes;
}

function getRelatedMarkdown(markdown: string, focusIndex: number, heading: Heading | null): string {
  if (!heading) {
    return markdown.slice(
      Math.max(0, focusIndex - CONTEXT_RADIUS),
      Math.min(markdown.length, focusIndex + CONTEXT_RADIUS)
    );
  }

  const headingIndex = findHeadingIndex(markdown, heading.text);
  if (headingIndex < 0) {
    return markdown.slice(
      Math.max(0, focusIndex - CONTEXT_RADIUS),
      Math.min(markdown.length, focusIndex + CONTEXT_RADIUS)
    );
  }

  const nextHeadingIndex = findNextHeadingIndex(markdown, headingIndex);
  return markdown.slice(headingIndex, nextHeadingIndex >= 0 ? nextHeadingIndex : markdown.length);
}

function findHeading(headings: Heading[], anchor: ReviewAnchor): Heading | null {
  if (anchor.headingId) {
    const byId = headings.find((heading) => heading.id === anchor.headingId);
    if (byId) {
      return byId;
    }
  }

  if (anchor.headingText) {
    const byText = headings.find((heading) => heading.text === anchor.headingText);
    if (byText) {
      return byText;
    }
  }

  return null;
}

function getAnchorSelectedText(anchor: ReviewAnchor): string {
  return anchor.selectedText ?? "";
}

function findHeadingIndex(markdown: string, headingText: string): number {
  const lines = markdown.split(/\r?\n/);
  let offset = 0;

  for (const line of lines) {
    const match = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*$/);
    if (match && normalizeHeading(match[1]) === headingText) {
      return offset;
    }
    offset += line.length + 1;
  }

  return -1;
}

function findNextHeadingIndex(markdown: string, startIndex: number): number {
  const rest = markdown.slice(startIndex + 1);
  const match = rest.match(/\n {0,3}#{1,6}\s+/);
  return match?.index === undefined ? -1 : startIndex + 1 + match.index;
}

function normalizeHeading(raw: string): string {
  return raw.replace(/\s+#+\s*$/, "").trim();
}
