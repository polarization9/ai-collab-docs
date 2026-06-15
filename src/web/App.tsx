import {
  Clock3,
  Download,
  FilePlus2,
  FileText,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCw,
  Settings2,
  X
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppSettings, RecentDocument } from "../shared/appSettingsTypes";
import type { CodexLinkResponse } from "../shared/codexTypes";
import type { ReviewFile } from "../shared/reviewTypes";
import type { ReviewBootstrap, ReviewDocument } from "../shared/types";
import {
  fetchAppSettings,
  fetchBootstrap,
  fetchRecentDocuments,
  openDocument,
  pickDocumentOnServer,
  removeRecentDocument,
  updateAppSettings
} from "./api";
import { AnnotationWorkspace } from "./components/annotations/AnnotationWorkspace";
import { Toc } from "./components/Toc";
import {
  getInitialOpenedFiles,
  isTauriRuntime,
  listenForAppMenuCommand,
  listenForSettingsChanged,
  listenForOpenedFiles,
  notifySettingsChanged,
  openSettingsWindow,
  pickMarkdownFile,
  preloadMarkdownFilePicker,
  startWindowDrag
} from "./desktop";
import { I18nProvider, useI18n, type LocaleKey } from "./i18n";
import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  getDistributionChannel,
  isAppUpdaterSupported,
  relaunchApp,
  shouldAutoCheckForUpdates,
  type AppUpdateState
} from "./updateManager";

if (typeof document !== "undefined") {
  document.documentElement.dataset.runtime = isTauriRuntime() ? "desktop" : "web";
}

type LoadState =
  | { status: "loading" }
  | { status: "empty"; message?: string }
  | { status: "error"; message: string }
  | {
      status: "ready";
      documents: OpenDocumentState[];
      activeDocumentId: string;
    };

type ReadyLoadState = Extract<LoadState, { status: "ready" }>;

type OpenDocumentState = {
  document: ReviewDocument;
  review: ReviewFile | null;
  codexLink: CodexLinkResponse | null;
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  language: "system",
  colorScheme: "default",
  startupBehavior: "empty",
  codexSourceDiscoveryEnabled: true,
  externalRefreshEnabled: true,
  autoCheckUpdatesEnabled: true
};

const UPDATE_CHECK_STORAGE_KEY = "margent-last-update-check-at";

export default function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const isSettingsWindow = searchParams.get("settingsWindow") === "1";

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAppSettings()
      .then((nextSettings) => {
        if (!cancelled) {
          setSettings(nextSettings);
          setSettingsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.colorScheme;
  }, [settings.colorScheme]);

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | undefined;

    listenForSettingsChanged((nextSettings) => {
      setSettings(nextSettings);
      setSettingsLoaded(true);
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        disposeListener = dispose;
      }
    });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, []);

  if (isSettingsWindow) {
    return (
      <I18nProvider language={settings.language}>
        <SettingsWindowPage
          settings={settings}
          settingsLoaded={settingsLoaded}
          onSettingsChange={setSettings}
        />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={settings.language}>
      <AppContent
        settings={settings}
        settingsLoaded={settingsLoaded}
      />
    </I18nProvider>
  );
}

function AppContent({
  settings,
  settingsLoaded
}: {
  settings: AppSettings;
  settingsLoaded: boolean;
}) {
  const { t } = useI18n();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isTocOpen, setIsTocOpen] = useState(true);
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([]);
  const [updateState, setUpdateState] = useState<AppUpdateState>(() =>
    isAppUpdaterSupported()
      ? { status: "idle", lastCheckedAt: readLastUpdateCheckAt() }
      : { status: "unsupported" }
  );
  const activeDocumentState = state.status === "ready" ? getActiveDocumentState(state) : null;
  const activeId = useActiveHeading(activeDocumentState?.document.headings ?? []);

  const runUpdateCheck = useCallback(async () => {
    if (!isAppUpdaterSupported()) {
      setUpdateState({ status: "unsupported" });
      return;
    }

    setUpdateState({ status: "checking" });
    const result = await checkForAppUpdate();
    if ("lastCheckedAt" in result && result.lastCheckedAt) {
      writeLastUpdateCheckAt(result.lastCheckedAt);
    }
    setUpdateState(result);
  }, []);

  const installAppUpdate = useCallback(async () => {
    if (updateState.status !== "available") {
      return;
    }

    setUpdateState({
      status: "downloading",
      downloaded: 0,
      version: updateState.version
    });
    const result = await downloadAndInstallAppUpdate((progress) => setUpdateState(progress));
    setUpdateState(result);
  }, [updateState]);

  const restartForUpdate = useCallback(async () => {
    await relaunchApp();
  }, []);

  const reloadRecentDocuments = useCallback(async () => {
    try {
      setRecentDocuments(await fetchRecentDocuments());
    } catch {
      setRecentDocuments([]);
    }
  }, []);

  const openMarkdownPaths = useCallback(async (paths: string[]) => {
    const documentPaths = uniqueDocumentPaths(paths);
    if (documentPaths.length === 0) {
      return;
    }

    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    let openedAny = false;
    try {
      for (const documentPath of documentPaths) {
        const readyDocument = await loadOpenDocumentStateFromPath(documentPath);
        openedAny = true;
        setState((current) => addOrReplaceOpenDocument(current, readyDocument));
      }
      void reloadRecentDocuments();
    } catch (error) {
      if (openedAny) {
        void reloadRecentDocuments();
      }
      setState((current) =>
        current.status === "ready" || openedAny
          ? current
          : {
              status: "empty",
              message: error instanceof Error ? error.message : t("app.openDocumentError")
            }
      );
    }
  }, [reloadRecentDocuments, t]);

  const openMarkdownPath = useCallback(
    async (path: string) => openMarkdownPaths([path]),
    [openMarkdownPaths]
  );

  const openWithPicker = useCallback(async () => {
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));

    try {
      if (isTauriRuntime()) {
        const path = await pickMarkdownFile(settings.language);
        if (!path) {
          setState((current) => (current.status === "ready" ? current : { status: "empty" }));
          return;
        }
        await openMarkdownPaths([path]);
        return;
      }

      const document = await pickDocumentOnServer();
      const readyDocument = await tryLoadOpenDocumentState();
      setState((current) =>
        addOrReplaceOpenDocument(
          current,
          readyDocument ?? { document, review: null, codexLink: null }
        )
      );
      void reloadRecentDocuments();
    } catch (error) {
      setState((current) =>
        current.status === "ready"
          ? current
          : {
              status: "empty",
              message: error instanceof Error ? error.message : t("app.openDocumentError")
            }
      );
    }
  }, [openMarkdownPaths, reloadRecentDocuments, settings.language, t]);

  const openSettings = useCallback(() => {
    void openSettingsWindow();
  }, []);

  useEffect(() => {
    preloadMarkdownFilePicker();
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !settings.autoCheckUpdatesEnabled) {
      return;
    }
    if (!isAppUpdaterSupported()) {
      setUpdateState({ status: "unsupported" });
      return;
    }
    if (!shouldAutoCheckForUpdates(readLastUpdateCheckAt())) {
      return;
    }

    void runUpdateCheck();
  }, [runUpdateCheck, settings.autoCheckUpdatesEnabled, settingsLoaded]);

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | undefined;

    listenForAppMenuCommand((command) => {
      if (command === "open-file") {
        void openWithPicker();
        return;
      }
      if (command === "open-settings") {
        openSettings();
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        disposeListener = dispose;
      }
    });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, [openSettings, openWithPicker]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    let cancelled = false;

    async function loadInitialDocument() {
      try {
        await reloadRecentDocuments();
        const openedFiles = uniqueDocumentPaths(await getInitialOpenedFiles());
        if (openedFiles.length > 0) {
          const openedDocuments: OpenDocumentState[] = [];
          for (const path of openedFiles) {
            const readyDocument = await loadOpenDocumentStateFromPath(path);
            if (cancelled) {
              return;
            }
            openedDocuments.push(readyDocument);
          }
          if (!cancelled) {
            setState(
              openedDocuments.reduce<LoadState>(
                (current, documentState) => addOrReplaceOpenDocument(current, documentState),
                { status: "loading" }
              ) as ReadyLoadState
            );
            void reloadRecentDocuments();
          }
          return;
        } else if (settings.startupBehavior === "restore-last-documents") {
          const recent = await fetchRecentDocuments();
          const firstExisting = recent.find((item) => item.exists);
          if (firstExisting) {
            await openDocument({ path: firstExisting.path });
          }
        }

        const readyState = await loadReadyStateFromBootstrap();
        if (!readyState) {
          if (!cancelled) {
            setState({ status: "empty" });
          }
          return;
        }

        if (!cancelled) {
          setState(readyState);
        }
      } catch (error: unknown) {
        const recoveredState = await retryLoadReadyStateAfterDelay(700);
        if (recoveredState && !cancelled) {
          setState(recoveredState);
          return;
        }

        if (!cancelled) {
          setState({
            status: "empty",
            message: error instanceof Error ? error.message : t("app.loadDocumentError")
          });
        }
      }
    }

    loadInitialDocument();

    return () => {
      cancelled = true;
    };
  }, [reloadRecentDocuments, settings.startupBehavior, settingsLoaded, t]);

  useEffect(() => {
    if (state.status !== "error") {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const readyState = await loadReadyStateFromBootstrap();
        if (!readyState || cancelled) {
          return;
        }
        if (!cancelled) {
          setState(readyState);
        }
      } catch {
        // Keep the visible error state when the retry still cannot load the document.
      }
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [state.status]);

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | undefined;

    listenForOpenedFiles((paths) => {
      void openMarkdownPaths(paths);
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        disposeListener = dispose;
      }
    });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, [openMarkdownPaths]);

  if (state.status === "loading") {
    return (
      <EmptyStartupPage
        recentDocuments={recentDocuments}
        isLoading
        onOpen={openWithPicker}
        onOpenRecent={openMarkdownPath}
          onRemoveRecent={async (path) => {
            setRecentDocuments(await removeRecentDocument(path));
          }}
        onOpenSettings={openSettings}
      />
    );
  }

  if (state.status === "error") {
    return (
      <main className="center-state center-state-error">
        <p>{state.message}</p>
      </main>
    );
  }

  if (state.status === "empty") {
    return (
      <>
        <EmptyStartupPage
          recentDocuments={recentDocuments}
          message={state.message}
          onOpen={openWithPicker}
          onOpenRecent={openMarkdownPath}
          onRemoveRecent={async (path) => {
            setRecentDocuments(await removeRecentDocument(path));
          }}
          onOpenSettings={openSettings}
        />
      </>
    );
  }

  if (!activeDocumentState) {
    return (
      <main className="center-state center-state-error">
        <p>{t("app.loadActiveDocumentError")}</p>
      </main>
    );
  }

  return (
    <div className="app-root">
      <DocumentTabs
        documents={state.documents}
        activeDocumentId={state.activeDocumentId}
        updateState={updateState}
        autoCheckUpdatesEnabled={settings.autoCheckUpdatesEnabled}
        onOpen={openWithPicker}
        onCheckUpdate={runUpdateCheck}
        onInstallUpdate={installAppUpdate}
        onRelaunchUpdate={restartForUpdate}
        onActivate={(documentId) => {
          const target = state.documents.find((item) => item.document.id === documentId);
          if (!target) {
            return;
          }
          void activateOpenDocument(target.document.absolutePath, target);
        }}
        onClose={(documentId) => {
          void closeOpenDocument(documentId);
        }}
      />
      <div className={`app-shell${isTocOpen ? "" : " app-shell-toc-collapsed"}`}>
        {isTocOpen ? (
          <Toc
            headings={activeDocumentState.document.headings}
            activeId={activeId}
            onCollapse={() => setIsTocOpen(false)}
          />
        ) : null}
        <main className="document-pane">
          {!isTocOpen ? (
            <button
              type="button"
              className="toc-open-button"
              aria-label={t("toc.open")}
              title={t("toc.open")}
              onClick={() => setIsTocOpen(true)}
            >
              <PanelLeftOpen size={17} />
            </button>
          ) : null}
          <AnnotationWorkspace
            key={activeDocumentState.document.id}
            document={activeDocumentState.document}
            initialReview={activeDocumentState.review}
            initialCodexLink={activeDocumentState.codexLink}
            externalRefreshEnabled={settings.externalRefreshEnabled}
            onDocumentChange={(document) =>
              setState((current) =>
                current.status === "ready"
                  ? updateOpenDocument(current, { document })
                  : {
                      status: "ready",
                      documents: [{ document, review: null, codexLink: null }],
                      activeDocumentId: document.id
                    }
              )
            }
          />
        </main>
      </div>
    </div>
  );

  async function activateOpenDocument(path: string, fallback: OpenDocumentState) {
    try {
      const document = await openDocument({ path });
      const readyDocument = await tryLoadOpenDocumentState();
      setState((current) =>
        addOrReplaceOpenDocument(current, readyDocument ?? { ...fallback, document })
      );
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : t("app.switchDocumentError")
      });
    }
  }

  async function closeOpenDocument(documentId: string) {
    if (state.status !== "ready") {
      return;
    }

    const closingIndex = state.documents.findIndex((item) => item.document.id === documentId);
    if (closingIndex < 0) {
      return;
    }

    const remaining = state.documents.filter((item) => item.document.id !== documentId);
    if (remaining.length === 0) {
      setState({ status: "empty" });
      return;
    }

    if (state.activeDocumentId !== documentId) {
      setState({ ...state, documents: remaining });
      return;
    }

    const nextActive = remaining[Math.min(closingIndex, remaining.length - 1)] ?? remaining[0];

    try {
      const document = await openDocument({ path: nextActive.document.absolutePath });
      const readyDocument = await tryLoadOpenDocumentState();
      const refreshedDocument = readyDocument ?? { ...nextActive, document };
      setState({
        ...state,
        documents: remaining.map((item) =>
          item.document.absolutePath === refreshedDocument.document.absolutePath
            ? refreshedDocument
            : item
        ),
        activeDocumentId: refreshedDocument.document.id
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : t("app.switchDocumentError")
      });
    }
  }
}

async function retryLoadReadyStateAfterDelay(delayMs: number): Promise<ReadyLoadState | null> {
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  return tryLoadReadyStateFromBootstrap();
}

async function tryLoadReadyStateFromBootstrap(): Promise<ReadyLoadState | null> {
  try {
    return await loadReadyStateFromBootstrap();
  } catch {
    return null;
  }
}

async function loadOpenDocumentStateFromPath(path: string): Promise<OpenDocumentState> {
  const document = await openDocument({ path });
  const readyDocument = await tryLoadOpenDocumentState();
  return readyDocument ?? { document, review: null, codexLink: null };
}

async function tryLoadOpenDocumentState(): Promise<OpenDocumentState | null> {
  const readyState = await tryLoadReadyStateFromBootstrap();
  const active = readyState ? getActiveDocumentState(readyState) : null;
  return active;
}

async function loadReadyStateFromBootstrap(): Promise<ReadyLoadState | null> {
  return readyStateFromBootstrap(await fetchBootstrap());
}

function readyStateFromBootstrap(bootstrap: ReviewBootstrap): ReadyLoadState | null {
  if (!bootstrap.hasDocument) {
    return null;
  }

  return {
    status: "ready",
    documents: [
      {
        document: bootstrap.document,
        review: bootstrap.review,
        codexLink: bootstrap.codexLink
      }
    ],
    activeDocumentId: bootstrap.document.id
  };
}

function getActiveDocumentState(state: ReadyLoadState): OpenDocumentState | null {
  return state.documents.find((item) => item.document.id === state.activeDocumentId) ?? null;
}

function addOrReplaceOpenDocument(
  state: LoadState,
  nextDocument: OpenDocumentState
): ReadyLoadState {
  if (state.status !== "ready") {
    return {
      status: "ready",
      documents: [nextDocument],
      activeDocumentId: nextDocument.document.id
    };
  }

  const existingIndex = state.documents.findIndex(
    (item) => item.document.absolutePath === nextDocument.document.absolutePath
  );
  const documents =
    existingIndex >= 0
      ? state.documents.map((item, index) => (index === existingIndex ? nextDocument : item))
      : [...state.documents, nextDocument];

  return {
    ...state,
    documents,
    activeDocumentId: nextDocument.document.id
  };
}

function uniqueDocumentPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalizedPath = path.trim();
    if (!normalizedPath || seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);
    unique.push(normalizedPath);
  }
  return unique;
}

function readLastUpdateCheckAt(): string | undefined {
  try {
    return window.localStorage.getItem(UPDATE_CHECK_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLastUpdateCheckAt(value: string): void {
  try {
    window.localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures; update checks can still run manually.
  }
}

function updateOpenDocument(
  state: ReadyLoadState,
  patch: Partial<OpenDocumentState> & { document: ReviewDocument }
): ReadyLoadState {
  return {
    ...state,
    documents: state.documents.map((item) =>
      item.document.id === patch.document.id ? { ...item, ...patch } : item
    )
  };
}

function DocumentTabs({
  documents,
  activeDocumentId,
  updateState,
  autoCheckUpdatesEnabled,
  onOpen,
  onCheckUpdate,
  onInstallUpdate,
  onRelaunchUpdate,
  onActivate,
  onClose
}: {
  documents: OpenDocumentState[];
  activeDocumentId: string;
  updateState: AppUpdateState;
  autoCheckUpdatesEnabled: boolean;
  onOpen: () => void;
  onCheckUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onRelaunchUpdate: () => Promise<void>;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="document-tabs"
      aria-label={t("tabs.label")}
      onPointerDown={(event) => {
        if (event.button !== 0 || isDocumentTabControl(event.target)) {
          return;
        }
        void startWindowDrag();
      }}
    >
      <div className="document-tabs-scroll">
        {documents.map((item) => {
          const active = item.document.id === activeDocumentId;
          return (
            <div
              key={item.document.id}
              className={`document-tab${active ? " document-tab-active" : ""}`}
            >
              <button
                type="button"
                className="document-tab-main"
                title={item.document.absolutePath}
                onClick={() => onActivate(item.document.id)}
              >
                <span className="document-tab-name">{getFileName(item.document.absolutePath)}</span>
              </button>
              <button
                type="button"
                className="document-tab-close"
                aria-label={t("tabs.close")}
                title={t("tabs.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(item.document.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <AppUpdateButton
        state={updateState}
        autoCheckEnabled={autoCheckUpdatesEnabled}
        onCheck={onCheckUpdate}
        onInstall={onInstallUpdate}
        onRelaunch={onRelaunchUpdate}
      />
      <button
        type="button"
        className="document-tab-open"
        aria-label={t("tabs.open")}
        title={t("tabs.open")}
        onClick={onOpen}
      >
        <Plus size={18} strokeWidth={2.2} />
      </button>
    </div>
  );
}

function AppUpdateButton({
  state,
  autoCheckEnabled,
  onCheck,
  onInstall,
  onRelaunch
}: {
  state: AppUpdateState;
  autoCheckEnabled: boolean;
  onCheck: () => Promise<void>;
  onInstall: () => Promise<void>;
  onRelaunch: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  if (getDistributionChannel() === "mas") {
    return null;
  }

  const busy = state.status === "checking" || state.status === "downloading";
  const hasBadge = state.status === "available" || state.status === "ready-to-restart";
  const title = getUpdateTitle(state, t);

  const handleClick = () => {
    if (state.status === "unsupported" || state.status === "available" || busy) {
      setIsOpen((current) => !current);
      return;
    }
    if (state.status === "ready-to-restart") {
      setIsOpen((current) => !current);
      return;
    }

    setIsOpen(true);
    void onCheck();
  };

  return (
    <div className="document-tab-update" data-no-window-drag>
      <button
        type="button"
        className={`document-tab-update-button${busy ? " document-tab-update-button-busy" : ""}`}
        aria-label={title}
        title={title}
        onClick={handleClick}
      >
        {state.status === "available" || state.status === "ready-to-restart" ? (
          <Download size={15} />
        ) : state.status === "checking" || state.status === "downloading" ? (
          <RotateCw size={15} />
        ) : (
          <RefreshCw size={15} />
        )}
        {hasBadge ? <span className="document-tab-update-badge" /> : null}
      </button>
      {isOpen ? (
        <div className="document-tab-update-popover" role="status">
          <div className="document-tab-update-title">{title}</div>
          <p>{getUpdateDescription(state, autoCheckEnabled, t)}</p>
          {state.status === "available" ? (
            <button type="button" onClick={() => void onInstall()}>
              {t("updates.downloadInstall")}
            </button>
          ) : null}
          {state.status === "ready-to-restart" ? (
            <button type="button" onClick={() => void onRelaunch()}>
              {t("updates.restart")}
            </button>
          ) : null}
          {state.status === "error" ? (
            <button type="button" onClick={() => void onCheck()}>
              {t("updates.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getUpdateTitle(
  state: AppUpdateState,
  t: (key: LocaleKey) => string
): string {
  switch (state.status) {
    case "checking":
      return t("updates.checking");
    case "available":
      return t("updates.available");
    case "not-available":
      return t("updates.notAvailable");
    case "downloading":
      return t("updates.downloading");
    case "ready-to-restart":
      return t("updates.readyToRestart");
    case "error":
      return t("updates.error");
    case "unsupported":
      return t("updates.unsupported");
    case "idle":
    default:
      return t("updates.check");
  }
}

function getUpdateDescription(
  state: AppUpdateState,
  autoCheckEnabled: boolean,
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
): string {
  switch (state.status) {
    case "available":
      return t("updates.availableDescription", { version: state.version });
    case "not-available":
      return t("updates.notAvailableDescription");
    case "downloading":
      return formatUpdateProgress(state, t);
    case "ready-to-restart":
      return t("updates.readyToRestartDescription", { version: state.version });
    case "error":
      return state.message;
    case "unsupported":
      return t("updates.unsupportedDescription");
    case "checking":
      return t("updates.checkingDescription");
    case "idle":
    default:
      return autoCheckEnabled ? t("updates.idleDescription") : t("updates.autoOffDescription");
  }
}

function formatUpdateProgress(
  state: Extract<AppUpdateState, { status: "downloading" }>,
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
): string {
  if (!state.total) {
    return t("updates.downloadingDescription");
  }
  const percent = Math.min(100, Math.round((state.downloaded / state.total) * 100));
  return t("updates.downloadingPercent", { percent });
}

function isDocumentTabControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest(
      ".document-tab, .document-tab-open, button, a, input, textarea, select, [data-no-window-drag]"
    )
  );
}

function EmptyStartupPage({
  recentDocuments,
  message,
  isLoading = false,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onOpenSettings
}: {
  recentDocuments: RecentDocument[];
  message?: string;
  isLoading?: boolean;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();

  return (
    <main className="document-empty-state">
      <section className="document-empty-command-area" aria-labelledby="empty-document-title">
        <div className="document-empty-command">
          <div className="document-empty-mark" aria-hidden="true">
            <FileText size={32} />
          </div>
          <div className="document-empty-command-copy">
            <h1 id="empty-document-title">{t("empty.title")}</h1>
            {message ? <p className="document-empty-note">{message}</p> : null}
          </div>
          <button
            className="document-empty-action"
            type="button"
            disabled={isLoading}
            onClick={onOpen}
          >
            <FilePlus2 size={17} />
            <span>{isLoading ? t("empty.loading") : t("empty.openAction")}</span>
          </button>
        </div>
        <RecentDocumentsList
          recentDocuments={recentDocuments}
          variant="strip"
          isLoading={isLoading}
          onOpen={onOpenRecent}
          onRemove={onRemoveRecent}
        />
      </section>
      <button
        type="button"
        className="settings-floating-button"
        aria-label={t("settings.title")}
        title={t("settings.title")}
        disabled={isLoading}
        onClick={onOpenSettings}
      >
        <Settings2 size={17} />
      </button>
    </main>
  );
}

function RecentDocumentsList({
  recentDocuments,
  variant = "panel",
  isLoading = false,
  onOpen,
  onRemove
}: {
  recentDocuments: RecentDocument[];
  variant?: "panel" | "strip";
  isLoading?: boolean;
  onOpen: (path: string) => void;
  onRemove: (path: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const visibleDocuments = variant === "strip" ? recentDocuments.slice(0, 5) : recentDocuments;

  if (variant === "strip" && !isLoading && visibleDocuments.length === 0) {
    return null;
  }

  if (variant === "strip") {
    return (
      <section
        className="recent-documents recent-documents-strip"
        aria-label={t("empty.recentTitle")}
      >
        <div className="recent-documents-title">
          <Clock3 size={14} />
          <span>{t("empty.recentTitle")}</span>
        </div>
        {isLoading ? (
          <div className="recent-documents-strip-loading">{t("empty.loading")}</div>
        ) : (
          <div className="recent-documents-strip-list">
            {visibleDocuments.map((item) => (
              <button
                type="button"
                className={`recent-document-strip-item${
                  item.exists ? "" : " recent-document-strip-item-missing"
                }`}
                title={item.path}
                disabled={!item.exists}
                key={item.path}
                onClick={() => onOpen(item.path)}
              >
                <span>{item.name}</span>
                <small>
                  {item.exists
                    ? formatRecentTime(item.lastOpenedAt, locale)
                    : t("empty.missingFile")}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="recent-documents" aria-label={t("empty.recentTitle")}>
      <div className="recent-documents-title">
        <Clock3 size={14} />
        <span>{t("empty.recentTitle")}</span>
      </div>
      {isLoading ? (
        <div className="recent-documents-list" aria-label={t("empty.loading")}>
          {Array.from({ length: 3 }, (_, index) => (
            <div className="recent-document-row recent-document-row-skeleton" key={index}>
              <span />
            </div>
          ))}
        </div>
      ) : visibleDocuments.length === 0 ? (
        <p className="recent-documents-empty">{t("empty.noRecent")}</p>
      ) : (
        <div className="recent-documents-list">
          {visibleDocuments.map((item) => (
            <div
              className={`recent-document-row${item.exists ? "" : " recent-document-row-missing"}`}
              key={item.path}
            >
              <button
                type="button"
                className="recent-document-main"
                title={item.path}
                disabled={!item.exists}
                onClick={() => onOpen(item.path)}
              >
                <span>{item.name}</span>
                <small>
                  {item.exists
                    ? `${getParentPath(item.path)} · ${formatRecentTime(item.lastOpenedAt, locale)}`
                    : t("empty.missingFile")}
                </small>
              </button>
              <button
                type="button"
                className="recent-document-remove"
                aria-label={t("tabs.close")}
                title={t("tabs.close")}
                onClick={() => {
                  void onRemove(item.path);
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsWindowPage({
  settings,
  settingsLoaded,
  onSettingsChange
}: {
  settings: AppSettings;
  settingsLoaded: boolean;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<string | null>(null);
  const updaterSupported = isAppUpdaterSupported();

  const changeSettings = useCallback(async (patch: Partial<AppSettings>) => {
    try {
      const nextSettings = await updateAppSettings(patch);
      onSettingsChange(nextSettings);
      await notifySettingsChanged(nextSettings);
      setFeedback(t("settings.saved"));
    } catch {
      setFeedback(t("settings.saveFailed"));
    }
  }, [onSettingsChange, t]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeout = window.setTimeout(() => setFeedback(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  if (!settingsLoaded) {
    return (
      <main className="settings-window-root">
        <p className="settings-window-loading">{t("empty.loading")}</p>
      </main>
    );
  }

  return (
    <main className="settings-window-root">
      <section className="settings-window-panel" aria-label={t("settings.title")}>
        <header className="settings-window-header">
          <h1>{t("settings.title")}</h1>
        </header>
        <div className="settings-window-section">
          <SettingsSegment
            label={t("settings.language")}
            value={settings.language}
            options={[
              ["system", t("settings.languageSystem")],
              ["zh-CN", t("settings.languageZh")],
              ["en-US", t("settings.languageEn")]
            ]}
            onChange={(language) => changeSettings({ language: language as AppSettings["language"] })}
          />
          <SettingsSegment
            label={t("settings.colorScheme")}
            value={settings.colorScheme}
            options={[
              { value: "default", label: t("settings.themeDefault"), swatch: "default" },
              { value: "blue-white", label: t("settings.themeBlueWhite"), swatch: "blue-white" },
              { value: "gray-white", label: t("settings.themeGrayWhite"), swatch: "gray-white" }
            ]}
            onChange={(colorScheme) =>
              changeSettings({ colorScheme: colorScheme as AppSettings["colorScheme"] })
            }
          />
          <SettingsToggle
            label={t("settings.codexDiscovery")}
            checked={settings.codexSourceDiscoveryEnabled}
            onChange={(codexSourceDiscoveryEnabled) =>
              changeSettings({ codexSourceDiscoveryEnabled })
            }
          />
          <SettingsToggle
            label={t("settings.autoUpdates")}
            checked={updaterSupported && settings.autoCheckUpdatesEnabled}
            disabled={!updaterSupported}
            description={
              updaterSupported
                ? t("settings.autoUpdatesDescription")
                : t("settings.autoUpdatesUnsupported")
            }
            onChange={(autoCheckUpdatesEnabled) =>
              changeSettings({ autoCheckUpdatesEnabled })
            }
          />
        </div>
        {feedback ? <div className="settings-window-feedback">{feedback}</div> : null}
      </section>
    </main>
  );
}

type SettingsSegmentOption =
  | [string, string]
  | {
      value: string;
      label: string;
      swatch?: AppSettings["colorScheme"];
    };

function SettingsSegment({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: SettingsSegmentOption[];
  onChange: (value: string) => Promise<void>;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">{label}</div>
      <div className="settings-segment" role="group" aria-label={label}>
        {options.map((option) => {
          const optionValue = Array.isArray(option) ? option[0] : option.value;
          const optionLabel = Array.isArray(option) ? option[1] : option.label;
          const swatch = Array.isArray(option) ? undefined : option.swatch;

          return (
            <button
              type="button"
              key={optionValue}
              className={optionValue === value ? "settings-option settings-option-active" : "settings-option"}
              onClick={() => {
                void onChange(optionValue);
              }}
            >
              {swatch ? (
                <span
                  className={`settings-option-swatch settings-option-swatch-${swatch}`}
                  aria-hidden="true"
                />
              ) : null}
              {optionLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsToggle({
  label,
  checked,
  disabled = false,
  description,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  description?: string;
  onChange: (checked: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-row settings-toggle-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {description ? <p className="settings-row-description">{description}</p> : null}
      </div>
      <button
        type="button"
        className={`settings-toggle${checked ? " settings-toggle-on" : ""}${
          disabled ? " settings-toggle-disabled" : ""
        }`}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          void onChange(!checked);
        }}
      >
        <span className="settings-toggle-track" aria-hidden="true">
          <span className="settings-toggle-thumb" />
        </span>
        <span className="settings-toggle-text">{checked ? t("settings.on") : t("settings.off")}</span>
      </button>
    </div>
  );
}

function formatRecentTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function getParentPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) {
    return filePath;
  }
  return parts.at(-2) ?? filePath;
}

function useActiveHeading(headings: ReviewDocument["headings"]): string | undefined {
  const [activeId, setActiveId] = useState<string | undefined>(headings[0]?.id);

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId(undefined);
      return;
    }

    setActiveId((current) => current ?? headings[0]?.id);

    let frame = 0;

    const updateActiveHeading = () => {
      const scrollBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight - 8;
      if (scrollBottom >= pageBottom) {
        setActiveId(headings[headings.length - 1]?.id);
        return;
      }

      let current = headings[0]?.id;
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (!element) {
          continue;
        }

        if (element.getBoundingClientRect().top <= 140) {
          current = heading.id;
        } else {
          break;
        }
      }

      setActiveId(current);
    };

    const requestUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateActiveHeading);
    };

    updateActiveHeading();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [headings]);

  return activeId;
}
