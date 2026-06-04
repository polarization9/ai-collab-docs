import type { Heading } from "./types.js";
import type { CodexTargetType } from "./codexTypes.js";

export type AnnotationStatus = "open" | "resolved";

export type ReviewAuthor = {
  type: "user" | "agent";
  name: string;
};

export type ReviewReply = {
  id: string;
  author: ReviewAuthor;
  body: string;
  replyTo?: ReviewReplyTarget;
  createdAt: string;
  updatedAt?: string;
};

export type ReviewReplyTarget = {
  replyId: string;
  authorName: string;
  authorType: ReviewAuthor["type"];
};

export type TextReviewAnchor = {
  kind: "text";
  headingId: string | null;
  headingText: string | null;
  blockId: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
};

export type BlockReviewAnchor = {
  kind: "block";
  headingId: string | null;
  headingText: string | null;
  blockId: string;
  blockIndex: number;
  selectedText: string;
};

export type MermaidReviewAnchor = {
  kind: "mermaid";
  headingId: string | null;
  headingText: string | null;
  mermaidIndex: number;
  selectedText: string;
};

export type DocumentReviewAnchor = {
  kind: "document";
  headingId: null;
  headingText: null;
  selectedText: "";
};

export type ReviewAnchor =
  | TextReviewAnchor
  | BlockReviewAnchor
  | MermaidReviewAnchor
  | DocumentReviewAnchor;

export type ReviewAnnotation = {
  id: string;
  status: AnnotationStatus;
  author: ReviewAuthor;
  body: string;
  anchor: ReviewAnchor;
  replies: ReviewReply[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type ReviewEventDeliveryStatus =
  | "ignored"
  | "queued"
  | "delivering"
  | "sent"
  | "processing"
  | "handled"
  | "failed";

export type ReviewEventDeliveryMode = "manual" | "auto";

export type ReviewEvent = {
  id: string;
  type: "annotation_created";
  documentPath: string;
  annotationId: string;
  sourceThreadId?: string;
  targetThreadId?: string;
  targetType?: CodexTargetType;
  deliveryMode: ReviewEventDeliveryMode;
  deliveryStatus: ReviewEventDeliveryStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  delivery?: {
    adapter?: "codex-sdk" | "app-server" | "codex-exec-resume" | "future-thread-api";
    threadId?: string;
    turnId?: string;
    deliveryId?: string;
    lastAttemptAt?: string;
  };
};

export type ReviewFile = {
  version: 1;
  documentPath: string;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  annotations: ReviewAnnotation[];
  events?: ReviewEvent[];
};

export type AnnotationContext = {
  annotation: ReviewAnnotation;
  selectedText: string;
  heading: Heading | null;
  beforeMarkdown: string;
  afterMarkdown: string;
  relatedMarkdown: string;
  replies: ReviewReply[];
};

export type CreateAnnotationRequest = {
  body: string;
  anchor: ReviewAnchor;
  author?: ReviewAuthor;
};

export type AddReplyRequest = {
  author?: ReviewAuthor;
  body: string;
  replyToReplyId?: string;
};

export type UpdateAnnotationRequest = {
  body: string;
};

export type UpdateReplyRequest = {
  body: string;
};

export type UpdateAnnotationStatusRequest = {
  status: AnnotationStatus;
};

export type CreateReviewEventRequest = {
  annotationId: string;
  deliveryMode: ReviewEventDeliveryMode;
};

export type UpdateReviewEventRequest = {
  deliveryStatus?: ReviewEventDeliveryStatus;
  lastError?: string;
  delivery?: ReviewEvent["delivery"];
};

export type ReviewEventFilter = {
  status?: ReviewEventDeliveryStatus;
  annotationId?: string;
};

export type BridgeSendAnnotationResponse = {
  ok: boolean;
  event?: ReviewEvent;
  review: ReviewFile;
  needsBinding?: boolean;
  error?: string;
};
