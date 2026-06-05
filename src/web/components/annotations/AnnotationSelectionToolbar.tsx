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
  const iconTop = Math.min(window.innerHeight - 42, Math.max(viewportPadding, draft.anchorRect.bottom + 6));
  const iconLeft = Math.min(
    window.innerWidth - 42,
    Math.max(viewportPadding, draft.anchorRect.right - 16)
  );
  const composerPosition = getComposerPosition(
    draft,
    composerWidth,
    composerHeight,
    viewportPadding
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
      style={composerPosition}
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

type ComposerPosition = {
  top: number;
  left: number;
};

function getComposerPosition(
  draft: AnnotationDraft,
  width: number,
  height: number,
  padding: number
): ComposerPosition {
  const selectionRect = draft.rect;
  const anchorRect = draft.anchorRect;
  const belowTop = Math.max(selectionRect.bottom, anchorRect.bottom) + 8;
  const aboveTop = Math.min(selectionRect.top, anchorRect.top) - height - 8;
  const candidates: ComposerPosition[] = [
    { top: belowTop, left: anchorRect.right },
    { top: belowTop, left: anchorRect.left - width },
    { top: belowTop, left: selectionRect.left },
    { top: aboveTop, left: anchorRect.right },
    { top: aboveTop, left: anchorRect.left - width },
    { top: aboveTop, left: selectionRect.left }
  ];

  return candidates
    .map((candidate, index) => {
      const position = clampComposerPosition(candidate, width, height, padding);
      return {
        index,
        position,
        overlapArea: getOverlapArea(
          {
            top: position.top,
            right: position.left + width,
            bottom: position.top + height,
            left: position.left
          },
          selectionRect
        )
      };
    })
    .sort((left, right) => left.overlapArea - right.overlapArea || left.index - right.index)[0]
    .position;
}

function clampComposerPosition(
  position: ComposerPosition,
  width: number,
  height: number,
  padding: number
): ComposerPosition {
  return {
    top: clamp(position.top, padding, Math.max(padding, window.innerHeight - height - padding)),
    left: clamp(position.left, padding, Math.max(padding, window.innerWidth - width - padding))
  };
}

function getOverlapArea(
  first: { top: number; right: number; bottom: number; left: number },
  second: DOMRect
): number {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
