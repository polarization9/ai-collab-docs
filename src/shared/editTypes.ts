import type { ReviewFile } from "./reviewTypes.js";
import type { ReviewDocument } from "./types.js";

export type AnchorRepairResult = "exact" | "fuzzy" | "headingFallback" | "unresolved";

export type AnchorRepairSummary = {
  total: number;
  exact: number;
  fuzzy: number;
  headingFallback: number;
  unresolved: number;
  items: Array<{
    annotationId: string;
    result: AnchorRepairResult;
  }>;
};

export type SaveDocumentRequest = {
  content: string;
  baseContentHash: string;
};

export type SaveDocumentResponse = {
  document: ReviewDocument;
  review: ReviewFile;
  repairedAnnotations: AnchorRepairSummary;
};

export type ApplyDocumentEditRequest = SaveDocumentRequest & {
  annotationId?: string;
  preferredSelectedText?: string;
  replyBody?: string;
  resolveAnnotation?: boolean;
};
