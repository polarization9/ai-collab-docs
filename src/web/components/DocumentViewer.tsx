import {
  createElement,
  isValidElement,
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownBlockKind
} from "../../shared/markdownBlocks";
import type { Heading, HeadingLevel, ReviewDocument } from "../../shared/types";
import { fetchDocumentAssetObjectUrl } from "../api";
import { CodeBlock } from "./CodeBlock";
import { ResizableTable } from "./ResizableTable";

const MermaidBlock = lazy(() =>
  import("./mermaid/MermaidBlock").then((module) => ({
    default: module.MermaidBlock
  }))
);

type DocumentViewerProps = {
  document: ReviewDocument;
};

export const DocumentViewer = memo(function DocumentViewer({ document }: DocumentViewerProps) {
  const canonicalBlocks = useMemo(
    () => parseMarkdownBlocks(document.content).blocks,
    [document.content]
  );
  let headingIndex = 0;
  let mermaidIndex = 0;
  let blockIndex = 0;
  let currentHeading: Heading | null = null;

  const getBlockProps = (kind: MarkdownBlockKind, heading = currentHeading) => {
    const block = takeCanonicalBlock(canonicalBlocks, blockIndex, kind, heading);
    blockIndex = block ? block.index + 1 : blockIndex + 1;
    return {
      "data-review-block-id": block?.id ?? `block-${blockIndex - 1}`,
      "data-review-block-index": String(block?.index ?? blockIndex - 1),
      "data-review-block-kind": block?.kind ?? kind,
      "data-review-heading-id": block?.headingId ?? heading?.id ?? "",
      "data-review-heading-text": block?.headingText ?? heading?.text ?? ""
    };
  };

  const components: Components = {
    h1: createHeadingComponent(1, () => {
      currentHeading = document.headings[headingIndex++] ?? currentHeading;
      return { heading: currentHeading, blockProps: getBlockProps("heading", currentHeading) };
    }),
    h2: createHeadingComponent(2, () => {
      currentHeading = document.headings[headingIndex++] ?? currentHeading;
      return { heading: currentHeading, blockProps: getBlockProps("heading", currentHeading) };
    }),
    h3: createHeadingComponent(3, () => {
      currentHeading = document.headings[headingIndex++] ?? currentHeading;
      return { heading: currentHeading, blockProps: getBlockProps("heading", currentHeading) };
    }),
    h4: createHeadingComponent(4, () => {
      currentHeading = document.headings[headingIndex++] ?? currentHeading;
      return { heading: currentHeading, blockProps: getBlockProps("heading", currentHeading) };
    }),
    h5: createHeadingComponent(5, () => {
      currentHeading = document.headings[headingIndex++] ?? currentHeading;
      return { heading: currentHeading, blockProps: getBlockProps("heading", currentHeading) };
    }),
    h6: createHeadingComponent(6, () => {
      currentHeading = document.headings[headingIndex++] ?? currentHeading;
      return { heading: currentHeading, blockProps: getBlockProps("heading", currentHeading) };
    }),
    p({ children }) {
      return <p {...getBlockProps("paragraph")}>{children}</p>;
    },
    li({ children }) {
      return <li {...getBlockProps("list-item")}>{children}</li>;
    },
    blockquote({ children }) {
      return <blockquote {...getBlockProps("blockquote")}>{children}</blockquote>;
    },
    hr() {
      return <hr {...getBlockProps("thematic-break")} />;
    },
    code({ className, children, ...props }) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      if (isValidElement(children)) {
        const childProps = children.props as {
          className?: string;
          children?: ReactNode;
        };
        const language = /language-(\w+)/.exec(childProps.className || "")?.[1];

        if (language === "mermaid") {
          const code = stringifyReactNode(childProps.children).replace(/\n$/, "");
          const index = mermaidIndex++;
          const reviewBlockProps = {
            ...getBlockProps("mermaid"),
            "data-review-mermaid-index": String(index)
          };
          return (
            <Suspense
              fallback={
                <CodeBlock
                  code={code}
                  language="mermaid"
                  className={childProps.className}
                  reviewBlockProps={reviewBlockProps}
                />
              }
            >
              <MermaidBlock
                code={code}
                documentId={document.id}
                index={index}
                reviewBlockProps={reviewBlockProps}
              />
            </Suspense>
          );
        }

        const code = stringifyReactNode(childProps.children).replace(/\n$/, "");
        return (
          <CodeBlock
            code={code}
            language={language}
            className={childProps.className}
            reviewBlockProps={getBlockProps("code")}
          />
        );
      }

      return (
        <CodeBlock
          code={stringifyReactNode(children).replace(/\n$/, "")}
          reviewBlockProps={getBlockProps("code")}
        />
      );
    },
    table({ children }) {
      return (
        <div {...getBlockProps("table")}>
          <ResizableTable>{children}</ResizableTable>
        </div>
      );
    },
    a({ children, href }) {
      if (href?.startsWith("#")) {
        return (
          <a href={href} onClick={(event) => scrollToDocumentHash(event, href)}>
            {children}
          </a>
        );
      }

      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    img({ alt, src, title }) {
      return (
        <DocumentImage
          alt={alt ?? ""}
          documentPath={document.absolutePath}
          src={src}
          title={title}
        />
      );
    }
  };

  return (
    <article className="document-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {document.content}
      </ReactMarkdown>
    </article>
  );
});

function takeCanonicalBlock(
  blocks: MarkdownBlock[],
  cursor: number,
  kind: MarkdownBlockKind,
  heading: Heading | null
): MarkdownBlock | null {
  const current = blocks[cursor];
  if (!current || current.kind === kind) {
    return current ?? null;
  }

  const nextIndex = blocks.findIndex(
    (block, index) =>
      index > cursor &&
      block.kind === kind &&
      (!heading || block.headingId === heading.id || block.headingText === heading.text)
  );
  return nextIndex >= 0 ? blocks[nextIndex] : current;
}

function DocumentImage({
  alt,
  documentPath,
  src,
  title
}: {
  alt: string;
  documentPath: string;
  src?: string;
  title?: string;
}) {
  const [objectUrl, setObjectUrl] = useState("");
  const directSrc = getDirectImageSrc(src);

  useEffect(() => {
    if (directSrc !== null || !src) {
      setObjectUrl("");
      return;
    }

    let cancelled = false;
    let nextObjectUrl = "";

    setObjectUrl("");
    void fetchDocumentAssetObjectUrl(src, documentPath)
      .then((url) => {
        nextObjectUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setObjectUrl("");
        }
      });

    return () => {
      cancelled = true;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [directSrc, documentPath, src]);

  return (
    <img
      className="document-image"
      src={directSrc ?? (objectUrl || undefined)}
      alt={alt}
      title={title}
      loading="lazy"
    />
  );
}

function getDirectImageSrc(src: string | undefined): string | null {
  if (!src) {
    return "";
  }

  if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith("//")) {
    return src;
  }

  return null;
}

function scrollToDocumentHash(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  const targetId = decodeHashId(href);
  if (!targetId) {
    return;
  }

  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  event.preventDefault();
  target.scrollIntoView({ block: "start", behavior: "smooth" });
  window.history.replaceState(null, "", `#${encodeURIComponent(targetId)}`);
}

function decodeHashId(href: string): string {
  const rawHash = href.startsWith("#") ? href.slice(1) : href;
  try {
    return decodeURIComponent(rawHash);
  } catch {
    return rawHash;
  }
}

function stringifyReactNode(node: ReactNode): string {
  if (Array.isArray(node)) {
    return node.map(stringifyReactNode).join("");
  }
  return node === null || node === undefined || typeof node === "boolean" ? "" : String(node);
}

function createHeadingComponent(
  level: HeadingLevel,
  getHeadingState: () => {
    heading: ReviewDocument["headings"][number] | null;
    blockProps: Record<string, string>;
  }
): NonNullable<Components["h1"]> {
  const tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

  return function HeadingComponent({ children }) {
    const { heading, blockProps } = getHeadingState();
    return createElement(
      tag,
      { id: heading?.id, className: "document-heading", ...blockProps },
      children
    );
  };
}
