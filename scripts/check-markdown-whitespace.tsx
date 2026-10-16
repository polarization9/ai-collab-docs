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
import { remarkPreserveLineBreaks } from "../src/web/markdown/remarkPreserveLineBreaks";

function render(markdown: string, preserveLineBreaks = true): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [
          remarkGfm,
          remarkPreserveExtraBlankLines,
          ...(preserveLineBreaks ? [remarkPreserveLineBreaks] : [])
        ]
      },
      markdown
    )
  );
}

const softBreakHtml = render("first line\nsecond line");
assert.equal(softBreakHtml, "<p>first line<br/>\nsecond line</p>");

const lineBreakCases = [
  { markdown: "- first line\n  second line", breaks: 1 },
  { markdown: "1. first line\n   second line", breaks: 1 },
  { markdown: "- first paragraph\n  second line\n\n  next paragraph", breaks: 1 },
  { markdown: "- **parent**\n\n  - child\n  - another child\n\n- next parent", breaks: 0 },
  { markdown: "- parent\n  - first line\n    second line", breaks: 1 },
  { markdown: "- **first**\n  **second**", breaks: 1 },
  { markdown: "**first\nsecond** and [link\nlabel](https://example.com)", breaks: 2 },
  { markdown: "> first line\n> second line", breaks: 1 },
  { markdown: "- [ ] first line\n  second line\n- [x] done", breaks: 1 },
  { markdown: "first line  \nsecond line\\\nthird line\nfourth line", breaks: 3 },
  { markdown: "first line\r\nsecond line", breaks: 1 },
  { markdown: "first line\rsecond line", breaks: 1 },
  { markdown: "- first line\r  second line", breaks: 1 },
  { markdown: "1. first line\r   second line", breaks: 1 },
  { markdown: "> first line\r> second line", breaks: 1 },
  { markdown: "**first\rsecond**", breaks: 1 },
  { markdown: "first\rsecond\r\nthird\nfourth", breaks: 3 },
  { markdown: "- **parent**\r\r  - child\r  - another child\r\r- next parent", breaks: 0 },
  { markdown: "```text\rfirst line\rsecond line\r```", breaks: 0 },
  { markdown: "# first line\n\n```text\nfirst line\nsecond line\n```", breaks: 0 },
  { markdown: "`first\nsecond`\nnext line", breaks: 1 }
];

for (const { markdown, breaks } of lineBreakCases) {
  const html = render(markdown);
  assert.equal((html.match(/<br\/>/g) ?? []).length, breaks, markdown);
  const textHtml = html.replace(/<br\/>/g, "");
  const originalTextHtml = render(markdown, false).replace(/<br\/>/g, "");
  // Break nodes emit LF; CR may become LF, but text lengths and block structure must stay stable.
  assert.equal(textHtml.length, originalTextHtml.length, markdown);
  assert.equal(textHtml.replace(/\r/g, "\n"), originalTextHtml.replace(/\r/g, "\n"), markdown);
}

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
assert.ok(documentHtml.includes("first line<br/>\nsecond line"));
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
