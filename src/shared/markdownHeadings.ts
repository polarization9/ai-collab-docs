import GithubSlugger from "github-slugger";
import type { Heading, HeadingLevel } from "./types.js";

export type HeadingLocation = Heading & {
  line: number;
  offset: number;
  lineText: string;
};

type FenceState = {
  marker: "`" | "~";
  length: number;
} | null;

export function parseHeadings(markdown: string): Heading[] {
  return parseHeadingLocations(markdown).map(({ id, level, text }) => ({ id, level, text }));
}

export function parseHeadingLocations(markdown: string): HeadingLocation[] {
  const slugger = new GithubSlugger();
  const headings: HeadingLocation[] = [];
  let fence: FenceState = null;
  let offset = 0;
  let lineIndex = 0;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      const length = fenceMatch[1].length;

      if (!fence) {
        fence = { marker, length };
        offset += rawLine.length + 1;
        lineIndex += 1;
        continue;
      }

      if (fence.marker === marker && length >= fence.length) {
        fence = null;
      }
      offset += rawLine.length + 1;
      lineIndex += 1;
      continue;
    }

    if (fence) {
      offset += rawLine.length + 1;
      lineIndex += 1;
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      offset += rawLine.length + 1;
      lineIndex += 1;
      continue;
    }

    const level = headingMatch[1].length as HeadingLevel;
    const text = normalizeHeadingText(headingMatch[2]);
    if (!text) {
      continue;
    }

    headings.push({
      id: slugger.slug(text),
      level,
      text,
      line: lineIndex,
      offset,
      lineText: line
    });

    offset += rawLine.length + 1;
    lineIndex += 1;
  }

  return headings;
}

export function normalizeHeadingText(raw: string): string {
  return raw.replace(/\s+#+\s*$/, "").trim();
}
