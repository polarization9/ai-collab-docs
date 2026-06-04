import { PanelLeftOpen } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { CodexLinkResponse } from "../shared/codexTypes";
import type { ReviewFile } from "../shared/reviewTypes";
import type { ReviewBootstrap, ReviewDocument } from "../shared/types";
import { fetchBootstrap, openDocument, pickDocumentOnServer } from "./api";
import { AnnotationWorkspace } from "./components/annotations/AnnotationWorkspace";
import { Toc } from "./components/Toc";
import {
  getInitialOpenedFiles,
  isTauriRuntime,
  listenForOpenedFiles,
  pickMarkdownFile
} from "./desktop";

const CodexBridgePrototype = lazy(() =>
  import("./prototypes/CodexBridgePrototype").then((module) => ({
    default: module.CodexBridgePrototype
  }))
);

type LoadState =
  | { status: "loading" }
  | { status: "empty"; message?: string }
  | { status: "error"; message: string }
  | {
      status: "ready";
      document: ReviewDocument;
      review: ReviewFile | null;
      codexLink: CodexLinkResponse | null;
    };

type ReadyLoadState = Extract<LoadState, { status: "ready" }>;

export default function App() {
  if (new URLSearchParams(window.location.search).get("prototype") === "codex-bridge") {
    return (
      <Suspense
        fallback={
          <main className="center-state">
            <p>Loading prototype...</p>
          </main>
        }
      >
        <CodexBridgePrototype />
      </Suspense>
    );
  }

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isTocOpen, setIsTocOpen] = useState(true);
  const activeId = useActiveHeading(state.status === "ready" ? state.document.headings : []);

  const openMarkdownPath = useCallback(async (path: string) => {
    setState({ status: "loading" });
    try {
      const document = await openDocument({ path });
      const readyState = await tryLoadReadyStateFromBootstrap();
      setState(readyState ?? { status: "ready", document, review: null, codexLink: null });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to open document."
      });
    }
  }, []);

  const openWithPicker = useCallback(async () => {
    setState({ status: "loading" });

    try {
      if (isTauriRuntime()) {
        const path = await pickMarkdownFile();
        if (!path) {
          setState({ status: "empty" });
          return;
        }
        const document = await openDocument({ path });
        const readyState = await tryLoadReadyStateFromBootstrap();
        setState(readyState ?? { status: "ready", document, review: null, codexLink: null });
        return;
      }

      const document = await pickDocumentOnServer();
      const readyState = await tryLoadReadyStateFromBootstrap();
      setState(readyState ?? { status: "ready", document, review: null, codexLink: null });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to open document."
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialDocument() {
      try {
        const openedFiles = await getInitialOpenedFiles();
        const initialPath = openedFiles[0];
        if (initialPath) {
          await openDocument({ path: initialPath });
        }

        const readyState = await loadReadyStateFromBootstrap();
        if (!readyState) {
          if (!cancelled) {
            setState({ status: "empty" });
          }
          return;
        }

        if (!cancelled) {
          setState(readyState);
        }
      } catch (error: unknown) {
        const recoveredState = await retryLoadReadyStateAfterDelay(700);
        if (recoveredState && !cancelled) {
          setState(recoveredState);
          return;
        }

        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load document."
          });
        }
      }
    }

    loadInitialDocument();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== "error") {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const readyState = await loadReadyStateFromBootstrap();
        if (!readyState || cancelled) {
          return;
        }
        if (!cancelled) {
          setState(readyState);
        }
      } catch {
        // Keep the visible error state when the retry still cannot load the document.
      }
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [state.status]);

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | undefined;

    listenForOpenedFiles((paths) => {
      const path = paths[0];
      if (path) {
        void openMarkdownPath(path);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        disposeListener = dispose;
      }
    });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, [openMarkdownPath]);

  if (state.status === "loading") {
    return (
      <main className="center-state">
        <p>Loading document...</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="center-state center-state-error">
        <p>{state.message}</p>
      </main>
    );
  }

  if (state.status === "empty") {
    return (
      <main className="center-state document-empty-state">
        <div className="document-empty-panel">
          <p className="document-empty-kicker">Margent</p>
          <h1>打开一份 Markdown 文档</h1>
          <p className="document-empty-copy">
            支持 `.md` 和 `.markdown`，批注会保存在文档同目录的 `.review.json`。
          </p>
          <button className="document-empty-action" type="button" onClick={openWithPicker}>
            打开文件
          </button>
          {state.message ? <p className="document-empty-note">{state.message}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <div className={`app-shell${isTocOpen ? "" : " app-shell-toc-collapsed"}`}>
      {isTocOpen ? (
        <Toc
          headings={state.document.headings}
          activeId={activeId}
          onCollapse={() => setIsTocOpen(false)}
        />
      ) : null}
      <main className="document-pane">
        {!isTocOpen ? (
          <button
            type="button"
            className="toc-open-button"
            aria-label="打开目录"
            title="打开目录"
            onClick={() => setIsTocOpen(true)}
          >
            <PanelLeftOpen size={17} />
          </button>
        ) : null}
        <AnnotationWorkspace
          key={state.document.id}
          document={state.document}
          initialReview={state.review}
          initialCodexLink={state.codexLink}
          onDocumentChange={(document) =>
            setState((current) =>
              current.status === "ready"
                ? { ...current, document }
                : { status: "ready", document, review: null, codexLink: null }
            )
          }
        />
      </main>
    </div>
  );
}

async function retryLoadReadyStateAfterDelay(delayMs: number): Promise<ReadyLoadState | null> {
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  return tryLoadReadyStateFromBootstrap();
}

async function tryLoadReadyStateFromBootstrap(): Promise<ReadyLoadState | null> {
  try {
    return await loadReadyStateFromBootstrap();
  } catch {
    return null;
  }
}

async function loadReadyStateFromBootstrap(): Promise<ReadyLoadState | null> {
  return readyStateFromBootstrap(await fetchBootstrap());
}

function readyStateFromBootstrap(bootstrap: ReviewBootstrap): ReadyLoadState | null {
  if (!bootstrap.hasDocument) {
    return null;
  }

  return {
    status: "ready",
    document: bootstrap.document,
    review: bootstrap.review,
    codexLink: bootstrap.codexLink
  };
}

function useActiveHeading(headings: ReviewDocument["headings"]): string | undefined {
  const [activeId, setActiveId] = useState<string | undefined>(headings[0]?.id);

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId(undefined);
      return;
    }

    setActiveId((current) => current ?? headings[0]?.id);

    let frame = 0;

    const updateActiveHeading = () => {
      const scrollBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight - 8;
      if (scrollBottom >= pageBottom) {
        setActiveId(headings[headings.length - 1]?.id);
        return;
      }

      let current = headings[0]?.id;
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (!element) {
          continue;
        }

        if (element.getBoundingClientRect().top <= 140) {
          current = heading.id;
        } else {
          break;
        }
      }

      setActiveId(current);
    };

    const requestUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateActiveHeading);
    };

    updateActiveHeading();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [headings]);

  return activeId;
}
