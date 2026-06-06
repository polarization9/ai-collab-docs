import {
  createElement,
  isValidElement,
  lazy,
  memo,
  Suspense,
  type ReactNode
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { Heading, HeadingLevel, ReviewDocument } from "../../shared/types";
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
  let headingIndex = 0;
  let mermaidIndex = 0;
  let blockIndex = 0;
  let currentHeading: Heading | null = null;

  const getBlockProps = (kind: string, heading = currentHeading) => {
    const index = blockIndex++;
    return {
      "data-review-block-id": `block-${index}`,
      "data-review-block-index": String(index),
      "data-review-block-kind": kind,
      "data-review-heading-id": heading?.id ?? "",
      "data-review-heading-text": heading?.text ?? ""
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
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    img({ alt, src, title }) {
      return (
        <img
          className="document-image"
          src={resolveDocumentImageSrc(src, document.absolutePath)}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
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

function resolveDocumentImageSrc(src: string | undefined, documentPath: string): string {
  if (!src) {
    return "";
  }

  if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith("//")) {
    return src;
  }

  return `/api/document-asset?src=${encodeURIComponent(src)}&documentPath=${encodeURIComponent(documentPath)}`;
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
