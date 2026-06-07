import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    templateName: string;
    documentName: string;
  }
> = {
  "zh-CN": {
    templateName: "Margent Quickstart.md",
    documentName: "Margent Quickstart.md"
  },
  "en-US": {
    templateName: "Margent Quickstart.en.md",
    documentName: "Margent Quickstart.en.md"
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
  externalRefreshEnabled: true
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

  const templatePath = findQuickstartTemplatePath(quickstart.templateName);
  if (!templatePath) {
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
        await fs.copyFile(templatePath, documentPath, fsSync.constants.COPYFILE_EXCL);
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
  templateName: string;
  documentName: string;
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

function findQuickstartTemplatePath(templateName: string): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = process.env.MARGENT_QUICKSTART_TEMPLATE_DIR;
  const candidates = [
    process.env.MARGENT_QUICKSTART_TEMPLATE_PATH,
    templateDir ? path.resolve(templateDir, templateName) : undefined,
    path.resolve(moduleDir, "..", "..", "examples", templateName),
    path.resolve(process.cwd(), "examples", templateName)
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fsSync.existsSync(candidate)) ?? null;
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
        : DEFAULT_SETTINGS.externalRefreshEnabled
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
