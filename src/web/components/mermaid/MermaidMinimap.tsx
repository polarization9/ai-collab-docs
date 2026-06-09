import { useMemo } from "react";
import type { SvgViewBox } from "./types";

type MermaidMinimapProps = {
  svg: string;
  originalViewBox: SvgViewBox;
  zoom: number;
  panX: number;
  panY: number;
  onJump: (xRatio: number, yRatio: number) => void;
};

export function MermaidMinimap({
  svg,
  originalViewBox,
  zoom,
  panX,
  panY,
  onJump
}: MermaidMinimapProps) {
  const viewportStyle = useMemo(() => {
    const visibleWidth = originalViewBox.width / zoom;
    const visibleHeight = originalViewBox.height / zoom;
    const left = clamp01((panX - originalViewBox.x) / originalViewBox.width);
    const top = clamp01((panY - originalViewBox.y) / originalViewBox.height);
    const width = Math.min(1, visibleWidth / originalViewBox.width);
    const height = Math.min(1, visibleHeight / originalViewBox.height);

    return {
      left: `${Math.min(left, 1 - width) * 100}%`,
      top: `${Math.min(top, 1 - height) * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`
    };
  }, [originalViewBox, panX, panY, zoom]);

  if (zoom <= 1) {
    return null;
  }

  const jumpFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const xRatio = clamp01((event.clientX - rect.left) / rect.width);
    const yRatio = clamp01((event.clientY - rect.top) / rect.height);
    onJump(xRatio, yRatio);
  };

  return (
    <div
      className="mermaid-minimap"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        jumpFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) {
          jumpFromEvent(event);
        }
      }}
    >
      <div
        className="mermaid-minimap-svg"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="mermaid-minimap-viewport" style={viewportStyle} />
    </div>
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
