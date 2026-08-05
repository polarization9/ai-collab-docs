import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseMarkdownBlocks } from "../src/shared/markdownBlocks";
import type { ReviewDocument } from "../src/shared/types";
import { DocumentViewer } from "../src/web/components/DocumentViewer";
import {
  EXTRA_BLANK_LINE_CLASS,
  remarkPreserveExtraBlankLines
} from "../src/web/markdown/remarkPreserveExtraBlankLines";

function render(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm, remarkPreserveExtraBlankLines] },
      markdown
    )
  );
}

const softBreakHtml = render("first line\nsecond line");
assert.ok(softBreakHtml.includes("first line\nsecond line"));
assert.ok(!softBreakHtml.includes("<br"));

const normalParagraphGapHtml = render("first paragraph\n\nsecond paragraph");
assert.equal(countExtraBlankLines(normalParagraphGapHtml), 0);

const repeatedBlankLinesHtml = render("first paragraph\n\n\n\nsecond paragraph");
assert.equal(countExtraBlankLines(repeatedBlankLinesHtml), 2);

const documentContent = [
  "# Whitespace review",
  "",
  "first line",
  "second line",
  "",
  "normal paragraph gap",
  "",
  "",
  "",
  "paragraph after three blank lines"
].join("\n");
const parsedDocument = parseMarkdownBlocks(documentContent);
const documentHtml = renderToStaticMarkup(
  createElement(DocumentViewer, {
    document: createReviewDocument(documentContent, parsedDocument.headings)
  })
);
assert.ok(documentHtml.includes("first line\nsecond line"));
assert.equal(countExtraBlankLines(documentHtml), 2);
assert.equal(
  documentHtml.match(/data-review-block-id=/g)?.length ?? 0,
  parsedDocument.blocks.length
);

console.log("markdown-whitespace-ok");

function countExtraBlankLines(html: string): number {
  return html.match(new RegExp(`class="${EXTRA_BLANK_LINE_CLASS}"`, "g"))?.length ?? 0;
}

function createReviewDocument(content: string, headings: ReviewDocument["headings"]): ReviewDocument {
  return {
    id: "whitespace-test",
    absolutePath: "/tmp/whitespace-test.md",
    relativePath: "whitespace-test.md",
    reviewPath: "/tmp/whitespace-test.review.json",
    agentLinkPath: "/tmp/whitespace-test.margent-agent.json",
    codexLinkPath: "/tmp/whitespace-test.codex.json",
    content,
    contentHash: "whitespace-test",
    loadedAt: "2026-01-01T00:00:00.000Z",
    headings
  };
}
