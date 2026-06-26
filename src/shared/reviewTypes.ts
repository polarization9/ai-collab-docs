import type { Heading } from "./types.js";
import type {
  AgentConfiguredBy,
  AgentConfiguredVia,
  AgentProvider,
  AgentSessionRole
} from "./agentTypes.js";
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

export type AnchorPrecision = "exact" | "text" | "block" | "heading" | "unknown";

export type BlockFingerprint = {
  kind: string;
  textHash: string;
  normalizedText: string;
  headingId: string | null;
  headingText: string | null;
  previousTextHash?: string;
  nextTextHash?: string;
};

export type AnchorRepairMeta = {
  originalSelectedText?: string;
  markdownOffset?: number;
  blockFingerprint?: BlockFingerprint;
  anchorPrecision?: AnchorPrecision;
  repairConfidence?: number;
  repairReason?: string;
  lastRepairedAt?: string;
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
} & AnchorRepairMeta;

export type RangeReviewAnchor = {
  kind: "range";
  headingId: string | null;
  headingText: string | null;
  blockId: string;
  blockIndex: number;
  startBlockId: string;
  startBlockIndex: number;
  startOffset: number;
  endBlockId: string;
  endBlockIndex: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
} & AnchorRepairMeta;

export type BlockReviewAnchor = {
  kind: "block";
  headingId: string | null;
  headingText: string | null;
  blockId: string;
  blockIndex: number;
  selectedText: string;
} & AnchorRepairMeta;

export type MermaidReviewAnchor = {
  kind: "mermaid";
  headingId: string | null;
  headingText: string | null;
  mermaidIndex: number;
  selectedText: string;
} & AnchorRepairMeta;

export type DocumentReviewAnchor = {
  kind: "document";
  headingId: null;
  headingText: null;
  selectedText: "";
} & AnchorRepairMeta;

export type ReviewAnchor =
  | TextReviewAnchor
  | RangeReviewAnchor
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
export type ReviewEventType = "annotation_created" | "reply_followup";
export type ReviewEventDeliveryAdapter =
  | "codex-sdk"
  | "app-server"
  | "codex-exec-resume"
  | "future-thread-api"
  | "codex-app-server"
  | "claude-code-cli"
  | "workbuddy-codebuddy-cli"
  | "custom-cli";

export type ReviewEventAgentReference = {
  provider: AgentProvider;
  role?: AgentSessionRole;
  sessionId?: string;
  cwd?: string;
  displayName?: string;
  configuredAt?: string;
  configuredBy?: AgentConfiguredBy;
  configuredVia?: AgentConfiguredVia;
};

export type ReviewEvent = {
  id: string;
  type: ReviewEventType;
  documentPath: string;
  annotationId: string;
  triggerReplyId?: string;
  replyToReplyId?: string;
  sourceThreadId?: string;
  sourceCwd?: string;
  targetThreadId?: string;
  targetCwd?: string;
  targetType?: CodexTargetType;
  sourceAgent?: ReviewEventAgentReference;
  targetAgent?: ReviewEventAgentReference;
  deliveryMode: ReviewEventDeliveryMode;
  deliveryStatus: ReviewEventDeliveryStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  delivery?: {
    adapter?: ReviewEventDeliveryAdapter;
    provider?: AgentProvider;
    sessionId?: string;
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
  triggerReply?: ReviewReply;
  triggerReplyTarget?: ReviewReply;
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
  eventId?: string;
  resolveAnnotation?: boolean;
};

export type UpdateAnnotationRequest = {
  body: string;
};

export type UpdateReplyRequest = {
  body: string;
};

export type UpdateAnnotationStatusRequest = {
  status: AnnotationStatus;
  eventId?: string;
};

export type CreateReviewEventRequest = {
  annotationId: string;
  deliveryMode: ReviewEventDeliveryMode;
  triggerReplyId?: string;
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
