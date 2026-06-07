import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  requestJson,
  startMargentE2e,
  textAnchor
} from "./support/margentE2e";
import type { ReviewDocument } from "../../src/shared/types";
import type { ReviewFile } from "../../src/shared/reviewTypes";

test("P1 reading enhancements expose TOC, code, Mermaid, table, and local images", async ({
  page
}, testInfo) => {
  const app = await startMargentE2e(testInfo);
  try {
    await app.setSettings({ language: "zh-CN" });
    await app.open(page);

    await expect(page.getByRole("heading", { name: "P0 Fixture 文档" })).toBeVisible();
    await expect(page.getByText("Unable to load document")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "目录" })).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator('img[alt="space image"]')).toBeVisible();
    await expect(page.locator('img[alt="中文图片"]')).toBeVisible();

    await page.getByRole("button", { name: "收起目录" }).click();
    await expect(page.getByRole("button", { name: "打开目录" })).toBeVisible();
    await page.getByRole("button", { name: "打开目录" }).click();
    await expect(page.getByRole("navigation", { name: "目录" })).toBeVisible();

    await expect(page.getByRole("button", { name: "复制代码" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "查看源码" })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "查看源码" }).click();
    await expect(page.getByRole("button", { name: "切回图片" })).toBeVisible();
    await page.getByRole("button", { name: "切回图片" }).click();

    await page.getByRole("button", { name: "打开大图" }).click();
    await expect(page.getByRole("dialog", { name: "Mermaid 大图" })).toBeVisible();
  } finally {
    await app.cleanup();
  }
});

test("P1 in-document markdown hash links scroll to headings", async ({ page }, testInfo) => {
  const app = await startMargentE2e(testInfo);
  try {
    await fs.writeFile(
      app.fixture.markdownPath,
      `# Margent

[中文说明](#中文说明)

Margent is a local-first Markdown app.

${Array.from({ length: 24 }, (_, index) => `Filler paragraph ${index + 1}.`).join("\n\n")}

# 中文说明

这里是中文说明。
`,
      "utf8"
    );

    await app.open(page);
    await expect(page.getByRole("heading", { name: "Margent" })).toBeVisible();

    await page.getByRole("link", { name: "中文说明" }).click();

    await expect.poll(async () => page.evaluate(() => window.location.hash)).toContain(
      encodeURIComponent("中文说明")
    );
    await expect
      .poll(async () =>
        page.evaluate(() => document.getElementById("中文说明")?.getBoundingClientRect().top ?? -1)
      )
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(async () =>
        page.evaluate(() => document.getElementById("中文说明")?.getBoundingClientRect().top ?? -1)
      )
      .toBeLessThan(120);
  } finally {
    await app.cleanup();
  }
});

test("P1 annotation sidebar handles Codex state, agent replies, reopen, and delete confirmation", async ({
  page
}, testInfo) => {
  const app = await startMargentE2e(testInfo);
  try {
    await app.setSettings({ language: "zh-CN" });
    await app.writeCodexLink({
      source: {
        type: "codex",
        threadId: "thread-source",
        cwd: app.fixture.dir,
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z"
      },
      target: {
        type: "source",
        threadId: "thread-source",
        cwd: app.fixture.dir,
        configuredAt: "2026-06-06T00:00:00.000Z",
        configuredBy: "codex",
        configuredVia: "source"
      },
      bridge: { autoSendNewAnnotations: true }
    });

    const review = await app.createAnnotation({
      body: "P1 批注复杂状态",
      anchor: textAnchor()
    });
    const annotationId = review.annotations[0].id;
    await app.addReply(annotationId, {
      body: "Codex 已经处理过一轮。",
      author: { type: "agent", name: "Codex" }
    });

    await app.open(page);
    await page.getByRole("button", { name: "打开批注列表" }).click();
    await expect(page.getByLabel("Codex 连接状态")).toContainText("已检测到对应 Codex 会话");
    await expect(page.getByLabel("Codex 连接状态")).toContainText("自动");

    await page.getByRole("switch", { name: "关闭自动监控" }).click();
    await expect(page.getByLabel("Codex 连接状态")).toContainText("手动投递");

    await expect(page.getByText("P1 批注复杂状态")).toBeVisible();
    await page.getByText("P1 批注复杂状态").click();
    await expect(page.getByText("Codex 已经处理过一轮。")).toBeVisible();
    await expect(page.getByRole("button", { name: "回复 @Codex" })).toBeVisible();

    await page.locator(".annotation-card-actions").getByRole("button", { name: "回复" }).click();
    await page.getByLabel("回复这条批注").fill("人工补充回复");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText("人工补充回复")).toBeVisible();

    await page.getByRole("button", { name: "标记已解决" }).click();
    await expect(page.getByText("已解决").first()).toBeVisible();
    await page.getByRole("button", { name: "重新打开" }).click();
    await expect(page.getByText("未解决").first()).toBeVisible();

    await page.getByRole("button", { name: "删除批注" }).click();
    await expect(page.getByText("P1 批注复杂状态")).toBeVisible();
    await page.getByRole("button", { name: "确认删除批注" }).click();
    await expect(page.getByText("P1 批注复杂状态")).toHaveCount(0);
  } finally {
    await app.cleanup();
  }
});

test("P1 cross-block text selections create line-level range annotations", async ({
  page,
  request
}, testInfo) => {
  const app = await startMargentE2e(testInfo);
  try {
    await app.setSettings({ language: "zh-CN" });
    await app.open(page);
    await expect(page.getByRole("heading", { name: "阅读能力" })).toBeVisible();

    await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll<HTMLElement>("[data-review-block-id]"));
      const startBlock = blocks.find((block) => block.textContent?.trim() === "阅读能力");
      const endBlock = blocks.find((block) =>
        block.textContent?.includes("这是一份包含中文路径")
      );
      if (!startBlock || !endBlock || !startBlock.firstChild || !endBlock.firstChild) {
        throw new Error("Unable to find cross-block selection targets.");
      }

      const range = document.createRange();
      range.setStart(startBlock.firstChild, 0);
      range.setEnd(endBlock.firstChild, endBlock.textContent?.length ?? 0);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    await page.getByRole("button", { name: "添加批注" }).click();
    await page.getByPlaceholder("写下问题或修改建议").fill("跨段范围批注");
    await page.locator(".annotation-composer-actions").getByRole("button", { name: "保存" }).click();

    const review = await requestJson<ReviewFile>(request, `${app.apiUrl}/api/review`);
    const annotation = review.annotations.find((item) => item.body === "跨段范围批注");
    expect(annotation?.anchor.kind).toBe("range");
    if (annotation?.anchor.kind !== "range") {
      throw new Error("Expected a range anchor.");
    }
    expect(annotation.anchor.startBlockId).not.toBe(annotation.anchor.endBlockId);
    expect(annotation.anchor.startBlockIndex).toBeLessThan(annotation.anchor.endBlockIndex);
    expect(annotation.anchor.selectedText).toContain("阅读能力");
    expect(annotation.anchor.selectedText).toContain("这是一份包含中文路径");

    await expect.poll(async () => page.locator(".annotation-highlight").count()).toBeGreaterThan(1);
    const highlightWidths = await page.locator(".annotation-highlight").evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width)
    );
    const articleWidth = await page.locator(".document-content").evaluate(
      (node) => node.getBoundingClientRect().width
    );
    expect(Math.max(...highlightWidths)).toBeLessThan(articleWidth * 0.92);
  } finally {
    await app.cleanup();
  }
});

test("P1 settings window switches language and theme tokens", async ({ page }, testInfo) => {
  const app = await startMargentE2e(testInfo);
  try {
    await app.setSettings({ language: "zh-CN", colorScheme: "default" });
    await page.goto(`${app.url}?settingsWindow=1`);

    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Color scheme")).toBeVisible();

    await page.getByRole("button", { name: "Gray White" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "gray-white");

    await page.getByRole("button", { name: "中文" }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await page.getByRole("button", { name: "蓝白" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "blue-white");
  } finally {
    await app.cleanup();
  }
});

test("P1 external file changes refresh the visible document", async ({ page, request }, testInfo) => {
  const app = await startMargentE2e(testInfo);
  try {
    await app.setSettings({ language: "zh-CN", externalRefreshEnabled: true });
    await app.open(page);

    await expect(page.getByText("保存前内容。")).toBeVisible();
    const initialDocument = await requestJson<ReviewDocument>(request, `${app.apiUrl}/api/document`);
    await fs.writeFile(
      app.fixture.markdownPath,
      initialDocument.content.replace("保存前内容", "外部修改后的内容"),
      "utf8"
    );

    await expect(page.getByText("外部修改后的内容。")).toBeVisible({ timeout: 9000 });
  } finally {
    await app.cleanup();
  }
});
