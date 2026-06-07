import {
  ClipboardCopy,
  FileImage,
  Image,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  X
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { MermaidMinimap } from "./MermaidMinimap";
import type { MermaidActionHandlers, MermaidBackground, SvgViewBox } from "./types";
import { ensureViewBox, sanitizeSvg, setViewBox } from "./svgUtils";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 9.99;
const ZOOM_STEP = 0.2;
const PAN_STEP = 70;

type MermaidLightboxProps = {
  svg: string;
  background: MermaidBackground;
  actions: MermaidActionHandlers;
  initialZoom?: number;
  onClose: () => void;
};

type ViewState = {
  originalViewBox: SvgViewBox;
  zoom: number;
  panX: number;
  panY: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
};

type ZoomResolver = (currentZoom: number) => number;

export function MermaidLightbox({
  svg,
  background,
  actions,
  initialZoom = 1,
  onClose
}: MermaidLightboxProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  const zoomInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [zoomInput, setZoomInput] = useState("100");

  useLayoutEffect(() => {
    if (!svgHostRef.current) {
      return;
    }

    svgHostRef.current.innerHTML = svg;
    const svgElement = getLightboxSvg(svgHostRef.current);
    if (!svgElement) {
      return;
    }

    sanitizeSvg(svgElement);
    const originalViewBox = ensureViewBox(svgElement);
    const zoom = clamp(initialZoom, MIN_ZOOM, MAX_ZOOM);
    const visibleWidth = originalViewBox.width / zoom;
    const visibleHeight = originalViewBox.height / zoom;
    svgElement.setAttribute("width", "100%");
    svgElement.setAttribute("height", "100%");
    svgElement.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svgElement.style.width = "100%";
    svgElement.style.height = "100%";
    svgElement.style.maxWidth = "none";
    setView({
      originalViewBox,
      zoom,
      panX: originalViewBox.x + (originalViewBox.width - visibleWidth) / 2,
      panY: originalViewBox.y + (originalViewBox.height - visibleHeight) / 2
    });
    return () => {
      if (svgHostRef.current) {
        svgHostRef.current.innerHTML = "";
      }
    };
  }, [initialZoom, svg]);

  useLayoutEffect(() => {
    if (!view) {
      return;
    }

    const svgElement = getLightboxSvg(svgHostRef.current);
    if (!svgElement) {
      return;
    }

    setViewBox(svgElement, {
      x: view.panX,
      y: view.panY,
      width: view.originalViewBox.width / view.zoom,
      height: view.originalViewBox.height / view.zoom
    });
  }, [view]);

  const resetView = useCallback(() => {
    setView((current) =>
      current
        ? {
            ...current,
            zoom: 1,
            panX: current.originalViewBox.x,
            panY: current.originalViewBox.y
          }
        : current
    );
  }, []);

  useEffect(() => {
    if (view) {
      setZoomInput(String(Math.round(view.zoom * 100)));
    }
  }, [view?.zoom]);

  const zoomAt = useCallback((screenX: number, screenY: number, resolveNextZoom: ZoomResolver) => {
    setView((current) => {
      if (!current || !viewportRef.current) {
        return current;
      }

      const nextZoom = clamp(resolveNextZoom(current.zoom), MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === current.zoom) {
        return current;
      }

      const rect = viewportRef.current.getBoundingClientRect();
      const relX = clamp((screenX - rect.left) / rect.width, 0, 1);
      const relY = clamp((screenY - rect.top) / rect.height, 0, 1);
      const visibleWidth = current.originalViewBox.width / current.zoom;
      const visibleHeight = current.originalViewBox.height / current.zoom;
      const cursorX = current.panX + relX * visibleWidth;
      const cursorY = current.panY + relY * visibleHeight;
      const nextVisibleWidth = current.originalViewBox.width / nextZoom;
      const nextVisibleHeight = current.originalViewBox.height / nextZoom;
      const nextPan = clampPan(
        current,
        nextZoom,
        cursorX - relX * nextVisibleWidth,
        cursorY - relY * nextVisibleHeight
      );

      return {
        ...current,
        zoom: nextZoom,
        panX: nextPan.x,
        panY: nextPan.y
      };
    });
  }, []);

  const setZoomPercent = useCallback((percent: number) => {
    setView((current) => {
      if (!current) {
        return current;
      }

      const nextZoom = clamp(percent / 100, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === current.zoom) {
        return current;
      }

      const visibleWidth = current.originalViewBox.width / current.zoom;
      const visibleHeight = current.originalViewBox.height / current.zoom;
      const centerX = current.panX + visibleWidth / 2;
      const centerY = current.panY + visibleHeight / 2;
      const nextPan = clampPan(
        current,
        nextZoom,
        centerX - current.originalViewBox.width / nextZoom / 2,
        centerY - current.originalViewBox.height / nextZoom / 2
      );

      return {
        ...current,
        zoom: nextZoom,
        panX: nextPan.x,
        panY: nextPan.y
      };
    });
  }, []);

  const panBy = useCallback((deltaX: number, deltaY: number) => {
    setView((current) => {
      if (!current || current.zoom <= 1) {
        return current;
      }

      const nextPan = clampPan(
        current,
        current.zoom,
        current.panX + deltaX / current.zoom,
        current.panY + deltaY / current.zoom
      );

      return {
        ...current,
        panX: nextPan.x,
        panY: nextPan.y
      };
    });
  }, []);

  const commitZoomInput = useCallback(() => {
    const parsed = Number.parseInt(zoomInput, 10);
    const percent = Number.isFinite(parsed) ? clamp(parsed, 1, 999) : Math.round((view?.zoom ?? 1) * 100);
    setZoomInput(String(percent));
    setZoomPercent(percent);
  }, [setZoomPercent, view?.zoom, zoomInput]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const target = event.target;
      const isInViewport = target instanceof Node && viewportRef.current?.contains(target);
      const isZoomInput = target instanceof Element && target.closest(".mermaid-zoom-indicator");
      const isZoomGesture = event.ctrlKey || event.metaKey;

      if (isZoomInput) {
        if (isZoomGesture) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!isZoomGesture && !isInViewport) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (isZoomGesture) {
        const factor = getWheelZoomFactor(event);
        if (isInViewport) {
          zoomAt(event.clientX, event.clientY, (currentZoom) => currentZoom * factor);
        } else {
          zoomFromCenter(zoomAt, (currentZoom) => currentZoom * factor, viewportRef);
        }
      } else {
        panBy(event.deltaX, event.deltaY);
      }
    },
    [panBy, zoomAt]
  );

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) {
      return;
    }

    backdrop.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => backdrop.removeEventListener("wheel", handleWheel, true);
  }, [handleWheel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (rect) {
          zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, (currentZoom) => currentZoom + ZOOM_STEP);
        }
      } else if (event.key === "-") {
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (rect) {
          zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, (currentZoom) => currentZoom - ZOOM_STEP);
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        panBy(-PAN_STEP, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        panBy(PAN_STEP, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        panBy(0, -PAN_STEP);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        panBy(0, PAN_STEP);
      } else if (event.key === "r" || event.key === "R" || event.key === "0") {
        event.preventDefault();
        resetView();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, panBy, resetView, zoomAt]);

  const handleMinimapJump = (xRatio: number, yRatio: number) => {
    setView((current) => {
      if (!current) {
        return current;
      }

      const visibleWidth = current.originalViewBox.width / current.zoom;
      const visibleHeight = current.originalViewBox.height / current.zoom;
      const nextPan = clampPan(
        current,
        current.zoom,
        current.originalViewBox.x + xRatio * current.originalViewBox.width - visibleWidth / 2,
        current.originalViewBox.y + yRatio * current.originalViewBox.height - visibleHeight / 2
      );

      return {
        ...current,
        panX: nextPan.x,
        panY: nextPan.y
      };
    });
  };

  const zoomPercent = view ? String(Math.round(view.zoom * 100)) : "100";

  return createPortal(
    <div
      ref={backdropRef}
      className="mermaid-lightbox-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={`mermaid-lightbox mermaid-bg-${background}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("mermaid.lightbox")}
      >
        <div className="mermaid-lightbox-topbar">
          <div className="mermaid-lightbox-title">{t("mermaid.lightbox")}</div>
          <div className="mermaid-lightbox-actions">
            <IconButton label={t("mermaid.zoomOut")} onClick={() => zoomFromCenter(zoomAt, (currentZoom) => currentZoom - ZOOM_STEP, viewportRef)}>
              <Minus size={16} />
            </IconButton>
            <IconButton label={t("mermaid.zoomIn")} onClick={() => zoomFromCenter(zoomAt, (currentZoom) => currentZoom + ZOOM_STEP, viewportRef)}>
              <Plus size={16} />
            </IconButton>
            <IconButton label={t("mermaid.resetView")} onClick={resetView}>
              <RotateCcw size={16} />
            </IconButton>
            <IconButton label={t("mermaid.copySource")} onClick={actions.copySource}>
              <ClipboardCopy size={16} />
            </IconButton>
            <IconButton label={t("mermaid.copyPng")} onClick={actions.copyPng}>
              <FileImage size={16} />
            </IconButton>
            <IconButton label={t("mermaid.exportPng")} onClick={actions.exportPng}>
              <Image size={16} />
            </IconButton>
            <IconButton label={background === "light" ? t("mermaid.switchDark") : t("mermaid.switchLight")} onClick={actions.toggleBackground}>
              <Palette size={16} />
            </IconButton>
            <IconButton label={t("mermaid.close")} onClick={onClose}>
              <X size={17} />
            </IconButton>
          </div>
        </div>
        <div
          className="mermaid-lightbox-viewport"
          ref={viewportRef}
          onDoubleClick={(event) => {
            event.preventDefault();
            resetView();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !view) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              startPanX: view.panX,
              startPanY: view.panY
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || !view || !viewportRef.current) {
              return;
            }
            const rect = viewportRef.current.getBoundingClientRect();
            const scaleX = view.originalViewBox.width / view.zoom / rect.width;
            const scaleY = view.originalViewBox.height / view.zoom / rect.height;
            const nextPan = clampPan(
              view,
              view.zoom,
              drag.startPanX - (event.clientX - drag.startX) * scaleX,
              drag.startPanY - (event.clientY - drag.startY) * scaleY
            );
            setView({
              ...view,
              panX: nextPan.x,
              panY: nextPan.y
            });
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) {
              dragRef.current = null;
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          <div
            className="mermaid-lightbox-svg"
            ref={svgHostRef}
          />
          {view ? (
            <MermaidMinimap
              svg={svg}
              originalViewBox={view.originalViewBox}
              zoom={view.zoom}
              panX={view.panX}
              panY={view.panY}
              onJump={handleMinimapJump}
            />
          ) : null}
          <div className="mermaid-lightbox-hint">
            {t("mermaid.lightboxHint")}
          </div>
          <form
            className="mermaid-zoom-indicator"
            aria-label={t("mermaid.customZoomPercentage")}
            onSubmit={(event) => {
              event.preventDefault();
              commitZoomInput();
              zoomInputRef.current?.blur();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <input
              ref={zoomInputRef}
              aria-label={t("mermaid.zoomPercentage")}
              inputMode="numeric"
              maxLength={3}
              pattern="[0-9]*"
              value={zoomInput}
              onBlur={commitZoomInput}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "");
                if (!digits) {
                  setZoomInput("");
                  return;
                }
                setZoomInput(String(Math.min(Number(digits), 999)));
              }}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  setZoomInput(zoomPercent);
                  zoomInputRef.current?.blur();
                }
              }}
            />
            <span>%</span>
          </form>
        </div>
      </section>
    </div>,
    document.body
  );
}

function IconButton({
  children,
  label,
  onClick
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-label={label} data-tooltip={label} onClick={onClick}>
      {children}
    </button>
  );
}

function getLightboxSvg(host: HTMLDivElement | null): SVGSVGElement | null {
  const svg = host?.querySelector("svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

function zoomFromCenter(
  zoomAt: (screenX: number, screenY: number, resolveNextZoom: ZoomResolver) => void,
  resolveNextZoom: ZoomResolver,
  viewportRef: React.RefObject<HTMLDivElement | null>
): void {
  const rect = viewportRef.current?.getBoundingClientRect();
  if (!rect) {
    return;
  }
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, resolveNextZoom);
}

function getWheelZoomFactor(event: WheelEvent): number {
  const normalizedDelta =
    event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * 800
        : event.deltaY;

  return clamp(Math.exp(-normalizedDelta * 0.0025), 0.72, 1.38);
}

function clampPan(view: ViewState, zoom: number, panX: number, panY: number) {
  const visibleWidth = view.originalViewBox.width / zoom;
  const visibleHeight = view.originalViewBox.height / zoom;

  return {
    x: clampAxis(panX, view.originalViewBox.x, view.originalViewBox.width, visibleWidth),
    y: clampAxis(panY, view.originalViewBox.y, view.originalViewBox.height, visibleHeight)
  };
}

function clampAxis(value: number, origin: number, total: number, visible: number) {
  if (visible >= total) {
    return origin + (total - visible) / 2;
  }

  return Math.min(Math.max(value, origin), origin + total - visible);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
