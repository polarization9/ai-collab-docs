import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw
} from "lucide-react";
import type { DocumentMergeConflict } from "../../../shared/editTypes";
import { useI18n, type LocaleKey } from "../../i18n";

export type DocumentUpdateSource = "agent" | "external" | "unknown";

export type DocumentUpdateState =
  | { kind: "hidden" }
  | {
      kind: "autoUpdated";
      source: DocumentUpdateSource;
      merged: boolean;
    }
  | {
      kind: "updateAvailable";
      source: DocumentUpdateSource;
    }
  | {
      kind: "conflictBlocked";
      source: DocumentUpdateSource;
      externalContent: string;
      externalContentHash: string;
      conflicts: DocumentMergeConflict[];
      detailsOpen: boolean;
      mergeCheckFailed?: boolean;
    };

type DocumentUpdateNoticeProps = {
  state: DocumentUpdateState;
  onApplyUpdate: () => void;
  onToggleDetails: () => void;
  onUseExternal: () => void;
  onKeepMine: () => void;
};

export function DocumentUpdateNotice({
  state,
  onApplyUpdate,
  onToggleDetails,
  onUseExternal,
  onKeepMine
}: DocumentUpdateNoticeProps) {
  const { t } = useI18n();

  if (state.kind === "hidden") {
    return null;
  }

  if (state.kind === "autoUpdated") {
    return (
      <div className="document-update-notice document-update-notice-floating" role="status">
        <CheckCircle2 size={16} />
        <span>{autoUpdatedLabel(state.source, state.merged, t)}</span>
      </div>
    );
  }

  if (state.kind === "updateAvailable") {
    return (
      <div className="document-update-notice document-update-notice-sticky" role="status">
        <RefreshCw size={16} />
        <span>{updateAvailableLabel(state.source, t)}</span>
        <div className="document-update-notice-actions">
          <button type="button" onClick={onApplyUpdate}>
            {t("documentUpdate.apply")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="document-update-notice document-update-notice-sticky document-update-notice-conflict"
      role="alert"
    >
      <AlertTriangle size={16} />
      <div className="document-update-notice-body">
        <span>
          {state.mergeCheckFailed
            ? t("documentUpdate.conflictUnknown")
            : conflictLabel(state.source, t)}
        </span>
        {state.detailsOpen ? <ConflictDetails conflicts={state.conflicts} /> : null}
      </div>
      <div className="document-update-notice-actions">
        {state.conflicts.length > 0 ? (
          <button type="button" onClick={onToggleDetails}>
            {state.detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{t("documentUpdate.viewConflict")}</span>
          </button>
        ) : null}
        <button type="button" onClick={onUseExternal}>
          {t("documentUpdate.useExternal")}
        </button>
        <button type="button" className="document-update-notice-primary" onClick={onKeepMine}>
          {t("documentUpdate.keepMine")}
        </button>
      </div>
    </div>
  );
}

function ConflictDetails({ conflicts }: { conflicts: DocumentMergeConflict[] }) {
  const { t } = useI18n();

  return (
    <div className="document-update-conflict-details">
      {conflicts.map((conflict) => (
        <div className="document-update-conflict-item" key={conflict.id}>
          <div className="document-update-conflict-meta">
            {conflict.headingText ?? t("documentUpdate.noHeading")} · {conflict.blockKind}
          </div>
          <div className="document-update-conflict-grid">
            <ConflictSnippet label={t("documentUpdate.mine")} value={conflict.draftSnippet} />
            <ConflictSnippet label={t("documentUpdate.external")} value={conflict.externalSnippet} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConflictSnippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="document-update-conflict-snippet">
      <strong>{label}</strong>
      <pre>{value || "..."}</pre>
    </div>
  );
}

function autoUpdatedLabel(
  source: DocumentUpdateSource,
  merged: boolean,
  t: (key: LocaleKey) => string
): string {
  if (merged) {
    return source === "agent"
      ? t("documentUpdate.agentMerged")
      : t("documentUpdate.documentMerged");
  }
  return source === "agent" ? t("documentUpdate.agentUpdated") : t("documentUpdate.documentUpdated");
}

function updateAvailableLabel(source: DocumentUpdateSource, t: (key: LocaleKey) => string): string {
  return source === "agent"
    ? t("documentUpdate.agentAvailable")
    : t("documentUpdate.documentAvailable");
}

function conflictLabel(source: DocumentUpdateSource, t: (key: LocaleKey) => string): string {
  return source === "agent"
    ? t("documentUpdate.agentConflict")
    : t("documentUpdate.documentConflict");
}
