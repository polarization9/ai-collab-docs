import fs from "node:fs/promises";
import { describe, expect, test } from "vitest";
import {
  addAnnotationReply,
  createAnnotation,
  createReviewEvent,
  loadReviewFile,
  markReviewEventHandled,
  updateAnnotationStatus
} from "../../src/server/review.js";
import { loadReviewDocument } from "../../src/server/document.js";
import { saveReviewDocument } from "../../src/server/documentEdit.js";
import { getAnnotationContext } from "../../src/server/reviewContext.js";
import { createTempFixture } from "../helpers/fixtures.js";

describe("P0 MCP-equivalent reviewer contract", () => {
  test("reads context, edits document, replies, resolves, and marks event handled", async () => {
    const fixture = await createTempFixture();
    try {
      let review = await createAnnotation(fixture.markdownPath, {
        body: "把保存前内容改成保存后内容",
        anchor: {
          kind: "text",
          headingId: "编辑闭环",
          headingText: "编辑闭环",
          blockId: "block-edit",
          blockIndex: 1,
          startOffset: 0,
          endOffset: "保存前内容".length,
          selectedText: "保存前内容",
          prefix: "",
          suffix: "。",
          anchorPrecision: "exact"
        }
      });
      const annotationId = review.annotations[0].id;

      review = await createReviewEvent(fixture.markdownPath, {
        annotationId,
        deliveryMode: "manual"
      });
      const eventId = review.events?.[0].id;
      expect(eventId).toBeTruthy();

      const context = await getAnnotationContext(fixture.markdownPath, annotationId);
      expect(context.selectedText).toBe("保存前内容");
      expect(context.heading?.text).toBe("编辑闭环");
      expect(context.relatedMarkdown).toContain("## 编辑闭环");

      const document = await loadReviewDocument(fixture.markdownPath);
      const nextContent = document.content.replace("保存前内容", "保存后内容");
      const saved = await saveReviewDocument(
        fixture.markdownPath,
        {
          content: nextContent,
          baseContentHash: document.contentHash
        },
        {
          annotationId,
          preferredSelectedText: "保存后内容"
        }
      );
      expect(
        saved.repairedAnnotations.items.some((item) => item.annotationId === annotationId)
      ).toBe(true);

      await addAnnotationReply(fixture.markdownPath, annotationId, {
        body: "已改为保存后内容。"
      });
      await updateAnnotationStatus(fixture.markdownPath, annotationId, { status: "resolved" });
      await markReviewEventHandled(fixture.markdownPath, eventId as string);

      const finalReview = await loadReviewFile(fixture.markdownPath);
      const finalAnnotation = finalReview.annotations.find((item) => item.id === annotationId);
      expect(await fs.readFile(fixture.markdownPath, "utf8")).toContain("保存后内容");
      expect(finalAnnotation?.status).toBe("resolved");
      expect(finalAnnotation?.anchor.selectedText).toBe("保存后内容");
      expect(finalAnnotation?.replies.at(-1)?.body).toContain("已改为");
      expect(finalReview.events?.find((event) => event.id === eventId)?.deliveryStatus).toBe("handled");
    } finally {
      await fixture.cleanup();
    }
  });
});
