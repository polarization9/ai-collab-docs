import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";

type MermaidBlockProps = {
  code: string;
  documentId: string;
  index: number;
};

type MermaidState =
  | { status: "rendering" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

let mermaidInitialized = false;
const mermaidRenderCache = new Map<string, string>();

export function MermaidBlock({ code, documentId, index }: MermaidBlockProps) {
  const cacheKey = `${documentId}:${index}:${code}`;
  const [state, setState] = useState<MermaidState>(() => {
    const cachedSvg = mermaidRenderCache.get(cacheKey);
    return cachedSvg ? { status: "ready", svg: cachedSvg } : { status: "rendering" };
  });
  const renderIdRef = useRef(
    `mermaid-${documentId}-${index}-${Math.random().toString(36).slice(2)}`
  );

  useEffect(() => {
    let cancelled = false;

    const cachedSvg = mermaidRenderCache.get(cacheKey);
    if (cachedSvg) {
      setState({ status: "ready", svg: cachedSvg });
      return;
    }

    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default"
      });
      mermaidInitialized = true;
    }

    setState({ status: "rendering" });

    mermaid
      .render(renderIdRef.current, code)
      .then(({ svg }) => {
        if (!cancelled) {
          mermaidRenderCache.set(cacheKey, svg);
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
  }, [cacheKey, code]);

  if (state.status === "ready") {
    return (
      <figure
        className="mermaid-block"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  if (state.status === "error") {
    return (
      <figure className="mermaid-block mermaid-block-error">
        <figcaption>{state.message}</figcaption>
        <pre>
          <code>{code}</code>
        </pre>
      </figure>
    );
  }

  return <figure className="mermaid-block mermaid-block-loading">Rendering diagram...</figure>;
}
