import type { AppLanguage, AppSettings, ResolvedLocale } from "../shared/appSettingsTypes";

type OpenFilesListener = (paths: string[]) => void;
type AppMenuCommand = "open-file" | "open-settings";
type AppMenuCommandListener = (command: AppMenuCommand) => void;
type DialogModule = typeof import("@tauri-apps/plugin-dialog");
type SettingsChangedListener = (settings: AppSettings) => void;

let dialogModulePromise: Promise<DialogModule> | null = null;

const SETTINGS_CHANGED_EVENT = "margent-settings-updated";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

function loadDialogModule(): Promise<DialogModule> {
  dialogModulePromise ??= import("@tauri-apps/plugin-dialog");
  return dialogModulePromise;
}

export function preloadMarkdownFilePicker(): void {
  if (!isTauriRuntime()) {
    return;
  }

  void loadDialogModule();
}

export async function pickMarkdownFile(language: AppLanguage = "system"): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { open } = await loadDialogModule();
  const labels = getMarkdownFilePickerLabels(language);
  const selected = await open({
    title: labels.title,
    multiple: false,
    directory: false,
    filters: [
      {
        name: labels.filterName,
        extensions: ["md", "markdown"]
      }
    ]
  });

  return typeof selected === "string" ? selected : null;
}

function getMarkdownFilePickerLabels(language: AppLanguage): {
  title: string;
  filterName: string;
} {
  return resolveDesktopLocale(language) === "zh-CN"
    ? {
        title: "选择 Markdown 文件",
        filterName: "Markdown 文件"
      }
    : {
        title: "Choose Markdown File",
        filterName: "Markdown"
      };
}

function resolveDesktopLocale(language: AppLanguage): ResolvedLocale {
  if (language === "zh-CN" || language === "en-US") {
    return language;
  }

  const browserLanguage =
    typeof navigator === "undefined" ? "zh-CN" : navigator.language;
  return browserLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export async function getInitialOpenedFiles(): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string[]>("opened_files");
  } catch (error) {
    console.warn("Unable to read initially opened files from Tauri.", error);
    return [];
  }
}

export async function listenForOpenedFiles(listener: OpenFilesListener): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string[]>("desktop-open-files", (event) => {
      listener(event.payload);
    });
    return unlisten;
  } catch (error) {
    console.warn("Unable to listen for opened files from Tauri.", error);
    return () => undefined;
  }
}

export async function listenForAppMenuCommand(
  listener: AppMenuCommandListener
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<AppMenuCommand>("margent-menu-command", (event) => {
      listener(event.payload);
    });
    return unlisten;
  } catch (error) {
    console.warn("Unable to listen for Margent menu commands.", error);
    return () => undefined;
  }
}

export async function openSettingsWindow(): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_settings_window");
    } catch (error) {
      console.warn("Unable to open Margent settings window.", error);
    }
    return;
  }

  window.open(
    `${window.location.origin}${window.location.pathname}?settingsWindow=1`,
    "margent-settings",
    "width=520,height=320"
  );
}

export async function writeNativeClipboardText(text: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_clipboard_text", { text });
    return true;
  } catch (error) {
    console.warn("Unable to write clipboard through Tauri.", error);
    return false;
  }
}

export async function notifySettingsChanged(settings: AppSettings): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(SETTINGS_CHANGED_EVENT, settings);
    } catch (error) {
      console.warn("Unable to notify Margent settings change.", error);
    }
    return;
  }

  window.localStorage.setItem(
    SETTINGS_CHANGED_EVENT,
    JSON.stringify({
      settings,
      updatedAt: Date.now()
    })
  );
}

export async function listenForSettingsChanged(
  listener: SettingsChangedListener
): Promise<() => void> {
  if (isTauriRuntime()) {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<AppSettings>(SETTINGS_CHANGED_EVENT, (event) => {
        listener(event.payload);
      });
    } catch (error) {
      console.warn("Unable to listen for Margent settings changes.", error);
      return () => undefined;
    }
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== SETTINGS_CHANGED_EVENT || !event.newValue) {
      return;
    }

    try {
      const payload = JSON.parse(event.newValue) as { settings?: AppSettings };
      if (payload.settings) {
        listener(payload.settings);
      }
    } catch {
      // Ignore malformed cross-window settings notifications.
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

export async function startWindowDrag(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.warn("Unable to start Margent window drag.", error);
  }
}
