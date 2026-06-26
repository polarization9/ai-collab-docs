import { isTauriRuntime } from "./desktop";

export type AppUpdateState =
  | { status: "unsupported"; message?: string }
  | { status: "idle"; lastCheckedAt?: string }
  | { status: "checking" }
  | {
      status: "available";
      version: string;
      notes?: string;
      date?: string;
      lastCheckedAt: string;
    }
  | { status: "not-available"; lastCheckedAt: string }
  | { status: "downloading"; downloaded: number; total?: number; version: string }
  | { status: "ready-to-restart"; version: string }
  | { status: "error"; message: string; lastCheckedAt?: string };

export type AppUpdateProgress = Extract<AppUpdateState, { status: "downloading" }>;

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let pendingUpdate: import("@tauri-apps/plugin-updater").Update | null = null;

export function getDistributionChannel(): "dev" | "github" | "mas" {
  const distribution = import.meta.env.VITE_MARGENT_DISTRIBUTION;
  return distribution === "github" || distribution === "mas" ? distribution : "dev";
}

export function isAppUpdaterSupported(): boolean {
  return isTauriRuntime() && getDistributionChannel() === "github";
}

export function shouldAutoCheckForUpdates(lastCheckedAt?: string): boolean {
  if (!lastCheckedAt) {
    return true;
  }

  const lastCheckedTime = new Date(lastCheckedAt).getTime();
  return Number.isNaN(lastCheckedTime)
    ? true
    : Date.now() - lastCheckedTime >= UPDATE_CHECK_INTERVAL_MS;
}

export async function checkForAppUpdate(): Promise<AppUpdateState> {
  if (!isAppUpdaterSupported()) {
    return {
      status: "unsupported",
      message: "Updater is only available in the GitHub release build."
    };
  }

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 30000 });
    const lastCheckedAt = new Date().toISOString();
    pendingUpdate = update;

    if (!update) {
      return { status: "not-available", lastCheckedAt };
    }

    return {
      status: "available",
      version: update.version,
      notes: update.body,
      date: update.date,
      lastCheckedAt
    };
  } catch (error) {
    return {
      status: "error",
      message: formatUpdateError(error),
      lastCheckedAt: new Date().toISOString()
    };
  }
}

export async function downloadAndInstallAppUpdate(
  onProgress?: (progress: AppUpdateProgress) => void
): Promise<AppUpdateState> {
  if (!pendingUpdate) {
    return { status: "error", message: "No pending update is available." };
  }

  const update = pendingUpdate;
  let downloaded = 0;
  let total: number | undefined;

  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength;
        downloaded = 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }

      if (event.event === "Started" || event.event === "Progress") {
        onProgress?.({
          status: "downloading",
          downloaded,
          total,
          version: update.version
        });
      }
    });
    await update.close();
    pendingUpdate = null;
    return { status: "ready-to-restart", version: update.version };
  } catch (error) {
    return { status: "error", message: formatUpdateError(error) };
  }
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

function formatUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Unable to check for updates.");

  if (isUpdateNetworkError(message)) {
    return "无法连接 GitHub 更新服务器，请检查网络或代理设置。";
  }

  return message;
}

function isUpdateNetworkError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return [
    "error sending request",
    "failed to fetch",
    "request timed out",
    "operation timed out",
    "could not resolve",
    "connection refused",
    "network error"
  ].some((keyword) => normalizedMessage.includes(keyword));
}
