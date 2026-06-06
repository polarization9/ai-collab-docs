import { afterEach, describe, expect, test } from "vitest";
import { startServer, type StartedServer } from "../../src/server/index.js";
import type { ReviewFile } from "../../src/shared/reviewTypes.js";
import type { ReviewBootstrap, ReviewDocument } from "../../src/shared/types.js";
import { createTempFixture, fetchJson, writeCodexLink } from "../helpers/fixtures.js";

const startedServers: StartedServer[] = [];

afterEach(async () => {
  await Promise.all(
    startedServers.splice(0).map(
      (started) =>
        new Promise<void>((resolve, reject) => {
          started.server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

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

describe("P0 server API coverage", () => {
  test("desktop token protects API while health remains public", async () => {
    const fixture = await createTempFixture();
    try {
      const started = await startServer({
        markdownPath: fixture.markdownPath,
        port: 0,
        desktopToken: "secret-token"
      });
      startedServers.push(started);

      const health = await fetchJson<{ ok: boolean }>(`${started.url}/health`);
      expect(health.status).toBe(200);
      expect(health.body.ok).toBe(true);

      const denied = await fetchJson<{ error: string }>(`${started.url}/api/session`);
      expect(denied.status).toBe(401);
      expect(denied.body.error).toContain("Invalid desktop session token");

      const allowed = await fetchJson(`${started.url}/api/session`, {
        headers: { "x-margent-token": "secret-token" }
      });
      expect(allowed.status).toBe(200);
    } finally {
      await fixture.cleanup();
    }
  });

  test("opens markdown, serves encoded local image assets, and reads review state", async () => {
    const fixture = await createTempFixture();
    try {
      const started = await startServer({ markdownPath: fixture.markdownPath, port: 0 });
      startedServers.push(started);

      const bootstrap = await fetchJson<ReviewBootstrap>(`${started.url}/api/bootstrap`);
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.body.hasDocument).toBe(true);
      expect(bootstrap.body.document?.relativePath).toContain("p0 mixed path 文档.md");

      const document = await fetchJson<ReviewDocument>(`${started.url}/api/document`);
      expect(document.body.headings.map((heading) => heading.text)).toContain("阅读能力");
      expect(document.body.content).toContain("local%20image%20with%20space.svg");

      const asset = await fetch(
        `${started.url}/api/document-asset?src=${encodeURIComponent(
          "images/local image with space.svg"
        )}`
      );
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("<svg");

      const chineseAsset = await fetch(
        `${started.url}/api/document-asset?src=${encodeURIComponent("images/中文图片.svg")}`
      );
      expect(chineseAsset.status).toBe(200);
      expect(await chineseAsset.text()).toContain("<svg");
    } finally {
      await fixture.cleanup();
    }
  });

  test("annotation lifecycle and auto/manual Codex events follow API contract", async () => {
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
        },
        bridge: { autoSendNewAnnotations: true }
      });

      const started = await startServer({ markdownPath: fixture.markdownPath, port: 0 });
      startedServers.push(started);

      const created = await fetchJson<ReviewFile>(`${started.url}/api/review/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "需要补充说明",
          anchor: textAnchor()
        })
      });
      expect(created.status).toBe(201);
      expect(created.body.annotations).toHaveLength(1);
      expect(created.body.events).toHaveLength(1);
      expect(created.body.events?.[0].deliveryMode).toBe("auto");

      const annotationId = created.body.annotations[0].id;
      const replied = await fetchJson<ReviewFile>(
        `${started.url}/api/review/annotations/${annotationId}/replies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "已处理" })
        }
      );
      expect(replied.body.annotations[0].replies).toHaveLength(1);

      const resolved = await fetchJson<ReviewFile>(
        `${started.url}/api/review/annotations/${annotationId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "resolved" })
        }
      );
      expect(resolved.body.annotations[0].status).toBe("resolved");

      const reopened = await fetchJson<ReviewFile>(
        `${started.url}/api/review/annotations/${annotationId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "open" })
        }
      );
      expect(reopened.body.annotations[0].status).toBe("open");

      await fetchJson(`${started.url}/api/codex-link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bridge: { autoSendNewAnnotations: false } })
      });

      const manualAnnotation = await fetchJson<ReviewFile>(`${started.url}/api/review/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "手动发送",
          anchor: { kind: "document", headingId: null, headingText: null, selectedText: "" }
        })
      });
      expect(manualAnnotation.body.events).toHaveLength(1);

      const manualId = manualAnnotation.body.annotations.at(-1)?.id;
      const sent = await fetchJson<{ review: ReviewFile; event?: { deliveryMode: string; deliveryStatus: string } }>(
        `${started.url}/api/bridge/annotations/${manualId}/send`,
        { method: "POST" }
      );
      expect(sent.body.review.events?.some((event) => event.deliveryMode === "manual")).toBe(true);
      expect(sent.body.event?.deliveryMode).toBe("manual");
      expect(sent.body.event?.deliveryStatus).toBe("failed");
    } finally {
      if (previousDisable === undefined) {
        delete process.env.MARGENT_DISABLE_CODEX_BRIDGE;
      } else {
        process.env.MARGENT_DISABLE_CODEX_BRIDGE = previousDisable;
      }
      await fixture.cleanup();
    }
  });
});
