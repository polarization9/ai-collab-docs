import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  requestJson,
  startMargentE2e,
  textAnchor
} from "./support/margentE2e";
import type { ReviewDocument } from "../../src/shared/types";

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
