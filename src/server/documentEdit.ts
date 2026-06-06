import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { SaveDocumentRequest, SaveDocumentResponse } from "../shared/editTypes.js";
import { createContentHash, loadReviewDocument } from "./document.js";
import { loadReviewFile, saveReviewFile, withReviewFileMutation } from "./review.js";
import { repairReviewAnchors } from "./reviewAnchorRepair.js";

export type SaveReviewDocumentOptions = {
  annotationId?: string;
  preferredSelectedText?: string;
};

const documentSaveQueues = new Map<string, Promise<unknown>>();

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

  return withDocumentSave(markdownPath, async () => {
    const currentContent = await fs.readFile(markdownPath, "utf8");
    const currentHash = createContentHash(currentContent);
    if (currentHash !== request.baseContentHash) {
      throw new DocumentConflictError();
    }

    await writeFileAtomically(markdownPath, request.content);

    const [document, repairResult] = await Promise.all([
      loadReviewDocument(markdownPath),
      withReviewFileMutation(markdownPath, async () => {
        const review = await loadReviewFile(markdownPath);
        const repaired = repairReviewAnchors(review, currentContent, request.content, options);
        const savedReview =
          repaired.review.annotations.length > 0
            ? await saveReviewFile(markdownPath, repaired.review)
            : repaired.review;
        return { savedReview, repaired };
      })
    ]);

    return {
      document,
      review: repairResult.savedReview,
      repairedAnnotations: repairResult.repaired.summary
    };
  });
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );

  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function withDocumentSave<T>(
  markdownPath: string,
  save: () => Promise<T>
): Promise<T> {
  const queueKey = path.resolve(markdownPath);
  const previous = documentSaveQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(save);
  const queued = next.catch(() => undefined).then(() => {
    if (documentSaveQueues.get(queueKey) === queued) {
      documentSaveQueues.delete(queueKey);
    }
  });
  documentSaveQueues.set(queueKey, queued);
  return next;
}

export class DocumentConflictError extends Error {
  constructor() {
    super("Document was changed outside Margent. Reload before saving.");
    this.name = "DocumentConflictError";
  }
}
