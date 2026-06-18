import type { Heading } from "../../shared/types";
import type { ReviewAnchor } from "../../shared/reviewTypes";

export type AnnotationDraft = {
  anchor: ReviewAnchor;
  selectedText: string;
  rect: DOMRect;
  anchorRect: DOMRect;
};

const CONTEXT_CHARS = 40;
type BoundaryEdge = "start" | "end";

export function captureAnnotationDraft(
  container: HTMLElement,
  headings: Heading[]
): AnnotationDraft | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!commonAncestor || !container.contains(commonAncestor)) {
    return null;
  }

  const startBlock = getBoundaryReviewBlock(range.startContainer, range.startOffset, "start");
  const endBlock = getBoundaryReviewBlock(range.endContainer, range.endOffset, "end");
  if (!startBlock || !endBlock || !container.contains(startBlock) || !container.contains(endBlock)) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  const anchorRect = getSelectionEndRect(range) ?? rect;

  const blockMeta = getBlockMeta(startBlock);
  const heading = getHeadingFromBlock(startBlock, headings);

  if (startBlock !== endBlock) {
    const endBlockMeta = getBlockMeta(endBlock);
    const startBlockText = startBlock.textContent ?? "";
    const endBlockText = endBlock.textContent ?? "";
    const startOffset = getBoundaryTextOffset(
      startBlock,
      range.startContainer,
      range.startOffset,
      "start"
    );
    const endOffset = getBoundaryTextOffset(
      endBlock,
      range.endContainer,
      range.endOffset,
      "end"
    );

    return {
      selectedText,
      rect,
      anchorRect,
      anchor: {
        kind: "range",
        headingId: heading?.id ?? null,
        headingText: heading?.text ?? null,
        blockId: blockMeta.blockId,
        blockIndex: blockMeta.blockIndex,
        startBlockId: blockMeta.blockId,
        startBlockIndex: blockMeta.blockIndex,
        startOffset,
        endBlockId: endBlockMeta.blockId,
        endBlockIndex: endBlockMeta.blockIndex,
        endOffset,
        selectedText,
        prefix: startBlockText.slice(Math.max(0, startOffset - CONTEXT_CHARS), startOffset),
        suffix: endBlockText.slice(endOffset, endOffset + CONTEXT_CHARS),
        originalSelectedText: selectedText,
        anchorPrecision: "exact"
      }
    };
  }

  const blockText = startBlock.textContent ?? "";
  const startOffset = getBoundaryTextOffset(
    startBlock,
    range.startContainer,
    range.startOffset,
    "start"
  );
  const endOffset = getBoundaryTextOffset(
    startBlock,
    range.endContainer,
    range.endOffset,
    "end"
  );
  const normalizedStart = Math.max(0, Math.min(startOffset, endOffset));
  const normalizedEnd = Math.max(normalizedStart, Math.max(startOffset, endOffset));

  return {
    selectedText,
    rect,
    anchorRect,
    anchor: {
      kind: "text",
      headingId: heading?.id ?? null,
      headingText: heading?.text ?? null,
      blockId: blockMeta.blockId,
      blockIndex: blockMeta.blockIndex,
      startOffset: normalizedStart,
      endOffset: normalizedEnd,
      selectedText,
      prefix: blockText.slice(Math.max(0, normalizedStart - CONTEXT_CHARS), normalizedStart),
      suffix: blockText.slice(normalizedEnd, normalizedEnd + CONTEXT_CHARS),
      originalSelectedText: selectedText,
      anchorPrecision: "exact"
    }
  };
}

function getSelectionEndRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  return rects[rects.length - 1] ?? null;
}

function getReviewBlock(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-review-block-id]") ?? null;
}

function getBoundaryReviewBlock(node: Node, offset: number, edge: BoundaryEdge): HTMLElement | null {
  const directBlock = getReviewBlock(node);
  if (directBlock) {
    return directBlock;
  }

  if (!(node instanceof Element)) {
    return null;
  }

  return edge === "start"
    ? findReviewBlockFromChildren(node, offset, 1)
    : findReviewBlockFromChildren(node, offset - 1, -1);
}

function findReviewBlockFromChildren(
  element: Element,
  startIndex: number,
  step: 1 | -1
): HTMLElement | null {
  const children = Array.from(element.childNodes);
  const firstIndex = step === 1
    ? Math.max(0, startIndex)
    : Math.min(children.length - 1, startIndex);

  for (let index = firstIndex; index >= 0 && index < children.length; index += step) {
    const block = findReviewBlockInSubtree(children[index], step === 1 ? "first" : "last");
    if (block) {
      return block;
    }
  }

  return null;
}

function findReviewBlockInSubtree(
  node: Node | undefined,
  direction: "first" | "last"
): HTMLElement | null {
  if (!node) {
    return null;
  }

  const element = node instanceof Element ? node : node.parentElement;
  if (!element) {
    return null;
  }

  if (element.matches("[data-review-block-id]")) {
    return element as HTMLElement;
  }

  if (direction === "first") {
    return element.querySelector<HTMLElement>("[data-review-block-id]");
  }

  const blocks = element.querySelectorAll<HTMLElement>("[data-review-block-id]");
  return blocks[blocks.length - 1] ?? null;
}

function getBlockMeta(block: HTMLElement): { blockId: string; blockIndex: number } {
  const blockId = block.dataset.reviewBlockId ?? "block-0";
  const blockIndex = Number.parseInt(block.dataset.reviewBlockIndex ?? "0", 10);
  return {
    blockId,
    blockIndex: Number.isFinite(blockIndex) ? blockIndex : 0
  };
}

function getHeadingFromBlock(block: HTMLElement, headings: Heading[]): Heading | null {
  const headingId = block.dataset.reviewHeadingId;
  const headingText = block.dataset.reviewHeadingText;
  return (
    headings.find((heading) => heading.id === headingId) ??
    headings.find((heading) => heading.text === headingText) ??
    null
  );
}

function getBoundaryTextOffset(
  root: HTMLElement,
  node: Node,
  offset: number,
  edge: BoundaryEdge
): number {
  const directOffset = getTextOffset(root, node, offset);
  if (directOffset !== null) {
    return directOffset;
  }

  const rootTextLength = root.textContent?.length ?? 0;
  if (node instanceof Element && node.contains(root)) {
    const childIndex = getContainingChildIndex(node, root);
    if (childIndex !== null) {
      return childIndex < offset ? rootTextLength : 0;
    }
  }

  return edge === "start" ? 0 : rootTextLength;
}

function getTextOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (node !== root && !root.contains(node)) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  } finally {
    range.detach();
  }
}

function getContainingChildIndex(parent: Element, descendant: HTMLElement): number | null {
  let child: Node = descendant;
  while (child.parentNode && child.parentNode !== parent) {
    child = child.parentNode;
  }

  if (child.parentNode !== parent) {
    return null;
  }

  return Array.prototype.indexOf.call(parent.childNodes, child) as number;
}
