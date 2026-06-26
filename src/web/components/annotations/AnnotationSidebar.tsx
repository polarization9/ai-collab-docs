import {
  AtSign,
  Check,
  CheckCircle2,
  CircleDot,
  Link2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Reply,
  RotateCcw,
  Send,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AgentLinkResponse, AgentProvider } from "../../../shared/agentTypes";
import type {
  AddReplyRequest,
  AnnotationStatus,
  ReviewAnnotation,
  ReviewEvent,
  ReviewEventDeliveryStatus,
  ReviewReply,
  UpdateAnnotationRequest,
  UpdateReplyRequest
} from "../../../shared/reviewTypes";
import { useI18n, type LocaleKey } from "../../i18n";

type AnnotationFilter = "all" | AnnotationStatus;

type AnnotationSidebarProps = {
  annotations: ReviewAnnotation[];
  events: ReviewEvent[];
  pendingAnnotationIds?: string[];
  agentLink: AgentLinkResponse | null;
  agentLinkError?: string | null;
  selectedAnnotationId: string | null;
  isLoading: boolean;
  error?: string;
  onSelect: (annotationId: string) => void;
  onToggleSelect: (annotationId: string) => void;
  onReply: (annotationId: string, request: AddReplyRequest) => Promise<void>;
  onEditAnnotation: (
    annotationId: string,
    request: UpdateAnnotationRequest
  ) => Promise<void>;
  onDeleteAnnotation: (annotationId: string) => Promise<void>;
  onEditReply: (
    annotationId: string,
    replyId: string,
    request: UpdateReplyRequest
  ) => Promise<void>;
  onStatusChange: (annotationId: string, status: AnnotationStatus, eventId?: string) => Promise<void>;
  onCreateDocumentAnnotation: (body: string) => Promise<void>;
  onToggleAutoMonitor: (enabled: boolean) => Promise<void>;
  onCopySuccessorInstruction: () => Promise<void>;
  onSendToAgent: (annotationId: string) => Promise<void>;
  onRetryReviewEvent: (eventId: string) => Promise<void>;
  onReload: () => void;
};

export function AnnotationSidebar({
  annotations,
  events,
  pendingAnnotationIds = [],
  agentLink,
  agentLinkError,
  selectedAnnotationId,
  isLoading,
  error,
  onSelect,
  onToggleSelect,
  onReply,
  onEditAnnotation,
  onDeleteAnnotation,
  onEditReply,
  onStatusChange,
  onCreateDocumentAnnotation,
  onToggleAutoMonitor,
  onCopySuccessorInstruction,
  onSendToAgent,
  onRetryReviewEvent,
  onReload
}: AnnotationSidebarProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<AnnotationFilter>("all");
  const [isDocumentComposerOpen, setIsDocumentComposerOpen] = useState(false);
  const [documentAnnotationDraft, setDocumentAnnotationDraft] = useState("");
  const [isCreatingDocumentAnnotation, setIsCreatingDocumentAnnotation] = useState(false);
  const [documentAnnotationError, setDocumentAnnotationError] = useState<string | null>(null);
  const filteredAnnotations = useMemo(
    () =>
      annotations.filter((annotation) => filter === "all" || annotation.status === filter),
    [annotations, filter]
  );

  const submitDocumentAnnotation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = documentAnnotationDraft.trim();
    if (!body || isCreatingDocumentAnnotation) {
      return;
    }

    setIsCreatingDocumentAnnotation(true);
    setDocumentAnnotationError(null);
    try {
      await onCreateDocumentAnnotation(body);
      setDocumentAnnotationDraft("");
      setIsDocumentComposerOpen(false);
      setFilter("all");
    } catch (error) {
      setDocumentAnnotationError(error instanceof Error ? error.message : t("annotation.createDocumentFailed"));
    } finally {
      setIsCreatingDocumentAnnotation(false);
    }
  };

  return (
    <aside className="annotation-sidebar" aria-label={t("annotation.title")}>
      <div className="annotation-sidebar-header">
        <div>
          <span className="annotation-sidebar-kicker">{t("annotation.kicker")}</span>
          <h2>{t("annotation.title")}</h2>
        </div>
        <div className="annotation-sidebar-header-actions">
          <button
            type="button"
            aria-label={t("annotation.newDocument")}
            title={t("annotation.newDocument")}
            onClick={() => {
              setDocumentAnnotationError(null);
              setIsDocumentComposerOpen((current) => !current);
            }}
          >
            <MessageSquarePlus size={15} />
          </button>
          <button type="button" aria-label={t("annotation.refresh")} title={t("annotation.refresh")} onClick={onReload}>
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      <AnnotationAgentStatus
        agentLink={agentLink}
        error={agentLinkError}
        onToggleAutoMonitor={onToggleAutoMonitor}
        onCopySuccessorInstruction={onCopySuccessorInstruction}
      />

      {isDocumentComposerOpen ? (
        <form className="annotation-document-composer" onSubmit={submitDocumentAnnotation}>
          <textarea
            value={documentAnnotationDraft}
            placeholder={t("annotation.documentPlaceholder")}
            aria-label={t("annotation.documentBody")}
            autoFocus
            onChange={(event) => setDocumentAnnotationDraft(event.target.value)}
          />
          {documentAnnotationError ? (
            <div className="annotation-inline-error">{documentAnnotationError}</div>
          ) : null}
          <InlineFormActions
            isSaving={isCreatingDocumentAnnotation}
            primaryLabel={t("annotation.save")}
            onCancel={() => {
              setDocumentAnnotationDraft("");
              setDocumentAnnotationError(null);
              setIsDocumentComposerOpen(false);
            }}
          />
        </form>
      ) : null}

      <div className="annotation-filter" role="tablist" aria-label={t("annotation.filter")}>
        <FilterButton active={filter === "all"} label={t("annotation.all")} onClick={() => setFilter("all")} />
        <FilterButton
          active={filter === "resolved"}
          label={t("annotation.resolved")}
          onClick={() => setFilter("resolved")}
        />
        <FilterButton
          active={filter === "open"}
          label={t("annotation.open")}
          onClick={() => setFilter("open")}
        />
      </div>

      {error ? <div className="annotation-error">{error}</div> : null}
      {isLoading ? <div className="annotation-empty">{t("annotation.loading")}</div> : null}

      {!isLoading && filteredAnnotations.length === 0 ? (
        <div className="annotation-empty">
          <MessageSquare size={17} />
          <span>{filter === "all" ? t("annotation.emptyAll") : t("annotation.emptyFilter")}</span>
        </div>
      ) : null}

      <div className="annotation-list">
        {filteredAnnotations.map((annotation) => (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            event={getLatestAnnotationEvent(events, annotation.id)}
            isLocallyPending={pendingAnnotationIds.includes(annotation.id)}
            pendingProvider={agentLink?.connection.provider ?? null}
            isSelected={annotation.id === selectedAnnotationId}
            onSelect={onSelect}
            onToggleSelect={onToggleSelect}
            onReply={onReply}
            onEditAnnotation={onEditAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onEditReply={onEditReply}
            onStatusChange={onStatusChange}
            onSendToAgent={onSendToAgent}
            onRetryReviewEvent={onRetryReviewEvent}
          />
        ))}
      </div>
    </aside>
  );
}

function AnnotationAgentStatus({
  agentLink,
  error,
  onToggleAutoMonitor,
  onCopySuccessorInstruction
}: {
  agentLink: AgentLinkResponse | null;
  error?: string | null;
  onToggleAutoMonitor: (enabled: boolean) => Promise<void>;
  onCopySuccessorInstruction: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [isBusy, setIsBusy] = useState(false);
  const connection = agentLink?.connection;
  const autoEnabled = Boolean(connection?.autoSendNewAnnotations);
  const canUseAutoMonitor =
    connection?.provider === "codex" ||
    connection?.provider === "claude-code" ||
    connection?.provider === "workbuddy";
  const view = getAgentRouteView(agentLink, t, error);
  const copyInstructionLabel = connection?.hasTarget ? t("agent.copySuccessor") : t("agent.copyConnect");

  const run = async (action: () => Promise<void>) => {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section
      className={`annotation-codex-route annotation-codex-route-${view.tone}`}
      aria-label={t("agent.status")}
    >
      <div className="annotation-codex-route-main">
        <span className="annotation-codex-route-dot" aria-hidden="true" />
        <div className="annotation-codex-route-copy">
          <strong>{view.label}</strong>
          <small title={view.threadTitle}>{view.detail}</small>
        </div>
      </div>

      <div className="annotation-codex-route-actions">
        {connection?.hasTarget && canUseAutoMonitor ? (
          <button
            type="button"
            className={`annotation-codex-monitor${autoEnabled ? " annotation-codex-monitor-on" : ""}`}
            role="switch"
            aria-checked={autoEnabled}
            aria-label={autoEnabled ? t("agent.disableAuto") : t("agent.enableAuto")}
            title={autoEnabled ? t("agent.disableAuto") : t("agent.enableAuto")}
            disabled={isBusy}
            onClick={() => run(() => onToggleAutoMonitor(!autoEnabled))}
          >
            <span className="annotation-codex-switch" aria-hidden="true">
              <span />
            </span>
            <span>{t("agent.autoShort")}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="annotation-codex-route-button"
          aria-label={copyInstructionLabel}
          title={copyInstructionLabel}
          data-tooltip={copyInstructionLabel}
          disabled={isBusy || (!agentLink && !error)}
          onClick={() => run(onCopySuccessorInstruction)}
        >
          <Link2 size={14} />
        </button>
      </div>
    </section>
  );
}

function getAgentRouteView(
  agentLink: AgentLinkResponse | null,
  t: (key: LocaleKey, params?: Record<string, string | number>) => string,
  error?: string | null
) {
  if (error) {
    return {
      tone: "error",
      label: t("agent.readFailed"),
      detail: error,
      threadTitle: error
    };
  }

  if (!agentLink) {
    return {
      tone: "checking",
      label: t("agent.checking"),
      detail: t("agent.readingLocal"),
      threadTitle: t("agent.readingLocal")
    };
  }

  const { connection } = agentLink;

  if (!connection.hasTarget) {
    return {
      tone: "unlinked",
      label: t("agent.notDetected"),
      detail: t("agent.localOnly"),
      threadTitle: t("agent.localOnly")
    };
  }

  const providerName = getAgentProviderName(connection.provider);
  const mode = connection.autoSendNewAnnotations ? t("agent.autoMode") : t("agent.manualMode");

  return {
    tone: connection.autoSendNewAnnotations ? "auto" : connection.targetRole ?? "source",
    label: t("agent.detected", { provider: providerName }),
    detail: mode,
    threadTitle: `${providerName} · ${mode}`
  };
}

function getAgentProviderName(provider: AgentLinkResponse["connection"]["provider"]): string {
  if (provider === "claude-code") {
    return "Claude Code";
  }
  if (provider === "workbuddy") {
    return "WorkBuddy";
  }
  if (provider === "custom-cli") {
    return "Custom CLI";
  }
  return provider === "codex" ? "Codex" : "Agent";
}

type AnnotationCardProps = {
  annotation: ReviewAnnotation;
  event: ReviewEvent | null;
  isLocallyPending: boolean;
  pendingProvider: AgentProvider | null;
  isSelected: boolean;
  onSelect: (annotationId: string) => void;
  onToggleSelect: (annotationId: string) => void;
  onReply: (annotationId: string, request: AddReplyRequest) => Promise<void>;
  onEditAnnotation: (
    annotationId: string,
    request: UpdateAnnotationRequest
  ) => Promise<void>;
  onDeleteAnnotation: (annotationId: string) => Promise<void>;
  onEditReply: (
    annotationId: string,
    replyId: string,
    request: UpdateReplyRequest
  ) => Promise<void>;
  onStatusChange: (annotationId: string, status: AnnotationStatus, eventId?: string) => Promise<void>;
  onSendToAgent: (annotationId: string) => Promise<void>;
  onRetryReviewEvent: (eventId: string) => Promise<void>;
};

function getLatestAnnotationEvent(events: ReviewEvent[], annotationId: string): ReviewEvent | null {
  return (
    events
      .filter((event) => event.annotationId === annotationId)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      )[0] ?? null
  );
}

type AnnotationEventBadge = {
  label: string;
  title: string;
  tone: Exclude<ReviewEventDeliveryStatus, "ignored">;
};

function getAnnotationEventBadge(
  event: ReviewEvent | null,
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
): AnnotationEventBadge | null {
  const providerName = getEventProviderName(event);
  const params = { provider: providerName };
  switch (event?.deliveryStatus) {
    case "queued":
      return {
        label: t("event.queued"),
        title: t("event.queuedTitle", params),
        tone: "queued"
      };
    case "delivering":
      return {
        label: t("event.delivering"),
        title: t("event.deliveringTitle", params),
        tone: "delivering"
      };
    case "sent":
    case "processing":
      return {
        label: t("event.processing", params),
        title: t("event.processingTitle", params),
        tone: "processing"
      };
    case "handled":
      return {
        label: t("event.handled"),
        title: t("event.handledTitle"),
        tone: "handled"
      };
    case "failed":
      return {
        label: t("event.failed"),
        title: t("event.failedTitle"),
        tone: "failed"
      };
    case "ignored":
    default:
      return null;
  }
}

function getLocalPendingEventBadge(
  provider: AgentProvider | null,
  t: (key: LocaleKey, params?: Record<string, string | number>) => string
): AnnotationEventBadge {
  const params = { provider: getAgentProviderName(provider) };
  return {
    label: t("event.processing", params),
    title: t("event.processingTitle", params),
    tone: "processing"
  };
}

function getEventProviderName(event: ReviewEvent | null): string {
  return getAgentProviderName(getEventProvider(event));
}

function getEventProvider(event: ReviewEvent | null): AgentProvider | null {
  return (
    event?.delivery?.provider ??
    event?.targetAgent?.provider ??
    (event?.targetThreadId ? "codex" : null)
  );
}

type ReplyTargetDraft = {
  replyId: string;
  authorName: string;
};

function AnnotationCard({
  annotation,
  event,
  isLocallyPending,
  pendingProvider,
  isSelected,
  onSelect,
  onToggleSelect,
  onReply,
  onEditAnnotation,
  onDeleteAnnotation,
  onEditReply,
  onStatusChange,
  onSendToAgent,
  onRetryReviewEvent
}: AnnotationCardProps) {
  const { t } = useI18n();
  const [isReplying, setIsReplying] = useState(false);
  const [isEditingAnnotation, setIsEditingAnnotation] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState(annotation.body);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTargetDraft | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isReplySaving, setIsReplySaving] = useState(false);
  const [savingReplyEditId, setSavingReplyEditId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sortedReplies = useMemo(
    () =>
      [...annotation.replies].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      ),
    [annotation.replies]
  );
  const shouldExpand =
    isSelected && (isReplying || annotation.replies.length > 0 || localError);
  const hasFailedEvent = event?.deliveryStatus === "failed";
  const eventBadge = isLocallyPending
    ? getLocalPendingEventBadge(pendingProvider, t)
    : getAnnotationEventBadge(event, t);
  const hasPendingOperation = isSaving || isReplySaving || savingReplyEditId !== null;

  useEffect(() => {
    setAnnotationDraft(annotation.body);
  }, [annotation.body]);

  useEffect(() => {
    setReplyDrafts(
      Object.fromEntries(annotation.replies.map((reply) => [reply.id, reply.body]))
    );
  }, [annotation.replies]);

  useEffect(() => {
    setIsDeleteArmed(false);
  }, [annotation.id]);

  useEffect(() => {
    if (!isDeleteArmed) {
      return;
    }

    const timeoutId = window.setTimeout(() => setIsDeleteArmed(false), 5000);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && deleteButtonRef.current?.contains(target)) {
        return;
      }
      setIsDeleteArmed(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isDeleteArmed]);

  useEffect(() => {
    if (!isReplying) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      replyTextareaRef.current?.focus({ preventScroll: true });
      replyTextareaRef.current?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isReplying, replyTarget?.replyId]);

  const run = async (action: () => Promise<void>) => {
    setIsSaving(true);
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("annotation.operationFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const openReply = () => {
    onSelect(annotation.id);
    setIsReplying(true);
    setReplyTarget(null);
    setIsEditingAnnotation(false);
    setEditingReplyId(null);
  };

  const openReplyToReply = (reply: ReviewReply) => {
    onSelect(annotation.id);
    setIsReplying(true);
    setReplyTarget({ replyId: reply.id, authorName: reply.author.name });
    setIsEditingAnnotation(false);
    setEditingReplyId(null);
  };

  const openAnnotationEdit = () => {
    onSelect(annotation.id);
    setIsEditingAnnotation(true);
    setIsReplying(false);
    setEditingReplyId(null);
  };

  const submitAnnotationEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = annotationDraft.trim();
    if (!body) {
      return;
    }
    void run(async () => {
      await onEditAnnotation(annotation.id, { body });
      setIsEditingAnnotation(false);
    });
  };

  const removeAnnotation = () => {
    onSelect(annotation.id);
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      return;
    }
    void run(async () => {
      setIsDeleteArmed(false);
      await onDeleteAnnotation(annotation.id);
    });
  };

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!body || isReplySaving || isSaving || savingReplyEditId) {
      return;
    }
    setIsReplySaving(true);
    setLocalError(null);
    void (async () => {
      try {
        await onReply(annotation.id, {
          body,
          author: { type: "user", name: "User" },
          replyToReplyId: replyTarget?.replyId
        });
        setReplyDraft("");
        setReplyTarget(null);
        setIsReplying(false);
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : t("annotation.operationFailed"));
      } finally {
        setIsReplySaving(false);
      }
    })();
  };

  const submitReplyEdit = (event: FormEvent<HTMLFormElement>, replyId: string) => {
    event.preventDefault();
    const body = replyDrafts[replyId]?.trim();
    if (!body || isSaving || isReplySaving || savingReplyEditId) {
      return;
    }
    setSavingReplyEditId(replyId);
    setLocalError(null);
    void (async () => {
      try {
        await onEditReply(annotation.id, replyId, { body });
        setEditingReplyId(null);
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : t("annotation.operationFailed"));
      } finally {
        setSavingReplyEditId(null);
      }
    })();
  };

  const sendToAgent = () => {
    void run(async () => {
      await onSendToAgent(annotation.id);
    });
  };

  const retryEvent = () => {
    if (!event) {
      return;
    }
    void run(async () => {
      await onRetryReviewEvent(event.id);
    });
  };

  return (
    <article className={`annotation-card${isSelected ? " annotation-card-active" : ""}`}>
      {isEditingAnnotation ? (
        <form
          className="annotation-card-main annotation-card-main-editing"
          onSubmit={submitAnnotationEdit}
        >
          <span className="annotation-card-status-row">
            <span className={`annotation-status annotation-status-${annotation.status}`}>
              {annotation.status === "open" ? <CircleDot size={13} /> : <CheckCircle2 size={13} />}
              {annotation.status === "open" ? t("annotation.open") : t("annotation.resolved")}
            </span>
            {eventBadge ? (
              <span
                className={`annotation-event-badge annotation-event-badge-${eventBadge.tone}`}
                title={eventBadge.title}
              >
                {eventBadge.label}
              </span>
            ) : null}
          </span>
          <textarea
            className="annotation-card-body-editor"
            value={annotationDraft}
            onChange={(event) => setAnnotationDraft(event.target.value)}
            aria-label={t("annotation.edit")}
            autoFocus
          />
          <span className="annotation-card-meta">
            {t("annotation.replies", { count: annotation.replies.length })} · {formatTime(annotation.updatedAt)}
          </span>
          <InlineFormActions
            isSaving={isSaving}
            primaryLabel={t("annotation.save")}
            onCancel={() => {
              setAnnotationDraft(annotation.body);
              setIsEditingAnnotation(false);
            }}
          />
        </form>
      ) : (
        <button
          type="button"
          className="annotation-card-main"
          onClick={() => onToggleSelect(annotation.id)}
        >
          <span className="annotation-card-status-row">
            <span className={`annotation-status annotation-status-${annotation.status}`}>
              {annotation.status === "open" ? <CircleDot size={13} /> : <CheckCircle2 size={13} />}
              {annotation.status === "open" ? t("annotation.open") : t("annotation.resolved")}
            </span>
            {eventBadge ? (
              <span
                className={`annotation-event-badge annotation-event-badge-${eventBadge.tone}`}
                title={eventBadge.title}
              >
                {eventBadge.label}
              </span>
            ) : null}
          </span>
          <span className="annotation-card-body">{annotation.body}</span>
          <span className="annotation-card-meta">
            {t("annotation.replies", { count: annotation.replies.length })} · {formatTime(annotation.updatedAt)}
          </span>
        </button>
      )}

      <div className="annotation-card-top-actions">
        {hasFailedEvent ? (
          <button
            type="button"
            className="annotation-card-icon-action"
            aria-label={t("annotation.retryDelivery")}
            title={t("annotation.retryDelivery")}
            onClick={retryEvent}
            disabled={hasPendingOperation}
          >
            <RotateCcw size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="annotation-card-icon-action"
          aria-label={annotation.status === "open" ? t("annotation.markResolved") : t("annotation.reopen")}
          title={annotation.status === "open" ? t("annotation.markResolved") : t("annotation.reopen")}
          onClick={() => {
            const nextStatus = annotation.status === "open" ? "resolved" : "open";
            onStatusChange(
              annotation.id,
              nextStatus,
              nextStatus === "resolved" ? event?.id : undefined
            );
          }}
        >
          {annotation.status === "open" ? <CheckCircle2 size={15} /> : <ReopenIcon />}
        </button>
        {!isEditingAnnotation ? (
          <button
            ref={deleteButtonRef}
            type="button"
            className={`annotation-card-icon-action annotation-card-action-danger${
              isDeleteArmed ? " annotation-card-action-confirm" : ""
            }`}
            onClick={removeAnnotation}
            disabled={hasPendingOperation}
            aria-label={isDeleteArmed ? t("annotation.confirmDelete") : t("annotation.delete")}
            title={isDeleteArmed ? t("annotation.deleteAgain") : t("annotation.delete")}
          >
            <Trash2 size={13} />
            {isDeleteArmed ? <span>{t("annotation.confirmDeleteText")}</span> : null}
          </button>
        ) : null}
      </div>

      {!isEditingAnnotation ? (
        <div className="annotation-card-actions">
          <button type="button" onClick={openReply}>
            <Reply size={13} />
            {t("annotation.reply")}
          </button>
          <button type="button" onClick={openAnnotationEdit}>
            <Pencil size={13} />
            {t("annotation.edit")}
          </button>
          <button type="button" onClick={sendToAgent} disabled={hasPendingOperation}>
            <AtSign size={13} />
            {t("annotation.sendAgent")}
          </button>
        </div>
      ) : null}

      {shouldExpand ? (
        <div className="annotation-thread">
          {localError ? <div className="annotation-inline-error">{localError}</div> : null}

          {annotation.replies.length > 0 ? (
            <div className="annotation-replies">
              {sortedReplies.map((reply) => {
                const canEditReply = reply.author.type !== "agent";
                return (
                  <div className="annotation-reply" key={reply.id}>
                    <div className="annotation-reply-header">
                      <span>{reply.author.name}</span>
                      <time>{formatTime(reply.updatedAt ?? reply.createdAt)}</time>
                      {reply.author.type === "agent" ? (
                        <button
                          type="button"
                          aria-label={t("annotation.replyToName", { name: reply.author.name })}
                          title={t("annotation.replyToName", { name: reply.author.name })}
                          onClick={() => openReplyToReply(reply)}
                        >
                          <Reply size={12} />
                        </button>
                      ) : canEditReply ? (
                        <button
                          type="button"
                          aria-label={t("annotation.editReply")}
                          title={t("annotation.editReply")}
                          onClick={() => {
                            onSelect(annotation.id);
                            setEditingReplyId(reply.id);
                            setIsReplying(false);
                            setIsEditingAnnotation(false);
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                      ) : null}
                    </div>
                    {canEditReply && editingReplyId === reply.id ? (
                      <form
                        className="annotation-inline-form"
                        onSubmit={(event) => submitReplyEdit(event, reply.id)}
                      >
                        <textarea
                          value={replyDrafts[reply.id] ?? reply.body}
                          onChange={(event) =>
                            setReplyDrafts((current) => ({
                              ...current,
                              [reply.id]: event.target.value
                            }))
                          }
                          aria-label={t("annotation.editReplyBody")}
                        />
                        <InlineFormActions
                          isSaving={savingReplyEditId === reply.id}
                          isSubmitDisabled={
                            !replyDrafts[reply.id]?.trim() ||
                            (hasPendingOperation && savingReplyEditId !== reply.id)
                          }
                          primaryLabel={t("annotation.save")}
                          onCancel={() => {
                            setReplyDrafts((current) => ({
                              ...current,
                              [reply.id]: reply.body
                            }));
                            setEditingReplyId(null);
                          }}
                        />
                      </form>
                    ) : (
                      <p>
                        {reply.replyTo ? (
                          <span className="annotation-reply-mention">
                            @{reply.replyTo.authorName}
                          </span>
                        ) : null}
                        {reply.body}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {isReplying ? (
            <form className="annotation-inline-form" onSubmit={submitReply}>
              {replyTarget ? (
                <div className="annotation-reply-target">
                  {t("annotation.reply")} <span>@{replyTarget.authorName}</span>
                </div>
              ) : null}
              <textarea
                ref={replyTextareaRef}
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                placeholder={replyTarget ? t("annotation.replyToReply") : t("annotation.replyToAnnotation")}
                aria-label={t("annotation.replyToAnnotation")}
              />
              <InlineFormActions
                isSaving={isReplySaving}
                isSubmitDisabled={!replyDraft.trim() || (hasPendingOperation && !isReplySaving)}
                primaryLabel={t("annotation.send")}
                primaryIcon={<Send size={13} />}
                onCancel={() => {
                  setReplyDraft("");
                  setReplyTarget(null);
                  setIsReplying(false);
                }}
              />
            </form>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function InlineFormActions({
  isSaving,
  isSubmitDisabled = false,
  primaryLabel,
  primaryIcon,
  onCancel
}: {
  isSaving: boolean;
  isSubmitDisabled?: boolean;
  primaryLabel: string;
  primaryIcon?: ReactNode;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="annotation-inline-actions">
      <button type="button" onClick={onCancel} disabled={isSaving}>
        <X size={13} />
        {t("annotation.cancel")}
      </button>
      <button type="submit" disabled={isSaving || isSubmitDisabled}>
        {primaryIcon ?? <Check size={13} />}
        {isSaving ? t("annotation.processing") : primaryLabel}
      </button>
    </div>
  );
}

function ReopenIcon() {
  return (
    <svg
      className="annotation-reopen-icon"
      viewBox="0 0 1024 1024"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M892.583 321.829H351.326c-153.6 0-277.943 131.657-277.943 292.571s124.343 292.571 277.943 292.571h636.342c21.943 0 36.572 14.629 36.572 36.572s-14.629 36.571-36.572 36.571H351.326C153.84 980.114-7.074 811.886 0.24 614.4c0-197.486 153.6-365.714 351.086-365.714h533.942l-138.97-138.972c-14.63-14.628-14.63-36.571 0-51.2 14.628-14.628 36.57-14.628 51.2 0l204.8 204.8c14.628 14.629 14.628 36.572 0 51.2l-204.8 204.8c-14.63 14.629-36.572 14.629-51.2 0s-14.63-36.571 0-51.2L892.582 321.83z"
      />
    </svg>
  );
}

function FilterButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "annotation-filter-active" : ""} onClick={onClick}>
      {label}
    </button>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
