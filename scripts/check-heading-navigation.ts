import assert from "node:assert/strict";
import {
  findHeadingLocation,
  parseHeadingLocations
} from "../src/shared/markdownHeadings.js";
import type { ReviewAnnotation } from "../src/shared/reviewTypes.js";
import { resolveAnnotation } from "../src/web/review/anchorResolve.js";

const markdown = [
  "# Document",
  "",
  "## Shared structure",
  "Second chapter body",
  "",
  "## Shared structure",
  "Third chapter body"
].join("\n");
const headings = parseHeadingLocations(markdown);
const repeatedHeadings = headings.filter((heading) => heading.text === "Shared structure");

assert.equal(repeatedHeadings.length, 2);
assert.equal(repeatedHeadings[0].id, "shared-structure");
assert.equal(repeatedHeadings[1].id, "shared-structure-1");

const secondMatch = findHeadingLocation(markdown, {
  headingId: repeatedHeadings[1].id,
  headingText: repeatedHeadings[1].text
});
assert.equal(secondMatch?.offset, repeatedHeadings[1].offset);

const ambiguousTextOnlyMatch = findHeadingLocation(markdown, {
  headingId: null,
  headingText: "Shared structure"
});
assert.equal(ambiguousTextOnlyMatch, null);

const uniqueTextFallback = findHeadingLocation(markdown, {
  headingId: "missing-id",
  headingText: "Document"
});
assert.equal(uniqueTextFallback?.id, "document");

installMinimalDom();
const staleIdBlock = createBlock("new-section", "shared-structure-1", "Shared structure");
const targetBlock = createBlock(
  "target-section",
  "shared-structure-2",
  "Shared structure",
  "Original target text"
);
const resolved = resolveAnnotation(
  createAnnotationWithStaleHeadingId(),
  createContainer([staleIdBlock, targetBlock])
);
assert.equal(resolved?.element, targetBlock);

console.log("heading-navigation-ok");

function createAnnotationWithStaleHeadingId(): ReviewAnnotation {
  return {
    id: "ann-stale-heading-id",
    status: "open",
    author: { type: "user", name: "Tester" },
    body: "Keep this annotation attached to its original text.",
    anchor: {
      kind: "text",
      headingId: "shared-structure-1",
      headingText: "Shared structure",
      blockId: "old-target-section",
      blockIndex: 4,
      startOffset: 0,
      endOffset: "Original target text".length,
      selectedText: "Original target text",
      prefix: "",
      suffix: "",
      originalSelectedText: "Original target text",
      anchorPrecision: "exact"
    },
    replies: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function createBlock(
  blockId: string,
  headingId: string,
  headingText: string,
  textContent = "Different text"
): HTMLElement {
  return {
    dataset: {
      reviewBlockId: blockId,
      reviewBlockKind: "paragraph",
      reviewHeadingId: headingId,
      reviewHeadingText: headingText
    },
    textContent
  } as HTMLElement;
}

function createContainer(blocks: HTMLElement[]): HTMLElement {
  return {
    querySelectorAll(selector: string) {
      return selector === "[data-review-block-id]" ? blocks : [];
    },
    querySelector() {
      return null;
    }
  } as unknown as HTMLElement;
}

function installMinimalDom(): void {
  Object.defineProperty(globalThis, "NodeFilter", {
    configurable: true,
    value: { SHOW_TEXT: 4 }
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createTreeWalker(root: HTMLElement) {
        const textNode = { textContent: root.textContent };
        let visited = false;
        return {
          currentNode: textNode,
          nextNode() {
            if (visited) {
              return false;
            }
            visited = true;
            this.currentNode = textNode;
            return true;
          }
        };
      },
      createRange() {
        return {
          startOffset: 0,
          endOffset: 0,
          setStart(_node: Node, offset: number) {
            this.startOffset = offset;
          },
          setEnd(_node: Node, offset: number) {
            this.endOffset = offset;
          }
        };
      }
    }
  });
}
