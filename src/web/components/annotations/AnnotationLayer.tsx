import { useEffect, useState, type RefObject } from "react";
import type { ReviewAnnotation, ReviewEvent } from "../../../shared/reviewTypes";
import { useI18n } from "../../i18n";
import { getAnnotationRects } from "../../review/anchorResolve";

type AnnotationLayerProps = {
  annotations: ReviewAnnotation[];
  events: ReviewEvent[];
  pendingAnnotationIds?: string[];
  containerRef: RefObject<HTMLElement | null>;
  selectedAnnotationId: string | null;
  onSelect: (annotationId: string, options?: { scroll?: boolean; openSidebar?: boolean }) => void;
  onOpenThread: (input: {
    annotationIds: string[];
    activeAnnotationId: string;
    anchorRect: DOMRect;
  }) => void;
};

type HighlightRect = {
  annotationId: string;
  status: ReviewAnnotation["status"];
  selected: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
};

type AnnotationMarker = {
  annotationId: string;
  status: "pending" | "failed";
  left: number;
  top: number;
  baseRect: HighlightRect;
};

const PENDING_EVENT_STATUSES = new Set<ReviewEvent["deliveryStatus"]>([
  "queued",
  "delivering",
  "sent",
  "processing"
]);
const MARKER_HIT_RADIUS = 7;

export function AnnotationLayer({
  annotations,
  events,
  pendingAnnotationIds = [],
  containerRef,
  selectedAnnotationId,
  onSelect,
  onOpenThread
}: AnnotationLayerProps) {
  const { t } = useI18n();
  const [rects, setRects] = useState<HighlightRect[]>([]);

  useEffect(() => {
    let animationFrame = 0;

    const updateRects = () => {
      const container = containerRef.current;
      if (!container) {
        setRects([]);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const nextRects = annotations.flatMap((annotation) =>
        getAnnotationRects(annotation, container).map((rect) => ({
          annotationId: annotation.id,
          status: annotation.status,
          selected: annotation.id === selectedAnnotationId,
          left: rect.left - containerRect.left,
          top: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height
        }))
      );
      setRects(nextRects);
    };

    const scheduleUpdateRects = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateRects);
    };

    updateRects();
    window.addEventListener("resize", scheduleUpdateRects);
    window.addEventListener("scroll", scheduleUpdateRects, { passive: true });

    const container = containerRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdateRects);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleUpdateRects);

    if (container) {
      resizeObserver?.observe(container);
      container
        .querySelectorAll<HTMLElement>("[data-review-block-id], img, svg")
        .forEach((element) => resizeObserver?.observe(element));
      mutationObserver?.observe(container, {
        attributes: true,
        childList: true,
        subtree: true
      });
      container.addEventListener("load", scheduleUpdateRects, true);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleUpdateRects);
      window.removeEventListener("scroll", scheduleUpdateRects);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      container?.removeEventListener("load", scheduleUpdateRects, true);
    };
  }, [annotations, containerRef, selectedAnnotationId]);

  return (
    <div className="annotation-layer">
      {rects.map((rect, index) => (
        <button
          key={`${rect.annotationId}-${index}`}
          type="button"
          className={`annotation-highlight annotation-highlight-${rect.status}${
            rect.selected ? " annotation-highlight-selected" : ""
          }`}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }}
          onClick={(event) => {
            const targetRect = event.currentTarget.getBoundingClientRect();
            openThreadForRect(rect, targetRect, rects, events, onSelect, onOpenThread);
          }}
          tabIndex={-1}
        />
      ))}
      {getAnnotationMarkers(rects, events, pendingAnnotationIds).map((marker) => (
        <button
          key={`marker-${marker.annotationId}`}
          type="button"
          className={`annotation-highlight-marker annotation-highlight-marker-${marker.status}`}
          style={{
            left: marker.left,
            top: marker.top
          }}
          aria-label={
            marker.status === "failed"
              ? t("annotation.failedInline")
              : t("annotation.processingInline")
          }
          onClick={(event) => {
            event.stopPropagation();
            const targetRect = event.currentTarget.getBoundingClientRect();
            openThreadForRect(marker.baseRect, targetRect, rects, events, onSelect, onOpenThread);
          }}
          tabIndex={-1}
        >
          <span aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function getAnnotationMarkers(
  rects: HighlightRect[],
  events: ReviewEvent[],
  pendingAnnotationIds: string[]
): AnnotationMarker[] {
  const grouped = new Map<string, HighlightRect[]>();
  const localPending = new Set(pendingAnnotationIds);
  for (const rect of rects) {
    const existing = grouped.get(rect.annotationId) ?? [];
    existing.push(rect);
    grouped.set(rect.annotationId, existing);
  }

  return Array.from(grouped.entries()).flatMap(([annotationId, annotationRects]) => {
    const latestEvent = getLatestAnnotationEvent(events, annotationId);
    const status = localPending.has(annotationId) ? "pending" : getMarkerStatus(latestEvent);
    if (!status) {
      return [];
    }

    const baseRect = getMarkerBaseRect(annotationRects);
    return [
      {
        annotationId,
        status,
        left: Math.max(0, baseRect.left + baseRect.width - MARKER_HIT_RADIUS),
        top: Math.max(0, baseRect.top - MARKER_HIT_RADIUS),
        baseRect
      }
    ];
  });
}

function getMarkerStatus(event: ReviewEvent | null): AnnotationMarker["status"] | null {
  if (!event) {
    return null;
  }
  if (PENDING_EVENT_STATUSES.has(event.deliveryStatus)) {
    return "pending";
  }
  if (event.deliveryStatus === "failed") {
    return "failed";
  }
  return null;
}

function openThreadForRect(
  baseRect: HighlightRect,
  targetRect: DOMRect,
  rects: HighlightRect[],
  events: ReviewEvent[],
  onSelect: AnnotationLayerProps["onSelect"],
  onOpenThread: AnnotationLayerProps["onOpenThread"]
): void {
  const overlapping = rects.filter((rect) => rectsOverlap(baseRect, rect));
  const ids = unique(overlapping.map((rect) => rect.annotationId));
  const annotationIds = sortAnnotationIds(ids.length > 0 ? ids : [baseRect.annotationId], events);
  const activeAnnotationId = annotationIds[0] ?? baseRect.annotationId;

  onSelect(activeAnnotationId, { scroll: false, openSidebar: false });
  onOpenThread({
    annotationIds,
    activeAnnotationId,
    anchorRect: targetRect
  });
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

function sortAnnotationIds(annotationIds: string[], events: ReviewEvent[]): string[] {
  return [...annotationIds].sort((left, right) => {
    const leftEvent = getLatestAnnotationEvent(events, left);
    const rightEvent = getLatestAnnotationEvent(events, right);
    const leftRank = getEventPriority(leftEvent);
    const rightRank = getEventPriority(rightEvent);
    if (leftRank !== rightRank) {
      return rightRank - leftRank;
    }
    return getEventTime(rightEvent) - getEventTime(leftEvent);
  });
}

function getEventPriority(event: ReviewEvent | null): number {
  if (!event) {
    return 0;
  }
  if (PENDING_EVENT_STATUSES.has(event.deliveryStatus)) {
    return 3;
  }
  if (event.deliveryStatus === "failed") {
    return 2;
  }
  return 1;
}

function getEventTime(event: ReviewEvent | null): number {
  return new Date(event?.updatedAt ?? event?.createdAt ?? 0).getTime();
}

function getMarkerBaseRect(rects: HighlightRect[]): HighlightRect {
  return [...rects].sort((left, right) => {
    if (left.top !== right.top) {
      return right.top - left.top;
    }
    return right.left + right.width - (left.left + left.width);
  })[0] ?? rects[0];
}

function rectsOverlap(left: HighlightRect, right: HighlightRect): boolean {
  return !(
    left.left + left.width < right.left ||
    right.left + right.width < left.left ||
    left.top + left.height < right.top ||
    right.top + right.height < left.top
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
