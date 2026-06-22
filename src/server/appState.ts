import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  AppLanguage,
  AppSettings,
  RecentDocument,
  ResolvedLocale
} from "../shared/appSettingsTypes.js";

const MAX_RECENT_DOCUMENTS = 12;
const QUICKSTART_TEMPLATE_VERSION = 1;
const appStateMutationQueues = new Map<string, Promise<unknown>>();

const QUICKSTART_TEMPLATES: Record<
  ResolvedLocale,
  {
    documentName: string;
    content: string;
  }
> = {
  "zh-CN": {
    documentName: "Margent Quickstart.md",
    content: `# Margent Quickstart

欢迎使用 Margent。这是一份内置示例文档，适合用来快速体验阅读、批注、轻编辑和 Agent 协作。

## 1. 阅读

Margent 会把 Markdown 渲染成适合审阅的阅读界面。你可以从左侧目录跳转章节，在正文里选择任意文本创建批注。

试着选中这句话，然后添加一条批注。

## 2. 批注

批注会保存在同目录的 \`.review.json\` 文件里，不会改动 Markdown 正文。你可以回复、编辑、删除批注，也可以把批注标记为已解决。

## 3. Mermaid

Margent 支持 Mermaid 图表渲染。下面这个流程图展示了一个典型的本地审阅闭环。

\`\`\`mermaid
flowchart LR
  A[打开 Markdown] --> B[阅读与批注]
  B --> C[轻量编辑]
  B --> D[发送给 Agent]
  D --> E[Agent 通过 MCP 处理]
  E --> B
\`\`\`

## 4. 表格

宽表可以横向滚动，也可以拖拽列宽。

| 场景 | Margent 行为 | 本地文件 |
| --- | --- | --- |
| 阅读文档 | 渲染 Markdown、Mermaid、代码块和表格 | \`.md\` |
| 添加批注 | 保存批注、回复和状态 | \`.review.json\` |
| 连接 Agent | 保存来源会话和接续会话信息 | \`.margent-agent.json\` |

## 5. 轻编辑

点击文档右上角的编辑按钮，可以直接修改 Markdown 正文。保存后，Margent 会尽量让原有批注继续定位到对应文本。

你可以把这一段改成自己的测试内容，然后按 \`Ctrl+S\` 保存。

## 6. Agent 协作

如果这份文档来自 Codex 或其他 Agent，Margent 可以记录来源会话。你也可以把批注发送给当前 Agent，让 Agent 读取批注、回复批注，或按需要修改正文。

第一次体验时，不需要先配置 Agent。打开文档、添加批注、切换编辑态这些核心功能都可以直接使用。
`
  },
  "en-US": {
    documentName: "Margent Quickstart.en.md",
    content: `# Margent Quickstart

Welcome to Margent. This built-in example document helps you try the main reading, annotation, light editing, and Agent collaboration workflows.

## 1. Reading

Margent renders Markdown as a review-friendly reading surface. You can use the table of contents to jump between sections, then select text in the document to create annotations.

Try selecting this sentence, then add an annotation.

## 2. Annotations

Annotations are saved next to the Markdown file in a \`.review.json\` file. They do not change the Markdown content itself.

You can reply to an annotation, edit it, delete it, or mark it as resolved.

## 3. Mermaid

Margent supports Mermaid diagrams. This flowchart shows a typical local review loop.

\`\`\`mermaid
flowchart LR
  A[Open Markdown] --> B[Read and annotate]
  B --> C[Light edit]
  B --> D[Send to Agent]
  D --> E[Agent handles the annotation through MCP]
  E --> B
\`\`\`

## 4. Tables

Wide tables can scroll horizontally. You can also drag column edges to adjust column width.

| Scenario | What Margent does | Local file |
| --- | --- | --- |
| Read a document | Renders Markdown, Mermaid, code blocks, and tables | \`.md\` |
| Add annotations | Saves comments, replies, and status | \`.review.json\` |
| Connect Agent | Saves source and successor session information | \`.margent-agent.json\` |

## 5. Light Editing

Use the edit button in the upper-right document controls to make lightweight Markdown changes. After saving, Margent tries to keep existing annotations attached to the matching text.

You can edit this paragraph as a quick test, then press \`Ctrl+S\` to save.

## 6. Agent Collaboration

If this document came from Codex or another Agent, Margent can remember the source session. You can also send annotations to the current Agent so it can read the annotation, reply to it, or update the Markdown when the requested change is clear.

You do not need to configure an Agent for your first try. Opening this document, adding annotations, switching to edit mode, and saving changes all work locally.
`
  }
};

type StoredRecentDocument = Omit<RecentDocument, "exists">;

type QuickstartState = {
  initializedAt: string;
  documentPath: string;
  locale?: ResolvedLocale;
  templateVersion: number;
};

const DEFAULT_SETTINGS: AppSettings = {
  language: "system",
  colorScheme: "default",
  startupBehavior: "empty",
  codexSourceDiscoveryEnabled: true,
  externalRefreshEnabled: true,
  autoCheckUpdatesEnabled: true
};

export async function loadAppSettings(): Promise<AppSettings> {
  const stored = await readJson<Partial<AppSettings>>(getSettingsPath(), {});
  return normalizeSettings(stored);
}

export async function saveAppSettings(next: Partial<AppSettings>): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  return withAppStateMutation(settingsPath, async () => {
    const current = normalizeSettings(await readJson<Partial<AppSettings>>(settingsPath, {}));
    const settings = normalizeSettings({ ...current, ...next });
    await writeJson(settingsPath, settings);
    return settings;
  });
}

export async function listRecentDocuments(): Promise<RecentDocument[]> {
  await ensureQuickstartRecentDocument();
  const stored = await readRecentDocumentEntries();
  return normalizeRecentDocuments(stored);
}

export async function rememberRecentDocument(documentPath: string): Promise<void> {
  await ensureQuickstartRecentDocument();
  const recentDocumentsPath = getRecentDocumentsPath();
  await withAppStateMutation(recentDocumentsPath, async () => {
    const existing = await readRecentDocumentEntries();
    const normalizedPath = path.resolve(documentPath);
    const next = [
      {
        path: normalizedPath,
        name: path.basename(normalizedPath),
        lastOpenedAt: new Date().toISOString()
      },
      ...existing
        .filter((item) => path.resolve(item.path) !== normalizedPath)
        .map(({ path: itemPath, name, lastOpenedAt }) => ({
          path: itemPath,
          name,
          lastOpenedAt
        }))
    ].slice(0, MAX_RECENT_DOCUMENTS);

    await writeJson(recentDocumentsPath, next);
  });
}

export async function removeRecentDocument(documentPath: string): Promise<RecentDocument[]> {
  await ensureQuickstartRecentDocument();
  const recentDocumentsPath = getRecentDocumentsPath();
  return withAppStateMutation(recentDocumentsPath, async () => {
    const normalizedPath = path.resolve(documentPath);
    const existing = await readRecentDocumentEntries();
    const next = existing
      .filter((item) => path.resolve(item.path) !== normalizedPath)
      .map(({ path: itemPath, name, lastOpenedAt }) => ({
        path: itemPath,
        name,
        lastOpenedAt
      }));

    await writeJson(recentDocumentsPath, next);
    return normalizeRecentDocuments(next);
  });
}

async function readRecentDocumentEntries(): Promise<StoredRecentDocument[]> {
  return readJson<StoredRecentDocument[]>(getRecentDocumentsPath(), []);
}

function normalizeRecentDocuments(stored: StoredRecentDocument[]): RecentDocument[] {
  return stored
    .filter((item) => typeof item.path === "string" && item.path.trim())
    .slice(0, MAX_RECENT_DOCUMENTS)
    .map((item) => ({
      path: item.path,
      name: item.name || path.basename(item.path),
      lastOpenedAt: item.lastOpenedAt,
      exists: fsSync.existsSync(item.path)
    }));
}

async function ensureQuickstartRecentDocument(): Promise<void> {
  if (process.env.MARGENT_DISABLE_QUICKSTART_RECENT === "1") {
    return;
  }

  const settings = await loadAppSettings();
  const quickstart = getQuickstartTemplate(settings.language);
  const statePath = getQuickstartStatePath();
  const existingState = await readJson<Partial<QuickstartState>>(statePath, {});
  if (
    existingState.templateVersion === QUICKSTART_TEMPLATE_VERSION &&
    typeof existingState.documentPath === "string"
  ) {
    return;
  }

  const documentPath = path.resolve(getQuickstartDocumentPath(quickstart.documentName));
  const recentDocumentsPath = getRecentDocumentsPath();
  try {
    await withAppStateMutation(recentDocumentsPath, async () => {
      const latestState = await readJson<Partial<QuickstartState>>(statePath, {});
      if (
        latestState.templateVersion === QUICKSTART_TEMPLATE_VERSION &&
        typeof latestState.documentPath === "string"
      ) {
        return;
      }

      await fs.mkdir(path.dirname(documentPath), { recursive: true });
      try {
        await fs.writeFile(documentPath, quickstart.content, {
          encoding: "utf8",
          flag: "wx"
        });
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") {
          throw error;
        }
      }

      const existing = await readRecentDocumentEntries();
      const alreadyListed = existing.some((item) => path.resolve(item.path) === documentPath);
      if (!alreadyListed) {
        await writeJson(
          recentDocumentsPath,
          [
            {
              path: documentPath,
              name: quickstart.documentName,
              lastOpenedAt: new Date().toISOString()
            },
            ...existing
          ].slice(0, MAX_RECENT_DOCUMENTS)
        );
      }

      await writeJson(statePath, {
        initializedAt: new Date().toISOString(),
        documentPath,
        locale: quickstart.locale,
        templateVersion: QUICKSTART_TEMPLATE_VERSION
      } satisfies QuickstartState);
    });
  } catch (error) {
    console.warn(
      `Unable to initialize Margent Quickstart: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function getQuickstartTemplate(language: AppLanguage): {
  locale: ResolvedLocale;
  documentName: string;
  content: string;
} {
  const locale = resolveQuickstartLocale(language);
  return { locale, ...QUICKSTART_TEMPLATES[locale] };
}

function resolveQuickstartLocale(language: AppLanguage): ResolvedLocale {
  if (language === "zh-CN" || language === "en-US") {
    return language;
  }

  const systemLanguage = [
    process.env.MARGENT_SYSTEM_LANGUAGE,
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale
  ].find((value) => typeof value === "string" && value.trim());

  return systemLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function getQuickstartDocumentPath(documentName: string): string {
  const documentDir =
    process.env.MARGENT_QUICKSTART_DOCUMENT_DIR ??
    path.join(os.homedir(), "Documents", "Margent");
  return (
    process.env.MARGENT_QUICKSTART_DOCUMENT_PATH ??
    path.join(documentDir, documentName)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  return {
    language:
      value.language === "zh-CN" || value.language === "en-US" || value.language === "system"
        ? value.language
        : DEFAULT_SETTINGS.language,
    colorScheme:
      value.colorScheme === "blue-white" ||
      value.colorScheme === "gray-white" ||
      value.colorScheme === "default"
        ? value.colorScheme
        : DEFAULT_SETTINGS.colorScheme,
    startupBehavior:
      value.startupBehavior === "restore-last-documents" || value.startupBehavior === "empty"
        ? value.startupBehavior
        : DEFAULT_SETTINGS.startupBehavior,
    codexSourceDiscoveryEnabled:
      typeof value.codexSourceDiscoveryEnabled === "boolean"
        ? value.codexSourceDiscoveryEnabled
        : DEFAULT_SETTINGS.codexSourceDiscoveryEnabled,
    externalRefreshEnabled:
      typeof value.externalRefreshEnabled === "boolean"
        ? value.externalRefreshEnabled
        : DEFAULT_SETTINGS.externalRefreshEnabled,
    autoCheckUpdatesEnabled:
      typeof value.autoCheckUpdatesEnabled === "boolean"
        ? value.autoCheckUpdatesEnabled
        : DEFAULT_SETTINGS.autoCheckUpdatesEnabled
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function withAppStateMutation<T>(
  filePath: string,
  mutation: () => Promise<T>
): Promise<T> {
  const queueKey = path.resolve(filePath);
  const previous = appStateMutationQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  const queued = next.catch(() => undefined).then(() => {
    if (appStateMutationQueues.get(queueKey) === queued) {
      appStateMutationQueues.delete(queueKey);
    }
  });
  appStateMutationQueues.set(queueKey, queued);
  return next;
}

function getSettingsPath(): string {
  return path.join(getAppDataDir(), "settings.json");
}

function getRecentDocumentsPath(): string {
  return path.join(getAppDataDir(), "recent-documents.json");
}

function getQuickstartStatePath(): string {
  return path.join(getAppDataDir(), "quickstart.json");
}

function getAppDataDir(): string {
  return process.env.MARGENT_APP_DATA_DIR ?? path.join(os.homedir(), ".margent");
}
