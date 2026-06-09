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

export type DocumentMergeConflict = {
  id: string;
  blockKind: string;
  headingText: string | null;
  baseSnippet: string;
  draftSnippet: string;
  externalSnippet: string;
};

export type DocumentMergeStatusRequest = {
  baseContent: string;
  baseContentHash: string;
  draftContent: string;
};

export type DocumentMergeStatusResponse =
  | {
      status: "unchanged";
      externalContentHash: string;
    }
  | {
      status: "externalOnly";
      externalContent: string;
      externalContentHash: string;
    }
  | {
      status: "merged";
      mergedContent: string;
      externalContent: string;
      externalContentHash: string;
    }
  | {
      status: "conflict";
      externalContent: string;
      externalContentHash: string;
      conflicts: DocumentMergeConflict[];
    };
