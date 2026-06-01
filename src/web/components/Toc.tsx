import type { Heading } from "../../shared/types";

type TocProps = {
  headings: Heading[];
  activeId?: string;
};

export function Toc({ headings, activeId }: TocProps) {
  return (
    <aside className="toc-pane">
      <div className="toc-title">Contents</div>
      <nav aria-label="Document table of contents">
        {headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            className={`toc-item toc-level-${heading.level} ${
              heading.id === activeId ? "toc-item-active" : ""
            }`}
            onClick={() => scrollToHeading(heading.id)}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function scrollToHeading(id: string): void {
  document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}
