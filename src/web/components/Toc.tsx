import { PanelLeftClose } from "lucide-react";
import type { Heading } from "../../shared/types";
import { useI18n } from "../i18n";

type TocProps = {
  headings: Heading[];
  activeId?: string;
  onCollapse: () => void;
};

export function Toc({ headings, activeId, onCollapse }: TocProps) {
  const { t } = useI18n();

  return (
    <aside className="toc-pane">
      <div className="toc-header">
        <div className="toc-title">{t("toc.title")}</div>
        <button
          type="button"
          className="toc-toggle-button"
          aria-label={t("toc.collapse")}
          title={t("toc.collapse")}
          onClick={onCollapse}
        >
          <PanelLeftClose size={17} />
        </button>
      </div>
      <nav aria-label={t("toc.title")}>
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
