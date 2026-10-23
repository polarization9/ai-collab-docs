import { Download, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n, type LocaleKey } from "../i18n";
import { getDistributionChannel, type AppUpdateState } from "../updateManager";

export function AppUpdateButton({
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
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        if (containerRef.current?.contains(document.activeElement)) {
          buttonRef.current?.focus();
        }
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (getDistributionChannel() === "mas") {
    return null;
  }

  const busy = state.status === "checking" || state.status === "downloading";
  const hasBadge = state.status === "available" || state.status === "ready-to-restart";
  const title = getUpdateTitle(state, t);

  const handleClick = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    setIsOpen(true);
    if (state.status === "idle" || state.status === "not-available" || state.status === "error") {
      void onCheck();
    }
  };

  return (
    <div ref={containerRef} className="document-tab-update" data-no-window-drag>
      <button
        ref={buttonRef}
        type="button"
        className={`document-tab-update-button${busy ? " document-tab-update-button-busy" : ""}`}
        aria-label={title}
        aria-expanded={isOpen}
        title={title}
        onClick={handleClick}
      >
        {hasBadge ? (
          <Download size={15} />
        ) : busy ? (
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
