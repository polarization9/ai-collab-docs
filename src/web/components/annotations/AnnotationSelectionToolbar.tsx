import { MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AnnotationDraft } from "../../review/anchorCapture";
import { useI18n } from "../../i18n";

type AnnotationSelectionToolbarProps = {
  draft: AnnotationDraft | null;
  onCreate: (body: string) => Promise<void>;
  onCancel: () => void;
  trackSelection?: boolean;
};

export function AnnotationSelectionToolbar({
  draft,
  onCreate,
  onCancel,
  trackSelection = false
}: AnnotationSelectionToolbarProps) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [liveAnchorRect, setLiveAnchorRect] = useState<DOMRect | null>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    setBody("");
    setIsComposerOpen(false);
    setIsSaving(false);
    setLiveAnchorRect(draft?.anchorRect ?? null);
  }, [draft]);

  useEffect(() => {
    if (!draft || !trackSelection) {
      return;
    }

    let animationFrame = 0;

    const updateAnchorRect = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const nextAnchorRect = getCurrentSelectionAnchorRect();
        if (!nextAnchorRect || !isRectInViewport(nextAnchorRect)) {
          onCancelRef.current();
          return;
        }
        setLiveAnchorRect(nextAnchorRect);
      });
    };

    window.addEventListener("scroll", updateAnchorRect, { passive: true });
    window.addEventListener("resize", updateAnchorRect);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", updateAnchorRect);
      window.removeEventListener("resize", updateAnchorRect);
    };
  }, [draft, trackSelection]);

  if (!draft) {
    return null;
  }

  const anchorRect = liveAnchorRect ?? draft.anchorRect;
  const viewportPadding = 14;
  const composerWidth = 316;
  const composerHeight = 232;
  const iconTop = Math.min(window.innerHeight - 42, Math.max(viewportPadding, anchorRect.bottom + 6));
  const iconLeft = Math.min(
    window.innerWidth - 42,
    Math.max(viewportPadding, anchorRect.right - 16)
  );
  const composerPosition = getComposerPosition(
    { top: iconTop, left: iconLeft },
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
        aria-label={t("annotation.add")}
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
          {t("annotation.add")}
        </span>
        <button type="button" aria-label={t("annotation.cancel")} onClick={onCancel}>
          <X size={14} />
        </button>
      </div>
      <textarea
        value={body}
        placeholder={t("annotation.placeholder")}
        onChange={(event) => setBody(event.target.value)}
        autoFocus
      />
      <div className="annotation-composer-actions">
        <button type="button" onClick={onCancel}>
          {t("annotation.cancel")}
        </button>
        <button type="button" disabled={!body.trim() || isSaving} onClick={submit}>
          {isSaving ? t("annotation.saving") : t("annotation.save")}
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
  iconPosition: ComposerPosition,
  width: number,
  height: number,
  padding: number
): ComposerPosition {
  return clampComposerPosition(
    {
      top: iconPosition.top + 42,
      left: iconPosition.left
    },
    width,
    height,
    padding
  );
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getCurrentSelectionAnchorRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  return rects[rects.length - 1] ?? range.getBoundingClientRect();
}

function isRectInViewport(rect: DOMRect): boolean {
  return rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
}
