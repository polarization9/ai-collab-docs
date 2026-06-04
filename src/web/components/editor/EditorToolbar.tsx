import { CheckCircle2, CircleDot, Eye, FilePenLine, LoaderCircle, RotateCcw, Save, X } from "lucide-react";

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
  if (!isEditing) {
    return null;
  }

  return (
    <div className={`editor-toolbar${isDirty ? " editor-toolbar-dirty" : ""}`} aria-label="编辑工具栏">
      <div className="editor-toolbar-left">
        <span className="editor-mode-mark" aria-hidden="true">
          <FilePenLine size={15} />
        </span>
        <div className="editor-mode-copy">
          <span className="editor-mode-label">编辑文档</span>
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
            {isSaving ? "保存中" : isDirty ? "未保存" : "已保存"}
          </span>
        </div>
      </div>

      <div className="editor-view-switch" role="tablist" aria-label="编辑视图">
        <button
          type="button"
          className={viewMode === "source" ? "editor-view-switch-active" : ""}
          aria-pressed={viewMode === "source"}
          onClick={() => onViewModeChange("source")}
        >
          <FilePenLine size={14} />
          源码
        </button>
        <button
          type="button"
          className={viewMode === "preview" ? "editor-view-switch-active" : ""}
          aria-pressed={viewMode === "preview"}
          onClick={() => onViewModeChange("preview")}
        >
          <Eye size={14} />
          预览
        </button>
      </div>

      <div className="editor-toolbar-actions">
        <button className="editor-secondary-action" type="button" onClick={onCancel} disabled={isSaving}>
          {isDirty ? <RotateCcw size={14} /> : <X size={14} />}
          {isDirty ? "放弃" : "退出"}
        </button>
        <button className="editor-primary-action" type="button" onClick={onSave} disabled={!isDirty || isSaving}>
          <Save size={14} />
          {isSaving ? "保存中" : "保存"}
        </button>
      </div>
    </div>
  );
}
