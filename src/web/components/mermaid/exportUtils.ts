import type { PngExportOptions } from "./types";
import { cloneSvgWithStyles, getSvgDimensions, serializeSvg } from "./svgUtils";
import { copyText } from "../../utils/clipboard";

const MAX_CANVAS_PIXELS = 16_000_000;

export async function copyMermaidSource(code: string): Promise<void> {
  await copyText(code);
}

export async function copyPng(svg: SVGSVGElement, options: PngExportOptions): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("PNG clipboard is not supported by this browser.");
  }

  const pngBlob = rasterizeSvgToCanvas(svg, options.scale, options.background).then(
    async (canvas) => {
      try {
        return await canvasToPngBlob(canvas);
      } finally {
        releaseCanvas(canvas);
      }
    }
  );

  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

export async function downloadPng(
  svg: SVGSVGElement,
  options: PngExportOptions,
  filename = "mermaid-diagram.png"
): Promise<void> {
  const canvas = await rasterizeSvgToCanvas(svg, options.scale, options.background);
  const blob = await canvasToPngBlob(canvas);
  releaseCanvas(canvas);
  downloadBlob(blob, filename);
}

export async function rasterizeSvgToCanvas(
  svg: SVGSVGElement,
  requestedScale: number,
  background: PngExportOptions["background"]
): Promise<HTMLCanvasElement> {
  const dimensions = getSvgDimensions(svg);
  let scale = requestedScale;
  while (
    scale > 1 &&
    Math.ceil(dimensions.width * scale) * Math.ceil(dimensions.height * scale) >
      MAX_CANVAS_PIXELS
  ) {
    scale -= 0.5;
  }

  scale = Math.max(1, scale);
  const width = Math.ceil(dimensions.width * scale);
  const height = Math.ceil(dimensions.height * scale);
  const clone = cloneSvgWithStyles(svg);
  clone.removeAttribute("style");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const image = await loadSvgImage(serializeSvg(clone));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create canvas context.");
  }

  if (background === "white") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  } else if (background === "dark") {
    context.fillStyle = "#151817";
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);
  image.src = "";
  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Unable to create PNG."));
      }
    }, "image/png");
  });
}

function loadSvgImage(svgString: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load SVG for export."));
    };
    image.src = url;
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
