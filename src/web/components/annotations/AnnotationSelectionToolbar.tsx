import { MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AnnotationDraft } from "../../review/anchorCapture";

type AnnotationSelectionToolbarProps = {
  draft: AnnotationDraft | null;
  onCreate: (body: string) => Promise<void>;
  onCancel: () => void;
};

export function AnnotationSelectionToolbar({
  draft,
  onCreate,
  onCancel
}: AnnotationSelectionToolbarProps) {
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  useEffect(() => {
    setBody("");
    setIsComposerOpen(false);
    setIsSaving(false);
  }, [draft]);

  if (!draft) {
    return null;
  }

  const viewportPadding = 14;
  const composerWidth = 316;
  const composerHeight = 232;
  const maxComposerTop = Math.max(viewportPadding, window.innerHeight - composerHeight);
  const maxComposerLeft = Math.max(
    viewportPadding,
    window.innerWidth - composerWidth - viewportPadding
  );
  const iconTop = Math.min(window.innerHeight - 42, Math.max(viewportPadding, draft.anchorRect.bottom + 6));
  const iconLeft = Math.min(
    window.innerWidth - 42,
    Math.max(viewportPadding, draft.anchorRect.right - 16)
  );
  const top = Math.min(
    maxComposerTop,
    Math.max(viewportPadding, draft.anchorRect.bottom + 8)
  );
  const left = Math.min(
    maxComposerLeft,
    Math.max(viewportPadding, draft.anchorRect.right)
  );

  const submit = async () => {
    if (!body.trim() || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      await onCreate(body.trim());
      setBody("");
      setIsComposerOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isComposerOpen) {
    return (
      <button
        type="button"
        className="annotation-draft-button"
        aria-label="添加批注"
        style={{ top: iconTop, left: iconLeft }}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setIsComposerOpen(true);
        }}
      >
        <MessageSquare size={16} />
      </button>
    );
  }

  return (
    <div
      className="annotation-composer-popover"
      style={{ top, left }}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div className="annotation-composer-header">
        <span>
          <MessageSquare size={14} />
          添加批注
        </span>
        <button type="button" aria-label="取消批注" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>
      <textarea
        value={body}
        placeholder="写下问题或修改建议"
        onChange={(event) => setBody(event.target.value)}
        autoFocus
      />
      <div className="annotation-composer-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" disabled={!body.trim() || isSaving} onClick={submit}>
          {isSaving ? "保存中" : "保存"}
        </button>
      </div>
    </div>
  );
}
