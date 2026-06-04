import crypto from "node:crypto";
import fs from "node:fs/promises";
import { parseHeadings } from "../shared/markdownHeadings.js";
import type { ReviewDocument } from "../shared/types.js";
import {
  getCodexLinkPath,
  getDisplayRelativePath,
  getDocumentId,
  getReviewPath
} from "./paths.js";

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
    codexLinkPath: getCodexLinkPath(absolutePath),
    content,
    contentHash: createContentHash(content),
    loadedAt: new Date().toISOString(),
    headings: parseHeadings(content)
  };
}

export function createContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
