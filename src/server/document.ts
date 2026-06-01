import fs from "node:fs/promises";
import GithubSlugger from "github-slugger";
import type { Heading, HeadingLevel, ReviewDocument } from "../shared/types.js";
import { getDisplayRelativePath, getDocumentId, getReviewPath } from "./paths.js";

type FenceState = {
  marker: "`" | "~";
  length: number;
} | null;

export async function loadReviewDocument(
  absolutePath: string,
  cwd = process.cwd()
): Promise<ReviewDocument> {
  const content = await fs.readFile(absolutePath, "utf8");

  return {
    id: getDocumentId(absolutePath),
    absolutePath,
    relativePath: getDisplayRelativePath(absolutePath, cwd),
    reviewPath: getReviewPath(absolutePath),
    content,
    headings: parseHeadings(content)
  };
}

export function parseHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let fence: FenceState = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      const length = fenceMatch[1].length;

      if (!fence) {
        fence = { marker, length };
        continue;
      }

      if (fence.marker === marker && length >= fence.length) {
        fence = null;
      }
      continue;
    }

    if (fence) {
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
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
      text
    });
  }

  return headings;
}

function normalizeHeadingText(raw: string): string {
  return raw.replace(/\s+#+\s*$/, "").trim();
}
