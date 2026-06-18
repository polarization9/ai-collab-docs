import assert from "node:assert/strict";
import { repairReviewAnchors } from "../src/server/reviewAnchorRepair.js";
import type { ReviewAnnotation, ReviewFile } from "../src/shared/reviewTypes.js";

const NOW = "2026-01-01T00:00:00.000Z";

run("preferred unique match updates to the agent-selected text", () => {
  const review = createReview([
    annotation("ann_title", {
      selectedText: "Old title",
      blockId: "block-0",
      blockIndex: 0,
      headingText: "Old title",
      blockKind: "heading"
    })
  ]);
  const result = repairReviewAnchors(
    review,
    "## Old title\n\nBody\n",
    "## New title\n\nBody\n",
    {
      annotationId: "ann_title",
      preferredSelectedText: "New title"
    }
  );

  const repaired = result.review.annotations[0].anchor;
  assert.equal(result.summary.exact, 1);
  assert.equal(repaired.selectedText, "New title");
  assert.equal(repaired.blockId, "block-0");
  assert.equal(repaired.blockFingerprint?.kind, "heading");
});

run("preferred duplicate match picks the changed block", () => {
  const previous = ["# Doc", "", "## A", "Placeholder", "", "## B", "Target phrase", ""].join("\n");
  const next = ["# Doc", "", "## A", "Target phrase", "", "## B", "Target phrase", ""].join("\n");
  const review = createReview([
    annotation("ann_repeat", {
      selectedText: "Placeholder",
      blockId: "block-2",
      blockIndex: 2,
      headingText: "A",
      blockKind: "paragraph"
    })
  ]);

  const result = repairReviewAnchors(review, previous, next, {
    annotationId: "ann_repeat",
    preferredSelectedText: "Target phrase"
  });

  const repaired = result.review.annotations[0].anchor;
  assert.equal(result.summary.exact, 1);
  assert.equal(repaired.selectedText, "Target phrase");
  assert.equal(repaired.headingText, "A");
});

run("preferred text may intentionally move from a heading to body text", () => {
  const review = createReview([
    annotation("ann_move", {
      selectedText: "Concept",
      blockId: "block-0",
      blockIndex: 0,
      headingText: "Concept",
      blockKind: "heading"
    })
  ]);

  const result = repairReviewAnchors(
    review,
    "## Concept\n\nOld body\n",
    "## Concept\n\nThe agent moved this anchor into the explanation.\n",
    {
      annotationId: "ann_move",
      preferredSelectedText: "agent moved this anchor"
    }
  );

  const repaired = result.review.annotations[0].anchor;
  assert.equal(result.summary.exact, 1);
  assert.equal(repaired.selectedText, "agent moved this anchor");
  assert.equal(repaired.blockFingerprint?.kind, "paragraph");
});

run("without preferred, repeated selected text is not repaired without a clear winner", () => {
  const review = createReview([
    annotation("ann_ambiguous", {
      selectedText: "Repeat",
      blockId: "missing-block",
      blockIndex: 99,
      headingText: null,
      blockKind: "paragraph"
    })
  ]);

  const result = repairReviewAnchors(review, null, "Repeat\n\nRepeat\n");

  assert.equal(result.summary.unresolved, 1);
  assert.equal(result.review.annotations[0].anchor.blockId, "missing-block");
});

run("without preferred, current block text remains stable", () => {
  const review = createReview([
    annotation("ann_stable", {
      selectedText: "Stable text",
      blockId: "block-1",
      blockIndex: 1,
      headingText: "Section",
      blockKind: "paragraph"
    })
  ]);

  const markdown = "## Section\n\nStable text\n";
  const result = repairReviewAnchors(review, markdown, markdown);
  const repaired = result.review.annotations[0].anchor;

  assert.equal(result.summary.exact, 1);
  assert.equal(repaired.selectedText, "Stable text");
  assert.equal(repaired.blockId, "block-1");
});

console.log("anchor-repair-ok");

function run(name: string, test: () => void): void {
  try {
    test();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    throw error;
  }
}

function createReview(annotations: ReviewAnnotation[]): ReviewFile {
  return {
    version: 1,
    documentPath: "/tmp/Test.md",
    documentId: "doc_test",
    createdAt: NOW,
    updatedAt: NOW,
    annotations
  };
}

function annotation(
  id: string,
  options: {
    selectedText: string;
    blockId: string;
    blockIndex: number;
    headingText: string | null;
    blockKind: string;
  }
): ReviewAnnotation {
  return {
    id,
    status: "open",
    author: { type: "user", name: "Tester" },
    body: "Test annotation",
    anchor: {
      kind: "text",
      headingId: options.headingText ? slug(options.headingText) : null,
      headingText: options.headingText,
      blockId: options.blockId,
      blockIndex: options.blockIndex,
      startOffset: 0,
      endOffset: options.selectedText.length,
      selectedText: options.selectedText,
      prefix: "",
      suffix: "",
      originalSelectedText: options.selectedText,
      anchorPrecision: "exact",
      blockFingerprint: {
        kind: options.blockKind,
        textHash: "",
        normalizedText: options.selectedText.toLowerCase(),
        headingId: options.headingText ? slug(options.headingText) : null,
        headingText: options.headingText
      }
    },
    replies: [],
    createdAt: NOW,
    updatedAt: NOW
  };
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-");
}
