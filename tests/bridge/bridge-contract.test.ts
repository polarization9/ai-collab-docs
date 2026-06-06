import { describe, expect, test } from "vitest";
import { createBridgePrompt, dispatchReviewEvents } from "../../src/server/bridge.js";
import {
  createAnnotation,
  createReviewEvent,
  loadReviewFile,
  markReviewEventDelivering
} from "../../src/server/review.js";
import { createTempFixture, writeCodexLink } from "../helpers/fixtures.js";

function documentAnchor() {
  return {
    kind: "document" as const,
    headingId: null,
    headingText: null,
    selectedText: "",
    anchorPrecision: "heading" as const
  };
}

describe("P0 Codex bridge contract", () => {
  test("prompt contains routing fields, MCP steps, and source/successor guidance", () => {
    const sourcePrompt = createBridgePrompt({
      documentPath: "/tmp/中文 path/doc.md",
      annotationId: "ann_123",
      eventId: "evt_123",
      targetType: "source"
    });
    expect(sourcePrompt).toContain("/tmp/中文 path/doc.md");
    expect(sourcePrompt).toContain("ann_123");
    expect(sourcePrompt).toContain("evt_123");
    expect(sourcePrompt).toContain("reviewer_get_annotation_context");
    expect(sourcePrompt).toContain("reviewer_mark_review_event_handled");
    expect(sourcePrompt).toContain("来源 Codex 会话");

    const successorPrompt = createBridgePrompt({
      documentPath: "/tmp/doc.md",
      annotationId: "ann_456",
      eventId: "evt_456",
      targetType: "successor"
    });
    expect(successorPrompt).toContain("接续对话");
    expect(successorPrompt).toContain("不要假设自己拥有完整历史讨论");
  });

  test("queued event fails clearly when no adapter is available and keeps retryable state", async () => {
    const fixture = await createTempFixture();
    const previousDisable = process.env.MARGENT_DISABLE_CODEX_BRIDGE;
    process.env.MARGENT_DISABLE_CODEX_BRIDGE = "1";
    try {
      await writeCodexLink(fixture.markdownPath, {
        source: {
          type: "codex",
          threadId: "thread-source",
          cwd: fixture.dir,
          createdAt: "2026-06-06T00:00:00.000Z",
          updatedAt: "2026-06-06T00:00:00.000Z"
        },
        target: {
          type: "source",
          threadId: "thread-source",
          cwd: fixture.dir,
          configuredAt: "2026-06-06T00:00:00.000Z",
          configuredBy: "codex",
          configuredVia: "source"
        }
      });
      const review = await createAnnotation(fixture.markdownPath, {
        body: "send me",
        anchor: documentAnchor()
      });
      const annotationId = review.annotations[0].id;
      await createReviewEvent(fixture.markdownPath, { annotationId, deliveryMode: "manual" });

      const result = await dispatchReviewEvents(fixture.markdownPath);
      expect(result.ok).toBe(false);
      expect(result.event?.deliveryStatus).toBe("failed");
      expect(result.event?.lastError).toContain("No available Codex Bridge adapter");
      expect(result.event?.attemptCount).toBe(1);
    } finally {
      if (previousDisable === undefined) {
        delete process.env.MARGENT_DISABLE_CODEX_BRIDGE;
      } else {
        process.env.MARGENT_DISABLE_CODEX_BRIDGE = previousDisable;
      }
      await fixture.cleanup();
    }
  });

  test("active events prevent dispatching later queued events", async () => {
    const fixture = await createTempFixture();
    try {
      const first = await createAnnotation(fixture.markdownPath, {
        body: "first",
        anchor: documentAnchor()
      });
      const firstId = first.annotations[0].id;
      let review = await createReviewEvent(fixture.markdownPath, {
        annotationId: firstId,
        deliveryMode: "auto"
      });
      const firstEventId = review.events?.[0].id as string;
      await markReviewEventDelivering(fixture.markdownPath, firstEventId, "app-server");

      review = await createAnnotation(fixture.markdownPath, {
        body: "second",
        anchor: documentAnchor()
      });
      const secondId = review.annotations.at(-1)?.id as string;
      await createReviewEvent(fixture.markdownPath, {
        annotationId: secondId,
        deliveryMode: "auto"
      });

      const result = await dispatchReviewEvents(fixture.markdownPath);
      const finalReview = await loadReviewFile(fixture.markdownPath);
      expect(result.ok).toBe(true);
      expect(finalReview.events?.find((event) => event.id === firstEventId)?.deliveryStatus).toBe("delivering");
      expect(finalReview.events?.find((event) => event.annotationId === secondId)?.deliveryStatus).toBe("queued");
    } finally {
      await fixture.cleanup();
    }
  });
});
