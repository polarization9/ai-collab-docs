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

    updateRects();
    window.addEventListener("resize", updateRects);
    window.addEventListener("scroll", updateRects, { passive: true });
    return () => {
      window.removeEventListener("resize", updateRects);
      window.removeEventListener("scroll", updateRects);
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
