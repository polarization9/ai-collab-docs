import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentSessionReference } from "../shared/agentTypes.js";
import type {
  AddReplyRequest,
  AnnotationStatus,
  CreateReviewEventRequest,
  CreateAnnotationRequest,
  ReviewAnchor,
  ReviewAnnotation,
  ReviewAuthor,
  ReviewEvent,
  ReviewEventDeliveryStatus,
  ReviewEventFilter,
  ReviewFile,
  ReviewReply,
  UpdateAnnotationRequest,
  UpdateAnnotationStatusRequest,
  UpdateReviewEventRequest,
  UpdateReplyRequest
} from "../shared/reviewTypes.js";
import { loadAgentDocumentLink, resolveAgentTarget } from "./agentLink.js";
import { getDocumentId, getReviewPath } from "./paths.js";

const REVIEW_VERSION = 1;
const DEFAULT_USER_AUTHOR: ReviewAuthor = { type: "user", name: "User" };
const DEFAULT_AGENT_AUTHOR: ReviewAuthor = { type: "agent", name: "Codex" };
const ACTIVE_EVENT_STATUSES = new Set<ReviewEventDeliveryStatus>([
  "delivering",
  "sent",
  "processing"
]);
const STALE_DELIVERING_EVENT_MS = 120000;
const OPEN_EVENT_STATUSES = new Set<ReviewEventDeliveryStatus>([
  "queued",
  "delivering",
  "sent",
  "processing"
]);
const reviewMutationQueues = new Map<string, Promise<unknown>>();

export async function loadReviewFile(markdownPath: string): Promise<ReviewFile> {
  const reviewPath = getReviewPath(markdownPath);

  try {
    const raw = await fs.readFile(reviewPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ReviewFile>;
    return normalizeReviewFile(parsed, markdownPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return createEmptyReview(markdownPath);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Review file is not valid JSON: ${reviewPath}`);
    }
    throw error;
  }
}

export async function saveReviewFile(markdownPath: string, review: ReviewFile): Promise<ReviewFile> {
  const normalized = normalizeReviewFile(review, markdownPath);
  const reviewPath = getReviewPath(markdownPath);
  const temporaryPath = `${reviewPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

  await fs.writeFile(temporaryPath, serialized, "utf8");
  await fs.rename(temporaryPath, reviewPath);
  return normalized;
}

export async function replaceReviewFile(
  markdownPath: string,
  review: ReviewFile
): Promise<ReviewFile> {
  return withReviewFileMutation(markdownPath, () => saveReviewFile(markdownPath, review));
}

export function withReviewFileMutation<T>(
  markdownPath: string,
  mutation: () => Promise<T>
): Promise<T> {
  return withReviewMutation(markdownPath, mutation);
}

export async function createAnnotation(
  markdownPath: string,
  request: CreateAnnotationRequest
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const body = request.body.trim();
    if (!body) {
      throw new Error("Annotation body is required.");
    }

    const review = await loadReviewFile(markdownPath);
    const now = new Date().toISOString();
    const annotation: ReviewAnnotation = {
      id: createId("ann"),
      status: "open",
      author: request.author ?? DEFAULT_USER_AUTHOR,
      body,
      anchor: prepareAnchorForCreate(request.anchor),
      replies: [],
      createdAt: now,
      updatedAt: now
    };

    review.annotations.push(annotation);
    review.updatedAt = now;
    return saveReviewFile(markdownPath, review);
  });
}

export async function addAnnotationReply(
  markdownPath: string,
  annotationId: string,
  request: AddReplyRequest
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const body = request.body.trim();
    if (!body) {
      throw new Error("Reply body is required.");
    }

    const review = await loadReviewFile(markdownPath);
    const annotation = findAnnotation(review, annotationId);
    const replyTo = request.replyToReplyId
      ? createReplyTarget(findReply(annotation, request.replyToReplyId))
      : undefined;
    const now = new Date().toISOString();
    const reply: ReviewReply = {
      id: createId("reply"),
      author: request.author ?? DEFAULT_AGENT_AUTHOR,
      body,
      ...(replyTo ? { replyTo } : {}),
      createdAt: now
    };

    annotation.replies.push(reply);
    annotation.updatedAt = now;
    review.updatedAt = now;
    return saveReviewFile(markdownPath, review);
  });
}

export async function updateAnnotation(
  markdownPath: string,
  annotationId: string,
  request: UpdateAnnotationRequest
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const body = request.body.trim();
    if (!body) {
      throw new Error("Annotation body is required.");
    }

    const review = await loadReviewFile(markdownPath);
    const annotation = findAnnotation(review, annotationId);
    const now = new Date().toISOString();

    annotation.body = body;
    annotation.updatedAt = now;
    review.updatedAt = now;
    return saveReviewFile(markdownPath, review);
  });
}

export async function deleteAnnotation(
  markdownPath: string,
  annotationId: string
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const review = await loadReviewFile(markdownPath);
    const index = review.annotations.findIndex((item) => item.id === annotationId);
    if (index === -1) {
      throw new AnnotationNotFoundError(annotationId);
    }

    markOpenAnnotationEventsIgnored(review, annotationId);
    review.annotations.splice(index, 1);
    review.updatedAt = new Date().toISOString();
    return saveReviewFile(markdownPath, review);
  });
}

export async function updateAnnotationReply(
  markdownPath: string,
  annotationId: string,
  replyId: string,
  request: UpdateReplyRequest
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const body = request.body.trim();
    if (!body) {
      throw new Error("Reply body is required.");
    }

    const review = await loadReviewFile(markdownPath);
    const annotation = findAnnotation(review, annotationId);
    const reply = findReply(annotation, replyId);
    const now = new Date().toISOString();

    reply.body = body;
    reply.updatedAt = now;
    annotation.updatedAt = now;
    review.updatedAt = now;
    return saveReviewFile(markdownPath, review);
  });
}

export async function updateAnnotationStatus(
  markdownPath: string,
  annotationId: string,
  request: UpdateAnnotationStatusRequest
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    assertAnnotationStatus(request.status);

    const review = await loadReviewFile(markdownPath);
    const annotation = findAnnotation(review, annotationId);
    const now = new Date().toISOString();

    annotation.status = request.status;
    annotation.updatedAt = now;
    if (request.status === "resolved") {
      annotation.resolvedAt = now;
      if (request.eventId) {
        markAnnotationEventHandled(review, annotationId, request.eventId, now);
      }
      markOpenAnnotationEventsIgnored(review, annotationId, ["queued"], request.eventId);
    } else {
      delete annotation.resolvedAt;
    }
    review.updatedAt = now;
    return saveReviewFile(markdownPath, review);
  });
}

export async function createReviewEvent(
  markdownPath: string,
  request: CreateReviewEventRequest
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const review = await loadReviewFile(markdownPath);
    const annotation = findAnnotation(review, request.annotationId);
    const triggerReply = request.triggerReplyId
      ? findReply(annotation, request.triggerReplyId)
      : undefined;
    const link = await loadAgentDocumentLink(markdownPath);
    const target = resolveAgentTarget(link);
    const now = new Date().toISOString();
    const event: ReviewEvent = {
      id: createId("evt"),
      type: triggerReply ? "reply_followup" : "annotation_created",
      documentPath: markdownPath,
      annotationId: request.annotationId,
      ...(triggerReply ? { triggerReplyId: triggerReply.id } : {}),
      ...(triggerReply?.replyTo?.replyId ? { replyToReplyId: triggerReply.replyTo.replyId } : {}),
      sourceAgent: link?.source ? toReviewEventAgentRef(link.source) : undefined,
      targetAgent: target ? toReviewEventAgentRef(target) : undefined,
      sourceThreadId: link?.source?.provider === "codex" ? link.source.sessionId : undefined,
      sourceCwd: link?.source?.provider === "codex" ? link.source.cwd : undefined,
      targetThreadId: target?.provider === "codex" ? target.sessionId : undefined,
      targetCwd: target?.provider === "codex" ? target.cwd : undefined,
      targetType: target?.provider === "codex" ? target.role : undefined,
      deliveryMode: request.deliveryMode,
      deliveryStatus: "queued",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now
    };

    review.events = [...(review.events ?? []), event];
    review.updatedAt = now;
    return saveReviewFile(markdownPath, review);
  });
}

function toReviewEventAgentRef(session: AgentSessionReference): ReviewEvent["targetAgent"] {
  return {
    provider: session.provider,
    role: session.role,
    sessionId: session.sessionId,
    cwd: session.cwd,
    displayName: session.displayName,
    configuredAt: session.configuredAt,
    configuredBy: session.configuredBy,
    configuredVia: session.configuredVia
  };
}

export async function listReviewEvents(
  markdownPath: string,
  filter: ReviewEventFilter = {}
): Promise<ReviewEvent[]> {
  const review = await loadReviewFile(markdownPath);
  return (review.events ?? []).filter((event) => {
    if (filter.status && event.deliveryStatus !== filter.status) {
      return false;
    }
    if (filter.annotationId && event.annotationId !== filter.annotationId) {
      return false;
    }
    return true;
  });
}

export async function getReviewEvent(
  markdownPath: string,
  eventId: string
): Promise<ReviewEvent> {
  const review = await loadReviewFile(markdownPath);
  return findReviewEvent(review, eventId);
}

export async function updateReviewEvent(
  markdownPath: string,
  eventId: string,
  request: UpdateReviewEventRequest
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const review = await loadReviewFile(markdownPath);
    const event = findReviewEvent(review, eventId);
    applyEventUpdate(event, request);
    review.updatedAt = event.updatedAt;
    return saveReviewFile(markdownPath, review);
  });
}

export async function markReviewEventDelivering(
  markdownPath: string,
  eventId: string,
  adapter?: NonNullable<ReviewEvent["delivery"]>["adapter"]
): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const review = await loadReviewFile(markdownPath);
    const event = findReviewEvent(review, eventId);
    const now = new Date().toISOString();
    event.deliveryStatus = "delivering";
    event.attemptCount += 1;
    event.updatedAt = now;
    event.lastError = undefined;
    event.delivery = {
      ...event.delivery,
      adapter,
      lastAttemptAt: now
    };
    review.updatedAt = now;
    return saveReviewFile(markdownPath, review);
  });
}

export async function recoverStaleDeliveringEvents(markdownPath: string): Promise<ReviewFile> {
  return withReviewMutation(markdownPath, async () => {
    const review = await loadReviewFile(markdownPath);
    const now = Date.now();
    const updatedAt = new Date(now).toISOString();
    let didChange = false;

    for (const event of review.events ?? []) {
      if (
        event.deliveryStatus !== "delivering" ||
        event.delivery?.turnId ||
        now - new Date(event.updatedAt).getTime() < STALE_DELIVERING_EVENT_MS
      ) {
        continue;
      }

      event.deliveryStatus = "queued";
      event.lastError = "Previous delivery attempt did not finish before the App restarted.";
      event.updatedAt = updatedAt;
      didChange = true;
    }

    if (!didChange) {
      return review;
    }

    review.updatedAt = updatedAt;
    return saveReviewFile(markdownPath, review);
  });
}

export async function markReviewEventHandled(
  markdownPath: string,
  eventId: string
): Promise<ReviewFile> {
  return updateReviewEvent(markdownPath, eventId, {
    deliveryStatus: "handled",
    lastError: undefined
  });
}

export async function hasActiveReviewEvent(markdownPath: string): Promise<boolean> {
  const review = await loadReviewFile(markdownPath);
  return (review.events ?? []).some((event) => ACTIVE_EVENT_STATUSES.has(event.deliveryStatus));
}

export async function findNextQueuedReviewEvent(
  markdownPath: string
): Promise<ReviewEvent | null> {
  const events = await listReviewEvents(markdownPath, { status: "queued" });
  return [...events].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )[0] ?? null;
}

export async function findLatestAnnotationEvent(
  markdownPath: string,
  annotationId: string
): Promise<ReviewEvent | null> {
  const events = await listReviewEvents(markdownPath, { annotationId });
  return [...events].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  )[0] ?? null;
}

export function createEmptyReview(markdownPath: string): ReviewFile {
  const now = new Date().toISOString();
  return {
    version: REVIEW_VERSION,
    documentPath: markdownPath,
    documentId: getDocumentId(markdownPath),
    createdAt: now,
    updatedAt: now,
    annotations: [],
    events: []
  };
}

function normalizeReviewFile(review: Partial<ReviewFile>, markdownPath: string): ReviewFile {
  if (review.version !== REVIEW_VERSION) {
    if (review.version === undefined && review.annotations === undefined) {
      return createEmptyReview(markdownPath);
    }
    throw new Error(`Unsupported review file version: ${String(review.version)}`);
  }

  const now = new Date().toISOString();
  return repairCompletedReviewEvents({
    version: REVIEW_VERSION,
    documentPath: markdownPath,
    documentId: getDocumentId(markdownPath),
    createdAt: review.createdAt ?? now,
    updatedAt: review.updatedAt ?? review.createdAt ?? now,
    annotations: Array.isArray(review.annotations) ? review.annotations : [],
    events: Array.isArray(review.events) ? review.events.map(normalizeReviewEvent) : []
  });
}

function repairCompletedReviewEvents(review: ReviewFile): ReviewFile {
  for (const event of review.events ?? []) {
    if (event.deliveryStatus === "handled" || event.deliveryStatus === "ignored") {
      continue;
    }

    const annotation = review.annotations.find((item) => item.id === event.annotationId);
    if (!annotation || !hasCompletionEvidenceForEvent(annotation, event)) {
      continue;
    }

    event.deliveryStatus = "handled";
    event.lastError = undefined;
    event.updatedAt = getCompletionEvidenceTime(annotation, event) ?? event.updatedAt;
  }

  return review;
}

function hasCompletionEvidenceForEvent(
  annotation: ReviewAnnotation,
  event: ReviewEvent
): boolean {
  const eventCreatedAt = parseReviewTime(event.createdAt);
  const resolvedAt = parseReviewTime(annotation.resolvedAt ?? annotation.updatedAt);
  if (annotation.status === "resolved" && resolvedAt >= eventCreatedAt) {
    return true;
  }

  return annotation.replies.some(
    (reply) =>
      reply.author.type === "agent" &&
      parseReviewTime(reply.createdAt) >= eventCreatedAt
  );
}

function getCompletionEvidenceTime(
  annotation: ReviewAnnotation,
  event: ReviewEvent
): string | undefined {
  const eventCreatedAt = parseReviewTime(event.createdAt);
  const evidenceTimes = [
    annotation.status === "resolved" ? annotation.resolvedAt ?? annotation.updatedAt : undefined,
    ...annotation.replies
      .filter(
        (reply) =>
          reply.author.type === "agent" &&
          parseReviewTime(reply.createdAt) >= eventCreatedAt
      )
      .map((reply) => reply.createdAt)
  ].filter((value): value is string => Boolean(value));

  return evidenceTimes.sort(
    (left, right) => parseReviewTime(right) - parseReviewTime(left)
  )[0];
}

function parseReviewTime(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function findAnnotation(review: ReviewFile, annotationId: string): ReviewAnnotation {
  const annotation = review.annotations.find((item) => item.id === annotationId);
  if (!annotation) {
    throw new AnnotationNotFoundError(annotationId);
  }
  return annotation;
}

function findReply(annotation: ReviewAnnotation, replyId: string): ReviewReply {
  const reply = annotation.replies.find((item) => item.id === replyId);
  if (!reply) {
    throw new ReplyNotFoundError(replyId);
  }
  return reply;
}

function findReviewEvent(review: ReviewFile, eventId: string): ReviewEvent {
  const event = (review.events ?? []).find((item) => item.id === eventId);
  if (!event) {
    throw new ReviewEventNotFoundError(eventId);
  }
  return event;
}

function applyEventUpdate(event: ReviewEvent, request: UpdateReviewEventRequest): void {
  if (request.deliveryStatus) {
    assertReviewEventStatus(request.deliveryStatus);
    event.deliveryStatus = request.deliveryStatus;
  }
  if (Object.prototype.hasOwnProperty.call(request, "lastError")) {
    event.lastError = request.lastError?.trim() || undefined;
  }
  if (request.delivery !== undefined) {
    event.delivery = request.delivery;
  }
  event.updatedAt = new Date().toISOString();
}

function normalizeReviewEvent(event: ReviewEvent): ReviewEvent {
  return {
    ...event,
    type: event.type === "reply_followup" ? "reply_followup" : "annotation_created",
    triggerReplyId:
      typeof event.triggerReplyId === "string" ? event.triggerReplyId : undefined,
    replyToReplyId:
      typeof event.replyToReplyId === "string" ? event.replyToReplyId : undefined,
    deliveryMode: event.deliveryMode === "auto" ? "auto" : "manual",
    deliveryStatus: isReviewEventStatus(event.deliveryStatus)
      ? event.deliveryStatus
      : "ignored",
    attemptCount: Number.isInteger(event.attemptCount) ? event.attemptCount : 0,
    createdAt: event.createdAt ?? new Date().toISOString(),
    updatedAt: event.updatedAt ?? event.createdAt ?? new Date().toISOString()
  };
}

function markOpenAnnotationEventsIgnored(
  review: ReviewFile,
  annotationId: string,
  statuses: ReviewEventDeliveryStatus[] = Array.from(OPEN_EVENT_STATUSES),
  excludeEventId?: string
): void {
  const statusSet = new Set(statuses);
  const now = new Date().toISOString();
  for (const event of review.events ?? []) {
    if (
      event.id !== excludeEventId &&
      event.annotationId === annotationId &&
      statusSet.has(event.deliveryStatus)
    ) {
      event.deliveryStatus = "ignored";
      event.updatedAt = now;
    }
  }
}

function markAnnotationEventHandled(
  review: ReviewFile,
  annotationId: string,
  eventId: string,
  now: string
): void {
  const event = findReviewEvent(review, eventId);
  if (event.annotationId !== annotationId) {
    throw new Error("Review event does not belong to this annotation.");
  }

  if (event.deliveryStatus === "handled") {
    event.lastError = undefined;
    event.updatedAt = now;
    return;
  }

  if (!OPEN_EVENT_STATUSES.has(event.deliveryStatus) && event.deliveryStatus !== "failed") {
    return;
  }

  event.deliveryStatus = "handled";
  event.updatedAt = now;
  event.lastError = undefined;
}

function createReplyTarget(reply: ReviewReply): ReviewReply["replyTo"] {
  return {
    replyId: reply.id,
    authorName: reply.author.name,
    authorType: reply.author.type
  };
}

function prepareAnchorForCreate(anchor: ReviewAnchor): ReviewAnchor {
  if (anchor.selectedText && !anchor.originalSelectedText) {
    anchor.originalSelectedText = anchor.selectedText;
  }

  if (!anchor.anchorPrecision) {
    anchor.anchorPrecision =
      anchor.kind === "text" || anchor.kind === "range"
        ? "exact"
        : anchor.kind === "document"
          ? "heading"
          : "block";
  }

  return anchor;
}

function assertAnnotationStatus(status: string): asserts status is AnnotationStatus {
  if (status !== "open" && status !== "resolved") {
    throw new Error("Annotation status must be open or resolved.");
  }
}

function assertReviewEventStatus(status: string): asserts status is ReviewEventDeliveryStatus {
  if (!isReviewEventStatus(status)) {
    throw new Error("Invalid review event status.");
  }
}

function isReviewEventStatus(status: string): status is ReviewEventDeliveryStatus {
  return (
    status === "ignored" ||
    status === "queued" ||
    status === "delivering" ||
    status === "sent" ||
    status === "processing" ||
    status === "handled" ||
    status === "failed"
  );
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function withReviewMutation<T>(
  markdownPath: string,
  mutation: () => Promise<T>
): Promise<T> {
  const queueKey = path.resolve(markdownPath);
  const previous = reviewMutationQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  const queued = next.catch(() => undefined).then(() => {
    if (reviewMutationQueues.get(queueKey) === queued) {
      reviewMutationQueues.delete(queueKey);
    }
  });
  reviewMutationQueues.set(queueKey, queued);
  return next;
}

export class AnnotationNotFoundError extends Error {
  constructor(annotationId: string) {
    super(`Annotation not found: ${annotationId}`);
    this.name = "AnnotationNotFoundError";
  }
}

export class ReviewEventNotFoundError extends Error {
  constructor(eventId: string) {
    super(`Review event not found: ${eventId}`);
    this.name = "ReviewEventNotFoundError";
  }
}

export class ReplyNotFoundError extends Error {
  constructor(replyId: string) {
    super(`Reply not found: ${replyId}`);
    this.name = "ReplyNotFoundError";
  }
}
