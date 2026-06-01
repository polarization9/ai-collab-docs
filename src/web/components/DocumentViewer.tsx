import { createElement, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { HeadingLevel, ReviewDocument } from "../../shared/types";
import { MermaidBlock } from "./MermaidBlock";

type DocumentViewerProps = {
  document: ReviewDocument;
};

export const DocumentViewer = memo(function DocumentViewer({ document }: DocumentViewerProps) {
  let headingIndex = 0;
  let mermaidIndex = 0;

  const components: Components = {
    h1: createHeadingComponent(1, () => document.headings[headingIndex++]),
    h2: createHeadingComponent(2, () => document.headings[headingIndex++]),
    h3: createHeadingComponent(3, () => document.headings[headingIndex++]),
    h4: createHeadingComponent(4, () => document.headings[headingIndex++]),
    h5: createHeadingComponent(5, () => document.headings[headingIndex++]),
    h6: createHeadingComponent(6, () => document.headings[headingIndex++]),
    code({ className, children, ...props }) {
      const code = String(children).replace(/\n$/, "");
      const language = /language-(\w+)/.exec(className || "")?.[1];

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
          return <MermaidBlock code={code} documentId={document.id} index={index} />;
        }
      }

      return <pre>{children}</pre>;
    },
    table({ children }) {
      return (
        <div className="table-scroll">
          <table>{children}</table>
        </div>
      );
    },
    a({ children, href }) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
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

function stringifyReactNode(node: ReactNode): string {
  if (Array.isArray(node)) {
    return node.map(stringifyReactNode).join("");
  }
  return node === null || node === undefined || typeof node === "boolean" ? "" : String(node);
}

function createHeadingComponent(
  level: HeadingLevel,
  getHeading: () => ReviewDocument["headings"][number] | undefined
): NonNullable<Components["h1"]> {
  const tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

  return function HeadingComponent({ children }) {
    const heading = getHeading();
    return createElement(tag, { id: heading?.id, className: "document-heading" }, children);
  };
}
