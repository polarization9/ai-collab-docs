import { PanelLeftClose } from "lucide-react";
import type { Heading } from "../../shared/types";

type TocProps = {
  headings: Heading[];
  activeId?: string;
  onCollapse: () => void;
};

export function Toc({ headings, activeId, onCollapse }: TocProps) {
  return (
    <aside className="toc-pane">
      <div className="toc-header">
        <div className="toc-title">Contents</div>
        <button
          type="button"
          className="toc-toggle-button"
          aria-label="收起目录"
          title="收起目录"
          onClick={onCollapse}
        >
          <PanelLeftClose size={17} />
        </button>
      </div>
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
