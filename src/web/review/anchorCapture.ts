import type { Heading } from "../../shared/types";
import type { ReviewAnchor } from "../../shared/reviewTypes";

export type AnnotationDraft = {
  anchor: ReviewAnchor;
  selectedText: string;
  rect: DOMRect;
  anchorRect: DOMRect;
};

const CONTEXT_CHARS = 40;

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

  const startBlock = getReviewBlock(range.startContainer);
  const endBlock = getReviewBlock(range.endContainer);
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
    return {
      selectedText,
      rect,
      anchorRect,
      anchor: {
        kind: "block",
        headingId: heading?.id ?? null,
        headingText: heading?.text ?? null,
        blockId: blockMeta.blockId,
        blockIndex: blockMeta.blockIndex,
        selectedText
      }
    };
  }

  const blockText = startBlock.textContent ?? "";
  const startOffset = getTextOffset(startBlock, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(startBlock, range.endContainer, range.endOffset);
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
      suffix: blockText.slice(normalizedEnd, normalizedEnd + CONTEXT_CHARS)
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

function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
    return range.toString().length;
  } finally {
    range.detach();
  }
}
