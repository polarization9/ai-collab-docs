import type { ReviewAnchor, ReviewAnnotation } from "../../shared/reviewTypes";

export type ResolvedAnnotation = {
  element: HTMLElement;
  range: Range | null;
};

export function resolveAnnotation(
  annotation: ReviewAnnotation,
  container: HTMLElement
): ResolvedAnnotation | null {
  const anchor = annotation.anchor;

  if (anchor.kind === "document") {
    return null;
  }

  if (anchor.kind === "mermaid") {
    const mermaid = container.querySelectorAll<HTMLElement>("[data-review-block-kind='mermaid']")[
      anchor.mermaidIndex
    ];
    return mermaid ? { element: mermaid, range: null } : resolveHeading(anchor, container);
  }

  const block = findBlock(anchor.blockId, container);
  if (!block) {
    return resolveByText(anchor.selectedText, container) ?? resolveHeading(anchor, container);
  }

  if (anchor.kind === "block") {
    return { element: block, range: null };
  }

  const directRange = createRangeFromOffsets(block, anchor.startOffset, anchor.endOffset);
  if (directRange && rangeMatches(directRange, anchor.selectedText)) {
    return { element: block, range: directRange };
  }

  const textRange = createRangeFromTextCandidates(block, anchor.selectedText);
  if (textRange) {
    return { element: block, range: textRange };
  }

  return { element: block, range: null };
}

export function getAnnotationRects(
  annotation: ReviewAnnotation,
  container: HTMLElement
): Array<DOMRect> {
  const resolved = resolveAnnotation(annotation, container);
  if (!resolved) {
    return [];
  }

  if (resolved.range) {
    const rects = Array.from(resolved.range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0
    );
    if (rects.length > 0) {
      return rects;
    }
  }

  const textRects = getElementTextRects(resolved.element);
  return textRects.length > 0 ? textRects : [resolved.element.getBoundingClientRect()];
}

export function scrollToAnnotation(annotation: ReviewAnnotation, container: HTMLElement): void {
  if (annotation.anchor.kind === "document") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const resolved = resolveAnnotation(annotation, container);
  resolved?.element.scrollIntoView({ block: "center", behavior: "smooth" });
}

function findBlock(blockId: string, container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-review-block-id="${escapeAttribute(blockId)}"]`
  );
}

function resolveByText(text: string, container: HTMLElement): ResolvedAnnotation | null {
  if (!text) {
    return null;
  }

  for (const block of Array.from(container.querySelectorAll<HTMLElement>("[data-review-block-id]"))) {
    const range = createRangeFromTextCandidates(block, text);
    if (range) {
      return { element: block, range };
    }
  }

  return null;
}

function resolveHeading(anchor: ReviewAnchor, container: HTMLElement): ResolvedAnnotation | null {
  if (!anchor.headingId) {
    return null;
  }

  const heading = container.querySelector<HTMLElement>(
    `#${escapeCssIdentifier(anchor.headingId)}`
  );
  return heading ? { element: heading, range: null } : null;
}

function createRangeFromTextCandidates(root: HTMLElement, text: string): Range | null {
  for (const candidate of getTextCandidates(text)) {
    const range = createRangeFromText(root, candidate) ?? createRangeFromNormalizedText(root, candidate);
    if (range) {
      return range;
    }
  }
  return null;
}

function createRangeFromText(root: HTMLElement, text: string): Range | null {
  const index = root.textContent?.indexOf(text) ?? -1;
  if (index < 0) {
    return null;
  }
  return createRangeFromOffsets(root, index, index + text.length);
}

function createRangeFromNormalizedText(root: HTMLElement, text: string): Range | null {
  const rootIndex = buildNormalizedIndex(root.textContent ?? "");
  const textIndex = buildNormalizedIndex(text);
  if (textIndex.text.length === 0) {
    return null;
  }

  const index = rootIndex.text.indexOf(textIndex.text);
  if (index < 0) {
    return null;
  }

  const start = rootIndex.map[index] ?? 0;
  const end = rootIndex.map[index + textIndex.text.length - 1] ?? start;
  return createRangeFromOffsets(root, start, end + 1);
}

function createRangeFromOffsets(root: HTMLElement, startOffset: number, endOffset: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let currentOffset = 0;
  let startSet = false;
  let endSet = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const textLength = node.textContent?.length ?? 0;
    const nextOffset = currentOffset + textLength;

    if (!startSet && startOffset >= currentOffset && startOffset <= nextOffset) {
      range.setStart(node, startOffset - currentOffset);
      startSet = true;
    }

    if (!endSet && endOffset >= currentOffset && endOffset <= nextOffset) {
      range.setEnd(node, endOffset - currentOffset);
      endSet = true;
      break;
    }

    currentOffset = nextOffset;
  }

  return startSet && endSet ? range : null;
}

function rangeMatches(range: Range, expectedText: string): boolean {
  const actual = normalizeText(range.toString());
  return getTextCandidates(expectedText).some((candidate) => actual === normalizeText(candidate));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getTextCandidates(text: string): string[] {
  return Array.from(
    new Set(
      [text, stripMarkdownSyntax(text), stripMarkdownSyntax(text).replace(/^#{1,6}\s+/, "")]
        .map(normalizeText)
        .filter(Boolean)
    )
  );
}

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/[*~]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function buildNormalizedIndex(text: string): { text: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += " ";
        map.push(index);
        lastWasSpace = true;
      }
      continue;
    }

    normalized += char;
    map.push(index);
    lastWasSpace = false;
  }

  return {
    text: normalized.trim().toLowerCase(),
    map
  };
}

function getElementTextRects(element: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    return Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0
    );
  } finally {
    range.detach();
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeCssIdentifier(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, "");
}
