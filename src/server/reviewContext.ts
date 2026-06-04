import type { Heading } from "../shared/types.js";
import type {
  AnnotationContext,
  ReviewAnchor,
  ReviewAnnotation
} from "../shared/reviewTypes.js";
import { loadReviewDocument } from "./document.js";
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
  if (selectedText) {
    const directIndex = markdown.indexOf(selectedText);
    if (directIndex >= 0) {
      return directIndex;
    }
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
