import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AppSettings,
  RecentDocument
} from "../shared/appSettingsTypes.js";

const MAX_RECENT_DOCUMENTS = 12;

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
  const current = await loadAppSettings();
  const settings = normalizeSettings({ ...current, ...next });
  await writeJson(getSettingsPath(), settings);
  return settings;
}

export async function listRecentDocuments(): Promise<RecentDocument[]> {
  const stored = await readJson<Array<Omit<RecentDocument, "exists">>>(
    getRecentDocumentsPath(),
    []
  );

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

export async function rememberRecentDocument(documentPath: string): Promise<void> {
  const existing = await listRecentDocuments();
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

  await writeJson(getRecentDocumentsPath(), next);
}

export async function removeRecentDocument(documentPath: string): Promise<RecentDocument[]> {
  const normalizedPath = path.resolve(documentPath);
  const existing = await listRecentDocuments();
  const next = existing
    .filter((item) => path.resolve(item.path) !== normalizedPath)
    .map(({ path: itemPath, name, lastOpenedAt }) => ({
      path: itemPath,
      name,
      lastOpenedAt
    }));

  await writeJson(getRecentDocumentsPath(), next);
  return listRecentDocuments();
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
    `.${path.basename(filePath)}.${process.pid}.tmp`
  );
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function getSettingsPath(): string {
  return path.join(getAppDataDir(), "settings.json");
}

function getRecentDocumentsPath(): string {
  return path.join(getAppDataDir(), "recent-documents.json");
}

function getAppDataDir(): string {
  return process.env.MARGENT_APP_DATA_DIR ?? path.join(os.homedir(), ".margent");
}
