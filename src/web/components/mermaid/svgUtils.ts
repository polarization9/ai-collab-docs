import type { SvgViewBox } from "./types";

const DANGEROUS_TAGS = ["script", "iframe", "embed", "object", "meta", "link", "animate", "set"];
const STYLE_PROPS_TO_INLINE = [
  "fill",
  "stroke",
  "stroke-width",
  "font-family",
  "font-size",
  "font-weight",
  "opacity",
  "color",
  "background-color",
  "text-anchor"
];

export function parseViewBox(svg: SVGSVGElement): SvgViewBox | null {
  const attr = svg.getAttribute("viewBox");
  if (!attr) {
    return null;
  }

  const parts = attr.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN) || parts[2] <= 0 || parts[3] <= 0) {
    return null;
  }

  return {
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3]
  };
}

export function setViewBox(svg: SVGSVGElement, viewBox: SvgViewBox): void {
  svg.setAttribute(
    "viewBox",
    `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
  );
}

export function getSvgDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = parseViewBox(svg);
  if (viewBox) {
    return { width: viewBox.width, height: viewBox.height };
  }

  const width = parseSvgLength(svg.getAttribute("width"));
  const height = parseSvgLength(svg.getAttribute("height"));
  if (width > 0 && height > 0) {
    return { width, height };
  }

  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
  } catch {
    // Detached or hidden SVGs may not expose a bbox.
  }

  return { width: 800, height: 600 };
}

export function ensureViewBox(svg: SVGSVGElement): SvgViewBox {
  const existing = parseViewBox(svg);
  if (existing) {
    return existing;
  }

  const dimensions = getSvgDimensions(svg);
  const viewBox = {
    x: 0,
    y: 0,
    width: dimensions.width,
    height: dimensions.height
  };
  setViewBox(svg, viewBox);
  return viewBox;
}

export function applyAutoFit(svg: SVGSVGElement): void {
  ensureViewBox(svg);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.maxWidth = "100%";
}

export function cloneSvgWithStyles(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originalElements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const cloneElements = [clone, ...Array.from(clone.querySelectorAll("*"))] as SVGElement[];

  for (let index = 0; index < originalElements.length; index += 1) {
    const original = originalElements[index];
    const cloned = cloneElements[index];
    if (!cloned) {
      continue;
    }

    const computed = window.getComputedStyle(original);
    for (const prop of STYLE_PROPS_TO_INLINE) {
      const value = computed.getPropertyValue(prop);
      if (value) {
        cloned.style.setProperty(prop, value);
      }
    }
  }

  sanitizeSvg(clone);
  ensureViewBox(clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

export function sanitizeSvg(svg: SVGSVGElement): void {
  for (const tag of DANGEROUS_TAGS) {
    for (const element of Array.from(svg.querySelectorAll(tag))) {
      element.remove();
    }
  }

  for (const foreignObject of Array.from(svg.querySelectorAll("foreignObject"))) {
    const dangerous = foreignObject.querySelectorAll(
      "script, iframe, embed, object, form, input, textarea, button, a[href]"
    );
    for (const element of Array.from(dangerous)) {
      element.remove();
    }
  }

  for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
      }
      if ((name === "href" || name === "xlink:href") && /^\s*javascript\s*:/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    }
  }
}

export function serializeSvg(svg: SVGSVGElement): string {
  const clone = cloneSvgWithStyles(svg);
  return new XMLSerializer().serializeToString(clone);
}

export function createSvgElementFromString(svgString: string): SVGSVGElement | null {
  const template = document.createElement("template");
  template.innerHTML = svgString.trim();
  const svg = template.content.querySelector("svg");
  return svg instanceof SVGSVGElement ? svg : null;
}

function parseSvgLength(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
