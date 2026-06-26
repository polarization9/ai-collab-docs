import {
  AtSign,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  RotateCcw,
  Send,
  X
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentLinkResponse, AgentProvider } from "../../../shared/agentTypes";
import type {
  ReviewAnnotation,
  ReviewEvent,
  ReviewEventDeliveryStatus
} from "../../../shared/reviewTypes";
import { useI18n, type LocaleKey } from "../../i18n";

type AnnotationThreadPopoverProps = {
  annotations: ReviewAnnotation[];
  events: ReviewEvent[];
  pendingAnnotationIds?: string[];
  activeAnnotationId: string;
  anchorRect: DOMRect;
  agentLink: AgentLinkResponse | null;
  onClose: () => void;
  onSwitch: (annotationId: string) => void;
  onReply: (annotationId: string, body: string) => Promise<void>;
  onSendToAgent: (annotationId: string) => Promise<void>;
  onRetryReviewEvent: (eventId: string) => Promise<void>;
  onUnavailableAgentSend: () => Promise<void>;
};

type PopoverPosition = {
  top: number;
  left: number;
  maxHeight: number;
  placement: PopoverPlacement;
};

type PopoverPlacement =
  | "right-start"
  | "right-lower"
  | "left-start"
  | "left-lower"
  | "below-center"
  | "above-center"
  | "viewport-fallback";

type PopoverViewport = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type PopoverCandidate = {
  placement: PopoverPlacement;
  rawTop: number;
  rawLeft: number;
  top: number;
  left: number;
  width: number;
  height: number;
  maxHeight: number;
};

export function AnnotationThreadPopover({
  annotations,
  events,
  pendingAnnotationIds = [],
  activeAnnotationId,
  anchorRect,
  agentLink,
  onClose,
  onSwitch,
  onReply,
  onSendToAgent,
  onRetryReviewEvent,
  onUnavailableAgentSend
}: AnnotationThreadPopoverProps) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const replyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const previousThreadStateRef = useRef({
    annotationId: activeAnnotationId,
    replyCount: Number.POSITIVE_INFINITY
  });
  const [position, setPosition] = useState<PopoverPosition>(() =>
    getPopoverPosition(anchorRect)
  );
  const [replyDraft, setReplyDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const activeAnnotation = annotations.find((annotation) => annotation.id === activeAnnotationId);
  const latestEvent = getLatestAnnotationEvent(events, activeAnnotationId);
  const eventBadge = pendingAnnotationIds.includes(activeAnnotationId)
    ? getLocalPendingEventBadge(agentLink, t)
    : getAnnotationEventBadge(latestEvent, t);
  const canSendToAgent = Boolean(agentLink?.connection.hasTarget);
  const activeIndex = Math.max(
    0,
    annotations.findIndex((annotation) => annotation.id === activeAnnotationId)
  );
  const sortedReplies = useMemo(
    () =>
      [...(activeAnnotation?.replies ?? [])].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      ),
    [activeAnnotation?.replies]
  );

  useEffect(() => {
    setReplyDraft("");
    setLocalError(null);
  }, [activeAnnotationId]);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const popoverRect = popoverRef.current?.getBoundingClientRect();
      setPosition(
        getPopoverPosition(anchorRect, {
          width: popoverRect?.width,
          height: popoverRect?.height
        })
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition);
    };
  }, [anchorRect, activeAnnotationId, annotations.length, sortedReplies.length, localError]);

  useLayoutEffect(() => {
    const input = replyInputRef.current;
    if (!input) {
      return;
    }

    const style = window.getComputedStyle(input);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const verticalPadding =
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom) +
      Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.borderBottomWidth);
    const minHeight = lineHeight + verticalPadding;
    const maxHeight = lineHeight * 3 + verticalPadding;
    const draftLineCount = replyDraft
      ? Math.min(3, Math.max(1, replyDraft.split("\n").length))
      : 1;
    input.style.height = "auto";
    const scrollHeight = input.scrollHeight;
    const targetHeight = Math.max(scrollHeight, lineHeight * draftLineCount + verticalPadding);
    input.style.height = `${Math.min(Math.max(targetHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
  }, [replyDraft]);

  useLayoutEffect(() => {
    const previous = previousThreadStateRef.current;
    if (previous.annotationId !== activeAnnotationId) {
      previousThreadStateRef.current = {
        annotationId: activeAnnotationId,
        replyCount: sortedReplies.length
      };
      return;
    }

    if (sortedReplies.length > previous.replyCount) {
      threadEndRef.current?.scrollIntoView({ block: "end" });
    }
    previousThreadStateRef.current = {
      annotationId: activeAnnotationId,
      replyCount: sortedReplies.length
    };
  }, [activeAnnotationId, sortedReplies.length]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!activeAnnotation) {
    return null;
  }

  const hasMultipleAnnotations = annotations.length > 1;
  const hasFailedEvent = latestEvent?.deliveryStatus === "failed";

  const run = async (action: () => Promise<void>) => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("annotation.operationFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const saveReply = async () => {
    const body = replyDraft.trim();
    if (!body) {
      return;
    }
    await run(async () => {
      await onReply(activeAnnotation.id, body);
      setReplyDraft("");
    });
  };

  const sendToAgent = async () => {
    if (!canSendToAgent) {
      await onUnavailableAgentSend();
      return;
    }

    const body = replyDraft.trim();
    await run(async () => {
      if (body) {
        await onReply(activeAnnotation.id, body);
        setReplyDraft("");
      }
      await onSendToAgent(activeAnnotation.id);
    });
  };

  const switchByOffset = (offset: number) => {
    const nextIndex = (activeIndex + offset + annotations.length) % annotations.length;
    const next = annotations[nextIndex];
    if (next) {
      onSwitch(next.id);
    }
  };

  return (
    <div
      ref={popoverRef}
      className="annotation-thread-popover"
      style={{
        top: position.top,
        left: position.left,
        maxHeight: position.maxHeight
      }}
      role="dialog"
      aria-label={t("annotation.threadPopover")}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div className="annotation-thread-header">
        <div className="annotation-thread-title-row">
          <span className={`annotation-status annotation-status-${activeAnnotation.status}`}>
            {activeAnnotation.status === "open" ? (
              <CircleDot size={13} />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {activeAnnotation.status === "open" ? t("annotation.open") : t("annotation.resolved")}
          </span>
          {eventBadge ? (
            <span
              className={`annotation-event-badge annotation-event-badge-${eventBadge.tone}`}
              title={eventBadge.title}
            >
              {eventBadge.label}
            </span>
          ) : null}
        </div>
        <div className="annotation-thread-header-actions">
          {hasMultipleAnnotations ? (
            <div className="annotation-thread-switcher">
              <button
                type="button"
                aria-label={t("annotation.previousThread")}
                onClick={() => switchByOffset(-1)}
              >
                <ChevronLeft size={13} />
              </button>
              <span>
                {activeIndex + 1}/{annotations.length}
              </span>
              <button
                type="button"
                aria-label={t("annotation.nextThread")}
                onClick={() => switchByOffset(1)}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          ) : null}
          <button type="button" aria-label={t("annotation.closeThread")} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="annotation-thread-body">
        <section className="annotation-thread-message annotation-thread-message-root">
          <strong>{activeAnnotation.author.name}</strong>
          <p>{activeAnnotation.body}</p>
        </section>

        {sortedReplies.length > 0 ? (
          <div className="annotation-thread-replies">
            {sortedReplies.map((reply) => (
              <section key={reply.id} className="annotation-thread-message">
                <strong>{reply.author.name}</strong>
                <small>{formatTime(reply.createdAt)}</small>
                <p>
                  {reply.replyTo ? (
                    <span className="annotation-reply-mention">
                      @{reply.replyTo.authorName}
                    </span>
                  ) : null}
                  {reply.body}
                </p>
              </section>
            ))}
          </div>
        ) : null}

        {latestEvent?.lastError ? (
          <div className="annotation-thread-error">{latestEvent.lastError}</div>
        ) : null}
        {localError ? <div className="annotation-thread-error">{localError}</div> : null}
        <div ref={threadEndRef} />
      </div>

      <textarea
        ref={replyInputRef}
        className="annotation-thread-reply-input"
        value={replyDraft}
        onChange={(event) => setReplyDraft(event.target.value)}
        placeholder={t("annotation.replyToAnnotation")}
        aria-label={t("annotation.replyToAnnotation")}
      />

      <div className="annotation-thread-actions">
        {hasFailedEvent ? (
          <button
            type="button"
            className="annotation-thread-icon-button"
            disabled={isSaving}
            title={t("annotation.retryDelivery")}
            aria-label={t("annotation.retryDelivery")}
            onClick={() => latestEvent && void run(() => onRetryReviewEvent(latestEvent.id))}
          >
            <RotateCcw size={14} />
          </button>
        ) : null}
        <div className="annotation-thread-spacer" />
        <button
          type="button"
          disabled={!replyDraft.trim() || isSaving}
          onClick={() => void saveReply()}
        >
          <Send size={13} />
          {t("annotation.save")}
        </button>
        <button
          type="button"
          className={`annotation-thread-agent-button${
            canSendToAgent ? "" : " annotation-thread-agent-button-unavailable"
          }`}
          aria-disabled={!canSendToAgent}
          disabled={isSaving}
          title={canSendToAgent ? t("annotation.sendToAgent") : t("annotation.agentUnavailable")}
          onClick={() => void sendToAgent()}
        >
          <AtSign size={13} />
          {t("annotation.sendToAgent")}
        </button>
      </div>
    </div>
  );
}

function getPopoverPosition(
  anchorRect: DOMRect,
  popoverSize: { width?: number; height?: number } = {}
): PopoverPosition {
  const padding = 14;
  const gap = 10;
  const safeViewport = getPopoverSafeViewport(padding);
  const viewportWidth = Math.max(0, safeViewport.right - safeViewport.left);
  const viewportHeight = Math.max(0, safeViewport.bottom - safeViewport.top);
  const width =
    popoverSize.width ?? Math.min(420, Math.max(320, viewportWidth));
  const preferredHeight =
    popoverSize.height ?? Math.min(320, viewportHeight);
  const usableHeight = Math.max(0, Math.min(520, viewportHeight));
  const candidates = buildPopoverCandidates(
    anchorRect,
    {
      width: Math.min(width, viewportWidth),
      preferredHeight: Math.min(preferredHeight, usableHeight)
    },
    safeViewport,
    gap
  );
  const best = candidates.sort(
    (left, right) => scorePopoverCandidate(right, anchorRect) - scorePopoverCandidate(left, anchorRect)
  )[0];

  if (!best) {
    return {
      top: safeViewport.top,
      left: safeViewport.left,
      maxHeight: usableHeight,
      placement: "viewport-fallback"
    };
  }

  return {
    top: best.top,
    left: best.left,
    maxHeight: best.maxHeight,
    placement: best.placement
  };
}

function getPopoverSafeViewport(padding: number): PopoverViewport {
  const tabsBottom = document.querySelector(".document-tabs")?.getBoundingClientRect().bottom;
  const top = Math.max(padding, Number.isFinite(tabsBottom) ? Number(tabsBottom) + 8 : padding);

  return {
    left: padding,
    top,
    right: Math.max(padding, window.innerWidth - padding),
    bottom: Math.max(top, window.innerHeight - padding)
  };
}

function buildPopoverCandidates(
  anchorRect: DOMRect,
  size: { width: number; preferredHeight: number },
  viewport: PopoverViewport,
  gap: number
): PopoverCandidate[] {
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - size.width / 2;
  const startTop = anchorRect.top - 12;
  const lowerTop = anchorRect.bottom + gap;
  const candidates: Array<{ placement: PopoverPlacement; rawLeft: number; rawTop: number }> = [
    {
      placement: "right-start",
      rawLeft: anchorRect.right + gap,
      rawTop: startTop
    },
    {
      placement: "right-lower",
      rawLeft: anchorRect.right + gap,
      rawTop: lowerTop
    },
    {
      placement: "left-start",
      rawLeft: anchorRect.left - size.width - gap,
      rawTop: startTop
    },
    {
      placement: "left-lower",
      rawLeft: anchorRect.left - size.width - gap,
      rawTop: lowerTop
    },
    {
      placement: "below-center",
      rawLeft: centeredLeft,
      rawTop: lowerTop
    }
  ];

  const availableAbove = Math.max(0, anchorRect.top - gap - viewport.top);
  const aboveHeight = getCandidateMaxHeight(availableAbove);
  candidates.push({
    placement: "above-center",
    rawLeft: centeredLeft,
    rawTop: anchorRect.top - Math.min(size.preferredHeight, aboveHeight) - gap
  });

  return candidates.map((candidate) =>
    normalizePopoverCandidate(candidate, size, viewport)
  );
}

function normalizePopoverCandidate(
  candidate: { placement: PopoverPlacement; rawLeft: number; rawTop: number },
  size: { width: number; preferredHeight: number },
  viewport: PopoverViewport
): PopoverCandidate {
  const availableFromTop = Math.max(0, viewport.bottom - Math.max(viewport.top, candidate.rawTop));
  const maxHeight = getCandidateMaxHeight(availableFromTop);
  const height = Math.min(size.preferredHeight, maxHeight);
  const top = clamp(candidate.rawTop, viewport.top, viewport.bottom - height);
  const left = clamp(candidate.rawLeft, viewport.left, viewport.right - size.width);

  return {
    placement: candidate.placement,
    rawTop: candidate.rawTop,
    rawLeft: candidate.rawLeft,
    top,
    left,
    width: size.width,
    height,
    maxHeight
  };
}

function getCandidateMaxHeight(availableHeight: number): number {
  return Math.max(0, Math.min(520, availableHeight));
}

function scorePopoverCandidate(candidate: PopoverCandidate, anchorRect: DOMRect): number {
  const rawRight = candidate.rawLeft + candidate.width;
  const rawBottom = candidate.rawTop + candidate.height;
  const fitsWithoutClamp =
    candidate.rawLeft === candidate.left &&
    candidate.rawTop === candidate.top &&
    rawRight === candidate.left + candidate.width &&
    rawBottom === candidate.top + candidate.height;
  const clampDistance =
    Math.abs(candidate.left - candidate.rawLeft) + Math.abs(candidate.top - candidate.rawTop);
  const overlapPenalty = rectsOverlap(
    {
      left: candidate.left,
      top: candidate.top,
      right: candidate.left + candidate.width,
      bottom: candidate.top + candidate.height
    },
    anchorRect
  )
    ? 24
    : 0;
  const placementBias: Record<PopoverPlacement, number> = {
    "right-start": 12,
    "right-lower": 14,
    "left-start": 10,
    "left-lower": 12,
    "below-center": 6,
    "above-center": 4,
    "viewport-fallback": 0
  };

  return (
    (fitsWithoutClamp ? 80 : 0) +
    Math.min(candidate.maxHeight, 520) * 0.05 +
    placementBias[candidate.placement] -
    clampDistance * 0.7 -
    overlapPenalty
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function rectsOverlap(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number }
): boolean {
  return (
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top
  );
}

function getLatestAnnotationEvent(events: ReviewEvent[], annotationId: string): ReviewEvent | null {
  return (
    events
      .filter((event) => event.annotationId === annotationId)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      )[0] ?? null
  );
}

type AnnotationEventBadge = {
  label: string;
  title: string;
  tone: Exclude<ReviewEventDeliveryStatus, "ignored">;
};

function getAnnotationEventBadge(
  event: ReviewEvent | null,
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
): AnnotationEventBadge | null {
  const providerName = getAgentProviderName(getEventProvider(event));
  const params = { provider: providerName };
  switch (event?.deliveryStatus) {
    case "queued":
      return {
        label: t("event.queued"),
        title: t("event.queuedTitle", params),
        tone: "queued"
      };
    case "delivering":
      return {
        label: t("event.delivering"),
        title: t("event.deliveringTitle", params),
        tone: "delivering"
      };
    case "sent":
    case "processing":
      return {
        label: t("event.processing", params),
        title: t("event.processingTitle", params),
        tone: "processing"
      };
    case "handled":
      return {
        label: t("event.handled"),
        title: t("event.handledTitle"),
        tone: "handled"
      };
    case "failed":
      return {
        label: t("event.failed"),
        title: t("event.failedTitle"),
        tone: "failed"
      };
    case "ignored":
    default:
      return null;
  }
}

function getLocalPendingEventBadge(
  agentLink: AgentLinkResponse | null,
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
): AnnotationEventBadge {
  const providerName = getAgentProviderName(agentLink?.connection.provider ?? null);
  const params = { provider: providerName };
  return {
    label: t("event.processing", params),
    title: t("event.processingTitle", params),
    tone: "processing"
  };
}

function getEventProvider(event: ReviewEvent | null): AgentProvider | null {
  return (
    event?.delivery?.provider ??
    event?.targetAgent?.provider ??
    (event?.targetThreadId ? "codex" : null)
  );
}

function getAgentProviderName(provider: AgentProvider | null): string {
  if (provider === "claude-code") {
    return "Claude Code";
  }
  if (provider === "workbuddy") {
    return "WorkBuddy";
  }
  if (provider === "custom-cli") {
    return "Custom CLI";
  }
  return provider === "codex" ? "Codex" : "Agent";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
