import { useEffect, useState } from "react";
import type { ReviewDocument } from "../shared/types";
import { fetchDocument } from "./api";
import { DocumentViewer } from "./components/DocumentViewer";
import { Toc } from "./components/Toc";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; document: ReviewDocument };

export default function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const activeId = useActiveHeading(state.status === "ready" ? state.document.headings : []);

  useEffect(() => {
    let cancelled = false;

    fetchDocument()
      .then((document) => {
        if (!cancelled) {
          setState({ status: "ready", document });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load document."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <div className="app-shell">
      <Toc headings={state.document.headings} activeId={activeId} />
      <main className="document-pane">
        <div className="document-meta">
          <span>AI Markdown Reviewer</span>
          <span>{state.document.relativePath}</span>
        </div>
        <DocumentViewer document={state.document} />
      </main>
    </div>
  );
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
