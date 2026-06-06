import mermaid, { type MermaidConfig } from "mermaid";
import { Image as ImageIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CodeBlock } from "../CodeBlock";
import { MermaidContextMenu } from "./MermaidContextMenu";
import { MermaidLightbox } from "./MermaidLightbox";
import { MermaidToolbar } from "./MermaidToolbar";
import { useI18n } from "../../i18n";
import {
  copyPng,
  copyMermaidSource,
  downloadPng
} from "./exportUtils";
import {
  getCachedMermaidSvg,
  getMermaidCacheKey,
  setCachedMermaidSvg
} from "./mermaidRenderCache";
import { applyAutoFit } from "./svgUtils";
import type {
  MermaidActionHandlers,
  MermaidBackground,
  MermaidRenderState,
  PngExportOptions
} from "./types";

type MermaidBlockProps = {
  code: string;
  documentId: string;
  index: number;
  reviewBlockProps?: Record<string, string>;
};

type ContextMenuState = {
  x: number;
  y: number;
} | null;

let mermaidRenderQueue: Promise<unknown> = Promise.resolve();

export function MermaidBlock({ code, documentId, index, reviewBlockProps }: MermaidBlockProps) {
  const { t } = useI18n();
  const [background, setBackground] = useState<MermaidBackground>(() => getSystemTheme());
  const [viewMode, setViewMode] = useState<"diagram" | "source">("diagram");
  const appThemeKey = useAppThemeKey();
  const themeKey = background;
  const visualBackground = background;
  const pngBackground: PngExportOptions["background"] =
    visualBackground === "dark" ? "dark" : "white";
  const cacheKey = getMermaidCacheKey(documentId, index, code, `${themeKey}-${appThemeKey}`);
  const [state, setState] = useState<MermaidRenderState>(() => {
    const cachedSvg = getCachedMermaidSvg(cacheKey);
    return cachedSvg ? { status: "ready", svg: cachedSvg } : { status: "rendering" };
  });
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxInitialZoom, setLightboxInitialZoom] = useState(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const blockRef = useRef<HTMLElement | null>(null);
  const renderIdRef = useRef(
    `mermaid-${documentId}-${index}-${Math.random().toString(36).slice(2)}`
  );

  const openLightbox = useCallback((initialZoom = 1) => {
    setLightboxInitialZoom(initialZoom);
    setIsLightboxOpen(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const cachedSvg = getCachedMermaidSvg(cacheKey);
    if (cachedSvg) {
      setState({ status: "ready", svg: cachedSvg });
      return;
    }

    setState({ status: "rendering" });

    renderMermaidDiagram(
      `${renderIdRef.current}-${themeKey}-${appThemeKey}`,
      code,
      getMermaidConfig(themeKey)
    )
      .then(({ svg }) => {
        if (!cancelled) {
          setCachedMermaidSvg(cacheKey, svg);
          setState({ status: "ready", svg });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to render Mermaid diagram."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appThemeKey, cacheKey, code, themeKey]);

  useLayoutEffect(() => {
    const svg = getCurrentSvg();
    if (svg) {
      applyAutoFit(svg);
    }
  }, [state, viewMode]);

  useEffect(() => {
    const block = blockRef.current;
    if (!block || state.status !== "ready" || viewMode !== "diagram") {
      return;
    }

    const handleInlinePinch = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openLightbox(getInlinePinchInitialZoom(event));
    };

    block.addEventListener("wheel", handleInlinePinch, { passive: false });
    return () => block.removeEventListener("wheel", handleInlinePinch);
  }, [openLightbox, state.status, viewMode]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const showFeedback = (message: string) => {
    setFeedback(message);
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 1600);
  };

  const runAction = async (label: string, action: () => Promise<void> | void) => {
    try {
      await action();
      showFeedback(label);
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Action failed");
    }
  };

  const getCurrentSvg = () => {
    const svg = blockRef.current?.querySelector(".mermaid-diagram svg");
    return svg instanceof SVGSVGElement ? svg : null;
  };

  const toggleBackground = () => {
    setBackground((current) => (current === "light" ? "dark" : "light"));
  };

  const actions: MermaidActionHandlers = useMemo(
    () => ({
      openLightbox: () => {
        openLightbox();
      },
      showSource: () => {
        setViewMode("source");
      },
      copySource: () => {
        void runAction(t("code.copied"), () => copyMermaidSource(code));
      },
      copyPng: () => {
        void runAction(t("code.copied"), async () => {
          const svg = getCurrentSvg();
          if (!svg) {
            throw new Error(t("mermaid.svgNotReady"));
          }
          await copyPng(svg, { scale: 2, background: pngBackground });
        });
      },
      exportPng: () => {
        void runAction(t("mermaid.exported"), async () => {
          const svg = getCurrentSvg();
          if (!svg) {
            throw new Error(t("mermaid.svgNotReady"));
          }
          await downloadPng(svg, { scale: 2, background: pngBackground });
        });
      },
      toggleBackground
    }),
    [code, openLightbox, pngBackground, t]
  );

  if (viewMode === "source") {
    return (
      <CodeBlock
        code={code}
        language="mermaid"
        className="language-mermaid"
        reviewBlockProps={reviewBlockProps}
        extraActions={[
          {
            label: t("mermaid.switchDiagram"),
            icon: <ImageIcon size={15} />,
            onClick: () => setViewMode("diagram")
          }
        ]}
      />
    );
  }

  if (state.status === "error") {
    return (
      <figure className="mermaid-block mermaid-block-error">
        <figcaption>{state.message}</figcaption>
        <CodeBlock
          code={code}
          language="mermaid"
          className="language-mermaid"
          reviewBlockProps={reviewBlockProps}
        />
      </figure>
    );
  }

  if (state.status === "rendering") {
    return (
      <figure {...reviewBlockProps} className="mermaid-block mermaid-block-loading">
        {t("mermaid.rendering")}
      </figure>
    );
  }

  return (
    <>
      <figure
        {...reviewBlockProps}
        ref={blockRef}
        className={`mermaid-block mermaid-bg-${visualBackground}`}
        onClick={() => openLightbox()}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <MermaidToolbar actions={actions} background={background} />
        <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />
        {feedback ? <div className="mermaid-feedback">{feedback}</div> : null}
        {contextMenu ? (
          <MermaidContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            actions={actions}
            onClose={() => setContextMenu(null)}
          />
        ) : null}
      </figure>
      {isLightboxOpen ? (
        <MermaidLightbox
          svg={state.svg}
          background={visualBackground}
          actions={actions}
          initialZoom={lightboxInitialZoom}
          onClose={() => setIsLightboxOpen(false)}
        />
      ) : null}
    </>
  );
}

function getSystemTheme(): MermaidBackground {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInlinePinchInitialZoom(event: WheelEvent): number {
  const normalizedDelta =
    event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * 800
        : event.deltaY;
  const factor = Math.exp(-normalizedDelta * 0.0025);

  return factor > 1 ? Math.min(Math.max(factor, 1.15), 1.8) : 1;
}

function renderMermaidDiagram(id: string, code: string, config: MermaidConfig) {
  const renderTask = mermaidRenderQueue.then(async () => {
    mermaid.initialize(config);
    return mermaid.render(id, code);
  });
  mermaidRenderQueue = renderTask.catch(() => undefined);
  return renderTask;
}

function getMermaidConfig(themeKey: MermaidBackground): MermaidConfig {
  return themeKey === "dark"
    ? {
        ...baseMermaidConfig,
        darkMode: true,
        themeVariables: darkThemeVariables
      }
    : {
        ...baseMermaidConfig,
        darkMode: false,
        themeVariables: getLightThemeVariables()
      };
}

const baseMermaidConfig: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  flowchart: {
    htmlLabels: false
  },
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
};

const lightThemeVariables = {
  background: "#ffffff",
  mainBkg: "#f7fbf9",
  primaryColor: "#eef8f4",
  primaryTextColor: "#1d342d",
  primaryBorderColor: "#7ba99a",
  lineColor: "#54756b",
  textColor: "#243b34",
  secondaryColor: "#eef3ff",
  tertiaryColor: "#fff6e7",
  edgeLabelBackground: "#ffffff",
  clusterBkg: "#f4faf7",
  clusterBorder: "#b4cec5",
  noteBkgColor: "#fff7d8",
  noteTextColor: "#3d3421",
  noteBorderColor: "#dcc276"
};

function useAppThemeKey(): string {
  const [appThemeKey, setAppThemeKey] = useState(getAppThemeKey);

  useEffect(() => {
    const observer = new MutationObserver(() => setAppThemeKey(getAppThemeKey()));
    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
      attributes: true
    });
    return () => observer.disconnect();
  }, []);

  return appThemeKey;
}

function getAppThemeKey(): string {
  return document.documentElement.dataset.theme || "default";
}

function getLightThemeVariables(): typeof lightThemeVariables {
  const styles = getComputedStyle(document.documentElement);
  const cssColor = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    background: cssColor("--mermaid-light-bg", lightThemeVariables.background),
    mainBkg: cssColor("--surface-control-muted", lightThemeVariables.mainBkg),
    primaryColor: cssColor("--surface-selected-soft", lightThemeVariables.primaryColor),
    primaryTextColor: cssColor("--color-ink", lightThemeVariables.primaryTextColor),
    primaryBorderColor: cssColor("--color-border-strong", lightThemeVariables.primaryBorderColor),
    lineColor: cssColor("--color-muted", lightThemeVariables.lineColor),
    textColor: cssColor("--color-ink", lightThemeVariables.textColor),
    secondaryColor: cssColor("--color-info-bg", lightThemeVariables.secondaryColor),
    tertiaryColor: cssColor("--color-open-bg", lightThemeVariables.tertiaryColor),
    edgeLabelBackground: cssColor("--color-paper-strong", lightThemeVariables.edgeLabelBackground),
    clusterBkg: cssColor("--color-paper", lightThemeVariables.clusterBkg),
    clusterBorder: cssColor("--color-border", lightThemeVariables.clusterBorder),
    noteBkgColor: cssColor("--color-open-bg", lightThemeVariables.noteBkgColor),
    noteTextColor: cssColor("--color-open-text", lightThemeVariables.noteTextColor),
    noteBorderColor: cssColor("--color-warning", lightThemeVariables.noteBorderColor)
  };
}

const darkThemeVariables = {
  background: "#151817",
  mainBkg: "#202a26",
  primaryColor: "#203b34",
  primaryTextColor: "#edf7f3",
  primaryBorderColor: "#68b99f",
  lineColor: "#9bcbbb",
  textColor: "#edf4f1",
  secondaryColor: "#252e3c",
  tertiaryColor: "#3b2f25",
  edgeLabelBackground: "#151817",
  clusterBkg: "#1b2320",
  clusterBorder: "#557b6d",
  noteBkgColor: "#3a3220",
  noteTextColor: "#fff1c4",
  noteBorderColor: "#b99d4e"
};
