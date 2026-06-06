import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseHeadings } from "../../src/shared/markdownHeadings.js";
import { parseMarkdownBlocks } from "../../src/server/markdownBlocks.js";
import {
  addAnnotationReply,
  createAnnotation,
  loadReviewFile
} from "../../src/server/review.js";
import {
  getCodexLinkPath,
  getReviewPath,
  isMarkdownPath
} from "../../src/server/paths.js";
import {
  getCodexLinkResponse,
  loadCodexDocumentLink,
  updateCodexDocumentLink
} from "../../src/server/codexLink.js";
import { loadReviewDocument } from "../../src/server/document.js";
import { DocumentConflictError, saveReviewDocument } from "../../src/server/documentEdit.js";
import {
  listRecentDocuments,
  loadAppSettings,
  rememberRecentDocument,
  saveAppSettings
} from "../../src/server/appState.js";
import { createTempFixture } from "../helpers/fixtures.js";

function textAnchor(selectedText = "重复文本用于测试精确锚点") {
  return {
    kind: "text" as const,
    headingId: "批注锚点",
    headingText: "批注锚点",
    blockId: "block-1",
    blockIndex: 1,
    startOffset: 0,
    endOffset: selectedText.length,
    selectedText,
    prefix: "",
    suffix: "。",
    anchorPrecision: "exact" as const
  };
}

describe("P0 unit coverage", () => {
  test("path helpers preserve Chinese and space filenames", async () => {
    const fixture = await createTempFixture();
    try {
      expect(isMarkdownPath(fixture.markdownPath)).toBe(true);
      expect(getReviewPath(fixture.markdownPath)).toBe(
        path.join(fixture.dir, "markdown", "p0 mixed path 文档.review.json")
      );
      expect(getCodexLinkPath(fixture.markdownPath)).toBe(
        path.join(fixture.dir, "markdown", "p0 mixed path 文档.codex.json")
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("heading parser ignores headings inside code fences", () => {
    const headings = parseHeadings(`# Real

\`\`\`md
# Not a heading
\`\`\`

## 中文标题
`);

    expect(headings).toEqual([
      { id: "real", level: 1, text: "Real" },
      { id: "中文标题", level: 2, text: "中文标题" }
    ]);
  });

  test("markdown block offsets preserve CRLF newline width", () => {
    const markdown = "# A\r\n\r\n## B\r\nSame sentence.\r\n\r\n## C\r\nOther.\r\n";
    const parsed = parseMarkdownBlocks(markdown);
    const paragraph = parsed.blocks.find((block) => block.text.includes("Same sentence."));

    expect(paragraph).toBeDefined();
    if (!paragraph) {
      return;
    }
    expect(paragraph.start).toBe(markdown.indexOf("Same sentence."));
    expect(markdown.slice(paragraph.start, paragraph.end)).toBe("Same sentence.\r\n");
  });

  test("concurrent review writes keep valid JSON and do not drop annotations or replies", async () => {
    const fixture = await createTempFixture();
    try {
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          createAnnotation(fixture.markdownPath, {
            body: `annotation ${index}`,
            anchor: textAnchor()
          })
        )
      );

      const review = await loadReviewFile(fixture.markdownPath);
      expect(review.annotations).toHaveLength(8);

      const annotationId = review.annotations[0].id;
      await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          addAnnotationReply(fixture.markdownPath, annotationId, {
            body: `reply ${index}`
          })
        )
      );

      const nextReview = await loadReviewFile(fixture.markdownPath);
      expect(nextReview.annotations.find((item) => item.id === annotationId)?.replies).toHaveLength(6);

      const raw = await fs.readFile(getReviewPath(fixture.markdownPath), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
      const tempFiles = (await fs.readdir(path.dirname(fixture.markdownPath))).filter((name) =>
        name.endsWith(".tmp")
      );
      expect(tempFiles).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  test("concurrent codex link writes keep valid JSON and resolve source targets", async () => {
    const fixture = await createTempFixture();
    try {
      await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          updateCodexDocumentLink(fixture.markdownPath, {
            source: {
              type: "codex",
              threadId: `thread-${index}`,
              cwd: fixture.dir,
              createdAt: "2026-06-06T00:00:00.000Z",
              updatedAt: "2026-06-06T00:00:00.000Z"
            },
            bridge: {
              autoSendNewAnnotations: index % 2 === 0
            }
          })
        )
      );

      const link = await loadCodexDocumentLink(fixture.markdownPath);
      const response = await getCodexLinkResponse(fixture.markdownPath);
      expect(link?.source?.threadId).toMatch(/^thread-/);
      expect(response.connection.hasTarget).toBe(true);
      expect(response.connection.targetType).toBe("source");

      const raw = await fs.readFile(getCodexLinkPath(fixture.markdownPath), "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
      const tempFiles = (await fs.readdir(path.dirname(fixture.markdownPath))).filter((name) =>
        name.endsWith(".tmp")
      );
      expect(tempFiles).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  test("concurrent document saves reject stale base hashes instead of overwriting", async () => {
    const fixture = await createTempFixture();
    try {
      const document = await loadReviewDocument(fixture.markdownPath);
      const firstContent = document.content.replace("保存前内容", "第一版内容");
      const secondContent = document.content.replace("保存前内容", "第二版内容");

      const results = await Promise.allSettled([
        saveReviewDocument(fixture.markdownPath, {
          content: firstContent,
          baseContentHash: document.contentHash
        }),
        saveReviewDocument(fixture.markdownPath, {
          content: secondContent,
          baseContentHash: document.contentHash
        })
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status).toBe("rejected");
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(DocumentConflictError);

      const finalContent = await fs.readFile(fixture.markdownPath, "utf8");
      expect([finalContent.includes("第一版内容"), finalContent.includes("第二版内容")]).toEqual(
        expect.arrayContaining([true, false])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("document save anchor repair does not drop concurrent annotation replies", async () => {
    const fixture = await createTempFixture();
    try {
      const review = await createAnnotation(fixture.markdownPath, {
        body: "编辑闭环批注",
        anchor: textAnchor("保存前内容")
      });
      const annotationId = review.annotations[0].id;
      const document = await loadReviewDocument(fixture.markdownPath);

      await Promise.all([
        saveReviewDocument(
          fixture.markdownPath,
          {
            content: document.content.replace("保存前内容", "保存后内容"),
            baseContentHash: document.contentHash
          },
          {
            annotationId,
            preferredSelectedText: "保存后内容"
          }
        ),
        addAnnotationReply(fixture.markdownPath, annotationId, {
          body: "并发回复"
        })
      ]);

      const finalReview = await loadReviewFile(fixture.markdownPath);
      const finalAnnotation = finalReview.annotations.find((item) => item.id === annotationId);
      expect(finalAnnotation?.anchor.selectedText).toBe("保存后内容");
      expect(finalAnnotation?.replies.at(-1)?.body).toBe("并发回复");
    } finally {
      await fixture.cleanup();
    }
  });

  test("app state writes merge concurrent updates and avoid tmp collisions", async () => {
    const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "margent-app-state-"));
    const previousAppDataDir = process.env.MARGENT_APP_DATA_DIR;
    process.env.MARGENT_APP_DATA_DIR = appDataDir;
    try {
      await Promise.all([
        saveAppSettings({ language: "zh-CN" }),
        saveAppSettings({ colorScheme: "gray-white" }),
        saveAppSettings({ externalRefreshEnabled: false })
      ]);
      const settings = await loadAppSettings();
      expect(settings.language).toBe("zh-CN");
      expect(settings.colorScheme).toBe("gray-white");
      expect(settings.externalRefreshEnabled).toBe(false);

      const documentPaths = await Promise.all(
        Array.from({ length: 6 }, async (_, index) => {
          const filePath = path.join(appDataDir, `recent-${index}.md`);
          await fs.writeFile(filePath, `# Recent ${index}\n`, "utf8");
          return filePath;
        })
      );
      await Promise.all(documentPaths.map((filePath) => rememberRecentDocument(filePath)));
      const recent = await listRecentDocuments();
      expect(recent).toHaveLength(6);

      const tempFiles = (await fs.readdir(appDataDir)).filter((name) => name.endsWith(".tmp"));
      expect(tempFiles).toEqual([]);
    } finally {
      if (previousAppDataDir === undefined) {
        delete process.env.MARGENT_APP_DATA_DIR;
      } else {
        process.env.MARGENT_APP_DATA_DIR = previousAppDataDir;
      }
      await fs.rm(appDataDir, { recursive: true, force: true });
    }
  });
});
