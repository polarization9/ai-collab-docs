import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { createServer, type ViteDevServer } from "vite";
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { startServer, type StartedServer } from "../../../src/server/index.js";
import type { AppSettings } from "../../../src/shared/appSettingsTypes.js";
import type { CodexDocumentLink } from "../../../src/shared/codexTypes.js";
import type {
  AddReplyRequest,
  CreateAnnotationRequest,
  ReviewAnchor,
  ReviewFile
} from "../../../src/shared/reviewTypes.js";
import { createTempFixture, writeCodexLink } from "../../helpers/fixtures.js";

export type MargentE2eApp = {
  url: string;
  apiUrl: string;
  fixture: Awaited<ReturnType<typeof createTempFixture>>;
  setSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  createAnnotation(request: CreateAnnotationRequest): Promise<ReviewFile>;
  addReply(annotationId: string, request: AddReplyRequest): Promise<ReviewFile>;
  writeCodexLink(link: Partial<CodexDocumentLink>): Promise<void>;
  open(page: Page): Promise<void>;
  cleanup(): Promise<void>;
};

export async function startMargentE2e(testInfo: TestInfo): Promise<MargentE2eApp> {
  const fixture = await createTempFixture();
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "margent-e2e-app-state-"));
  const previousAppDataDir = process.env.MARGENT_APP_DATA_DIR;
  const previousDisableBridge = process.env.MARGENT_DISABLE_CODEX_BRIDGE;
  process.env.MARGENT_APP_DATA_DIR = appDataDir;
  process.env.MARGENT_DISABLE_CODEX_BRIDGE = "1";

  const started = await startServer({
    markdownPath: fixture.markdownPath,
    port: 0
  });
  const vite = await createViteForApi(started.url);
  const url = getViteUrl(vite);

  async function cleanup() {
    await vite.close();
    await closeStartedServer(started);
    await fixture.cleanup();
    await fs.rm(appDataDir, { recursive: true, force: true });
    if (previousAppDataDir === undefined) {
      delete process.env.MARGENT_APP_DATA_DIR;
    } else {
      process.env.MARGENT_APP_DATA_DIR = previousAppDataDir;
    }
    if (previousDisableBridge === undefined) {
      delete process.env.MARGENT_DISABLE_CODEX_BRIDGE;
    } else {
      process.env.MARGENT_DISABLE_CODEX_BRIDGE = previousDisableBridge;
    }
  }

  await testInfo.attach("margent-e2e-fixture", {
    body: JSON.stringify(
      {
        markdownPath: fixture.markdownPath,
        appDataDir,
        apiUrl: started.url,
        url
      },
      null,
      2
    ),
    contentType: "application/json"
  });

  return {
    url,
    apiUrl: started.url,
    fixture,
    setSettings: (settings) => putJson(started.url, "/api/app/settings", settings),
    createAnnotation: (request) => postJson(started.url, "/api/review/annotations", request),
    addReply: (annotationId, request) =>
      postJson(started.url, `/api/review/annotations/${annotationId}/replies`, request),
    writeCodexLink: (link) => writeCodexLink(fixture.markdownPath, link),
    async open(page) {
      await page.goto(url);
      await page.waitForLoadState("domcontentloaded");
    },
    cleanup
  };
}

export function textAnchor(selectedText = "重复文本用于测试精确锚点"): ReviewAnchor {
  return {
    kind: "text",
    headingId: "批注锚点",
    headingText: "批注锚点",
    blockId: "block-1",
    blockIndex: 1,
    startOffset: 0,
    endOffset: selectedText.length,
    selectedText,
    prefix: "",
    suffix: "。",
    anchorPrecision: "exact"
  };
}

export async function requestJson<T>(
  request: APIRequestContext,
  url: string
): Promise<T> {
  const response = await request.get(url);
  if (!response.ok()) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

async function createViteForApi(apiUrl: string): Promise<ViteDevServer> {
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: {
        "/api": {
          target: apiUrl,
          changeOrigin: true
        },
        "/health": {
          target: apiUrl,
          changeOrigin: true
        }
      }
    }
  });
  await vite.listen();
  return vite;
}

function getViteUrl(vite: ViteDevServer): string {
  const url = vite.resolvedUrls?.local[0];
  if (!url) {
    throw new Error("Unable to resolve Vite dev server URL.");
  }
  return url;
}

async function postJson<T>(apiUrl: string, route: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readJsonResponse<T>(response);
}

async function putJson<T>(apiUrl: string, route: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${route}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return readJsonResponse<T>(response);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

function closeStartedServer(started: StartedServer): Promise<void> {
  return new Promise((resolve, reject) => {
    started.server.close((error) => (error ? reject(error) : resolve()));
  });
}
