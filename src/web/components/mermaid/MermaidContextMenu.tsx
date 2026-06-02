import {
  ClipboardCopy,
  FileImage,
  Image,
  Maximize2,
  Palette
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import type { MermaidActionHandlers } from "./types";

type MermaidContextMenuProps = {
  x: number;
  y: number;
  actions: MermaidActionHandlers;
  onClose: () => void;
};

export function MermaidContextMenu({ x, y, actions, onClose }: MermaidContextMenuProps) {
  useEffect(() => {
    const handlePointerDown = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const runAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      className="mermaid-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuButton label="打开大图" onClick={() => runAction(actions.openLightbox)}>
        <Maximize2 size={15} />
      </MenuButton>
      <MenuButton label="复制源码" onClick={() => runAction(actions.copySource)}>
        <ClipboardCopy size={15} />
      </MenuButton>
      <MenuButton label="复制 PNG" onClick={() => runAction(actions.copyPng)}>
        <FileImage size={15} />
      </MenuButton>
      <MenuButton label="导出 PNG" onClick={() => runAction(actions.exportPng)}>
        <Image size={15} />
      </MenuButton>
      <MenuButton label="切换主题" onClick={() => runAction(actions.toggleBackground)}>
        <Palette size={15} />
      </MenuButton>
    </div>
  );
}

function MenuButton({
  children,
  label,
  onClick
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
  );
}
