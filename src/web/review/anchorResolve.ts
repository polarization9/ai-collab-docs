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

  if (anchor.kind === "range") {
    const rangeResolved = resolveRangeAnchor(anchor, container);
    if (rangeResolved) {
      return rangeResolved;
    }
  }

  const textResolved = resolveByTextFirst(anchor, container);
  if (textResolved) {
    return textResolved;
  }

  const block = findBlock(anchor.blockId, container);
  if (block && isTrustworthyBlockFallback(anchor, block)) {
    if (anchor.kind === "text") {
      const directRange = createRangeFromOffsets(block, anchor.startOffset, anchor.endOffset);
      if (directRange && rangeMatches(directRange, anchor.selectedText)) {
        return { element: block, range: directRange };
      }
    }
    return { element: block, range: null };
  }

  return resolveHeading(anchor, container);
}

export function getAnnotationRects(
  annotation: ReviewAnnotation,
  container: HTMLElement
): Array<DOMRect> {
  if (annotation.anchor.kind === "range") {
    return getRangeAnchorTextRects(annotation.anchor, container);
  }

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

function resolveRangeAnchor(
  anchor: Extract<ReviewAnchor, { kind: "range" }>,
  container: HTMLElement
): ResolvedAnnotation | null {
  const startBlock = findBlock(anchor.startBlockId, container);
  const endBlock = findBlock(anchor.endBlockId, container);
  if (!startBlock || !endBlock || !isDomOrderValid(startBlock, endBlock)) {
    return null;
  }

  const startBoundary = getTextBoundary(startBlock, anchor.startOffset);
  const endBoundary = getTextBoundary(endBlock, anchor.endOffset);
  if (!startBoundary || !endBoundary) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  if (range.collapsed || !rangeMatches(range, anchor.selectedText)) {
    range.detach();
    return null;
  }

  return {
    element: startBlock,
    range
  };
}

function getRangeAnchorTextRects(
  anchor: Extract<ReviewAnchor, { kind: "range" }>,
  container: HTMLElement
): DOMRect[] {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-review-block-id]"));
  const startIndex = blocks.findIndex(
    (block) => block.dataset.reviewBlockId === anchor.startBlockId
  );
  const endIndex = blocks.findIndex((block) => block.dataset.reviewBlockId === anchor.endBlockId);
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
    return [];
  }

  return blocks
    .slice(startIndex, endIndex + 1)
    .flatMap((block, localIndex, selectedBlocks) => {
      const isStartBlock = localIndex === 0;
      const isEndBlock = localIndex === selectedBlocks.length - 1;
      return getTextNodeRects(
        block,
        isStartBlock ? anchor.startOffset : 0,
        isEndBlock ? anchor.endOffset : (block.textContent ?? "").length
      );
    });
}

function getTextNodeRects(root: HTMLElement, startOffset: number, endOffset: number): DOMRect[] {
  const normalizedStart = Math.max(0, Math.min(startOffset, endOffset));
  const normalizedEnd = Math.max(normalizedStart, endOffset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  let currentOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const textLength = node.textContent?.length ?? 0;
    const nextOffset = currentOffset + textLength;
    const segmentStart = Math.max(normalizedStart, currentOffset);
    const segmentEnd = Math.min(normalizedEnd, nextOffset);

    if (segmentStart < segmentEnd) {
      const range = document.createRange();
      range.setStart(node, segmentStart - currentOffset);
      range.setEnd(node, segmentEnd - currentOffset);
      rects.push(
        ...Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      );
      range.detach();
    }

    currentOffset = nextOffset;
    if (currentOffset >= normalizedEnd) {
      break;
    }
  }

  return rects;
}

function isDomOrderValid(start: HTMLElement, end: HTMLElement): boolean {
  if (start === end) {
    return true;
  }
  return Boolean(start.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function getTextBoundary(root: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const targetOffset = Math.max(0, Math.min(offset, root.textContent?.length ?? 0));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let lastTextNode: Text | null = null;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const textLength = node.textContent?.length ?? 0;
    const nextOffset = currentOffset + textLength;
    lastTextNode = node;

    if (targetOffset <= nextOffset) {
      return {
        node,
        offset: targetOffset - currentOffset
      };
    }

    currentOffset = nextOffset;
  }

  return lastTextNode
    ? {
        node: lastTextNode,
        offset: lastTextNode.textContent?.length ?? 0
      }
    : null;
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

function resolveByTextFirst(anchor: ReviewAnchor, container: HTMLElement): ResolvedAnnotation | null {
  const candidates = scoreDomCandidates(findDomCandidates(anchor, container), anchor);
  const [best, second] = candidates;
  if (!best) {
    return null;
  }

  if (!second || best.score - second.score >= 12 || best.score >= 70) {
    return {
      element: best.element,
      range: best.range
    };
  }

  return null;
}

type DomCandidate = {
  element: HTMLElement;
  range: Range;
  source: "selected" | "original";
  score: number;
};

function findDomCandidates(anchor: ReviewAnchor, container: HTMLElement): DomCandidate[] {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-review-block-id]"));
  const scopedBlocks = getHeadingScopedBlocks(blocks, anchor);
  const searchBlocks = scopedBlocks.length > 0 ? scopedBlocks : blocks;
  const texts = getAnchorTexts(anchor);
  const candidates: DomCandidate[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    for (const block of searchBlocks) {
      const range = createRangeFromTextCandidates(block, text.value);
      if (!range) {
        continue;
      }
      const key = `${block.dataset.reviewBlockId}:${range.startOffset}:${range.endOffset}:${text.source}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        element: block,
        range,
        source: text.source,
        score: 0
      });
    }
  }

  if (scopedBlocks.length > 0) {
    return candidates;
  }

  return candidates;
}

function scoreDomCandidates(candidates: DomCandidate[], anchor: ReviewAnchor): DomCandidate[] {
  return candidates
    .map((candidate) => {
      let score = candidate.source === "selected" ? 45 : 34;

      if (anchor.headingId && candidate.element.dataset.reviewHeadingId === anchor.headingId) {
        score += 18;
      } else if (
        anchor.headingText &&
        candidate.element.dataset.reviewHeadingText === anchor.headingText
      ) {
        score += 14;
      }

      if ("blockId" in anchor && candidate.element.dataset.reviewBlockId === anchor.blockId) {
        score += 10;
      }

      if (
        anchor.blockFingerprint?.kind &&
        candidate.element.dataset.reviewBlockKind === anchor.blockFingerprint.kind
      ) {
        score += 8;
      }

      if (anchor.kind === "text") {
        const blockText = candidate.element.textContent ?? "";
        const prefix = normalizeText(anchor.prefix);
        const suffix = normalizeText(anchor.suffix);
        if (prefix && normalizeText(blockText).includes(prefix)) {
          score += 12;
        }
        if (suffix && normalizeText(blockText).includes(suffix)) {
          score += 12;
        }
      }

      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score);
}

function getHeadingScopedBlocks(blocks: HTMLElement[], anchor: ReviewAnchor): HTMLElement[] {
  if (!anchor.headingId && !anchor.headingText) {
    return [];
  }
  return blocks.filter(
    (block) =>
      (anchor.headingId && block.dataset.reviewHeadingId === anchor.headingId) ||
      (anchor.headingText && block.dataset.reviewHeadingText === anchor.headingText)
  );
}

function getAnchorTexts(anchor: ReviewAnchor): Array<{ value: string; source: "selected" | "original" }> {
  const texts: Array<{ value: string; source: "selected" | "original" }> = [];
  if (anchor.selectedText?.trim()) {
    texts.push({ value: anchor.selectedText.trim(), source: "selected" });
  }
  if (anchor.originalSelectedText?.trim() && anchor.originalSelectedText !== anchor.selectedText) {
    texts.push({ value: anchor.originalSelectedText.trim(), source: "original" });
  }
  return texts;
}

function isTrustworthyBlockFallback(anchor: ReviewAnchor, block: HTMLElement): boolean {
  if (anchor.kind === "range") {
    return false;
  }
  if (anchor.anchorPrecision === "heading" || anchor.anchorPrecision === "unknown") {
    return false;
  }

  const blockText = normalizeText(block.textContent ?? "");
  const selectedText = normalizeText(anchor.selectedText ?? "");
  const originalSelectedText = normalizeText(anchor.originalSelectedText ?? "");
  if (selectedText && blockText.includes(selectedText)) {
    return true;
  }
  if (originalSelectedText && blockText.includes(originalSelectedText)) {
    return true;
  }

  if (anchor.kind === "text") {
    const prefix = normalizeText(anchor.prefix);
    const suffix = normalizeText(anchor.suffix);
    return Boolean((prefix && blockText.includes(prefix)) || (suffix && blockText.includes(suffix)));
  }

  return false;
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
