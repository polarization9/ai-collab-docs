import {
  Code2,
  ClipboardCopy,
  FileImage,
  Image,
  Maximize2,
  Palette
} from "lucide-react";
import type { ReactNode } from "react";
import type { MermaidActionHandlers, MermaidBackground } from "./types";

type MermaidToolbarProps = {
  actions: MermaidActionHandlers;
  background: MermaidBackground;
};

export function MermaidToolbar({ actions, background }: MermaidToolbarProps) {
  return (
    <div className="mermaid-toolbar" aria-label="Mermaid diagram tools">
      <ToolbarButton label="打开大图" onClick={actions.openLightbox}>
        <Maximize2 size={15} />
      </ToolbarButton>
      <ToolbarButton label="查看源码" onClick={actions.showSource}>
        <Code2 size={15} />
      </ToolbarButton>
      <ToolbarButton label="复制源码" onClick={actions.copySource}>
        <ClipboardCopy size={15} />
      </ToolbarButton>
      <ToolbarButton label="复制 PNG" onClick={actions.copyPng}>
        <FileImage size={15} />
      </ToolbarButton>
      <ToolbarButton label="导出 PNG" onClick={actions.exportPng}>
        <Image size={15} />
      </ToolbarButton>
      <ToolbarButton
        label={background === "light" ? "切换为暗色" : "切换为亮色"}
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
