export type MermaidBackground = "light" | "dark";

export type MermaidThemeKey = MermaidBackground;

export type MermaidRenderState =
  | { status: "rendering" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

export type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PngExportOptions = {
  scale: 1 | 2 | 3;
  background: "transparent" | "white" | "dark";
};

export type MermaidActionHandlers = {
  openLightbox: () => void;
  showSource: () => void;
  copySource: () => void;
  copyPng: () => void;
  exportPng: () => void;
  toggleBackground: () => void;
};
