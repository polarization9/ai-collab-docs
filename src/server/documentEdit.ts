import fs from "node:fs/promises";
import path from "node:path";
import type { SaveDocumentRequest, SaveDocumentResponse } from "../shared/editTypes.js";
import { createContentHash, loadReviewDocument } from "./document.js";
import { loadReviewFile, saveReviewFile } from "./review.js";
import { repairReviewAnchors } from "./reviewAnchorRepair.js";

export type SaveReviewDocumentOptions = {
  annotationId?: string;
  preferredSelectedText?: string;
};

export async function saveReviewDocument(
  markdownPath: string,
  request: SaveDocumentRequest,
  options: SaveReviewDocumentOptions = {}
): Promise<SaveDocumentResponse> {
  if (typeof request.content !== "string") {
    throw new Error("Document content is required.");
  }
  if (typeof request.baseContentHash !== "string" || !request.baseContentHash) {
    throw new Error("baseContentHash is required.");
  }

  const currentContent = await fs.readFile(markdownPath, "utf8");
  const currentHash = createContentHash(currentContent);
  if (currentHash !== request.baseContentHash) {
    throw new DocumentConflictError();
  }

  await writeFileAtomically(markdownPath, request.content);

  const [document, review] = await Promise.all([
    loadReviewDocument(markdownPath),
    loadReviewFile(markdownPath)
  ]);
  const repaired = repairReviewAnchors(review, currentContent, request.content, options);
  const savedReview =
    repaired.review.annotations.length > 0
      ? await saveReviewFile(markdownPath, repaired.review)
      : repaired.review;

  return {
    document,
    review: savedReview,
    repairedAnnotations: repaired.summary
  };
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`
  );

  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}

export class DocumentConflictError extends Error {
  constructor() {
    super("Document was changed outside Margent. Reload before saving.");
    this.name = "DocumentConflictError";
  }
}
