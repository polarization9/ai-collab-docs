import { useEffect, useState, type RefObject } from "react";
import type { ReviewAnnotation } from "../../../shared/reviewTypes";
import { getAnnotationRects } from "../../review/anchorResolve";

type AnnotationLayerProps = {
  annotations: ReviewAnnotation[];
  containerRef: RefObject<HTMLElement | null>;
  selectedAnnotationId: string | null;
  onSelect: (annotationId: string) => void;
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

export function AnnotationLayer({
  annotations,
  containerRef,
  selectedAnnotationId,
  onSelect
}: AnnotationLayerProps) {
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
          onClick={() => onSelect(rect.annotationId)}
          tabIndex={-1}
        />
      ))}
    </div>
  );
}
