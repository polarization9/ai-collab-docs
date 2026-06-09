import { CheckCircle2, CircleDot, Eye, FilePenLine, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useI18n } from "../../i18n";

export type EditorViewMode = "source" | "preview";

type EditorToolbarProps = {
  isEditing: boolean;
  isDirty: boolean;
  isSaving: boolean;
  viewMode: EditorViewMode;
  onViewModeChange: (mode: EditorViewMode) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function EditorToolbar({
  isEditing,
  isDirty,
  isSaving,
  viewMode,
  onViewModeChange,
  onCancel,
  onSave
}: EditorToolbarProps) {
  const { t } = useI18n();

  if (!isEditing) {
    return null;
  }

  return (
    <div className={`editor-toolbar${isDirty ? " editor-toolbar-dirty" : ""}`} aria-label={t("editor.toolbar")}>
      <div className="editor-toolbar-left">
        <span className="editor-mode-mark" aria-hidden="true">
          <FilePenLine size={15} />
        </span>
        <div className="editor-mode-copy">
          <span className="editor-mode-label">{t("editor.title")}</span>
          <span
            className={`editor-save-state${
              isSaving
                ? " editor-save-state-saving"
                : isDirty
                  ? " editor-save-state-dirty"
                  : " editor-save-state-clean"
            }`}
            aria-live="polite"
          >
            {isSaving ? (
              <LoaderCircle className="editor-state-spinner" size={13} />
            ) : isDirty ? (
              <CircleDot size={13} />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {isSaving ? t("document.saving") : isDirty ? t("editor.dirty") : t("editor.clean")}
          </span>
        </div>
      </div>

      <div className="editor-view-switch" role="tablist" aria-label={t("editor.view")}>
        <button
          type="button"
          className={viewMode === "source" ? "editor-view-switch-active" : ""}
          aria-pressed={viewMode === "source"}
          onClick={() => onViewModeChange("source")}
        >
          <FilePenLine size={14} />
          {t("editor.source")}
        </button>
        <button
          type="button"
          className={viewMode === "preview" ? "editor-view-switch-active" : ""}
          aria-pressed={viewMode === "preview"}
          onClick={() => onViewModeChange("preview")}
        >
          <Eye size={14} />
          {t("editor.preview")}
        </button>
      </div>

      <div className="editor-toolbar-actions">
        <button className="editor-secondary-action" type="button" onClick={onCancel} disabled={isSaving}>
          {isDirty ? <RotateCcw size={14} /> : <X size={14} />}
          {isDirty ? t("editor.discard") : t("document.exit")}
        </button>
        <button className="editor-primary-action" type="button" onClick={onSave} disabled={!isDirty || isSaving}>
          <Save size={14} />
          {isSaving ? t("document.saving") : t("document.save")}
        </button>
      </div>
    </div>
  );
}
