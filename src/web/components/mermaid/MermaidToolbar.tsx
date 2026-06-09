import {
  Code2,
  ClipboardCopy,
  FileImage,
  Image,
  Maximize2,
  Palette
} from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import type { MermaidActionHandlers, MermaidBackground } from "./types";

type MermaidToolbarProps = {
  actions: MermaidActionHandlers;
  background: MermaidBackground;
};

export function MermaidToolbar({ actions, background }: MermaidToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="mermaid-toolbar" aria-label={t("mermaid.toolbar")}>
      <ToolbarButton label={t("mermaid.openLightbox")} onClick={actions.openLightbox}>
        <Maximize2 size={15} />
      </ToolbarButton>
      <ToolbarButton label={t("mermaid.showSource")} onClick={actions.showSource}>
        <Code2 size={15} />
      </ToolbarButton>
      <ToolbarButton label={t("mermaid.copySource")} onClick={actions.copySource}>
        <ClipboardCopy size={15} />
      </ToolbarButton>
      <ToolbarButton label={t("mermaid.copyPng")} onClick={actions.copyPng}>
        <FileImage size={15} />
      </ToolbarButton>
      <ToolbarButton label={t("mermaid.exportPng")} onClick={actions.exportPng}>
        <Image size={15} />
      </ToolbarButton>
      <ToolbarButton
        label={background === "light" ? t("mermaid.switchDark") : t("mermaid.switchLight")}
        onClick={actions.toggleBackground}
      >
        <Palette size={15} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  label,
  onClick
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mermaid-tool-button"
      aria-label={label}
      data-tooltip={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
