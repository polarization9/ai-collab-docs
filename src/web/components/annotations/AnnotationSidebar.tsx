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
import type { CodexLinkResponse } from "../../../shared/codexTypes";
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

type AnnotationFilter = "all" | AnnotationStatus;

type AnnotationSidebarProps = {
  annotations: ReviewAnnotation[];
  events: ReviewEvent[];
  codexLink: CodexLinkResponse | null;
  codexLinkError?: string | null;
  selectedAnnotationId: string | null;
  isLoading: boolean;
  error?: string;
  onSelect: (annotationId: string) => void;
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
  onStatusChange: (annotationId: string, status: AnnotationStatus) => Promise<void>;
  onCreateDocumentAnnotation: (body: string) => Promise<void>;
  onToggleAutoMonitor: (enabled: boolean) => Promise<void>;
  onCopySuccessorInstruction: () => Promise<void>;
  onSendToCodex: (annotationId: string) => Promise<void>;
  onRetryReviewEvent: (eventId: string) => Promise<void>;
  onReload: () => void;
};

export function AnnotationSidebar({
  annotations,
  events,
  codexLink,
  codexLinkError,
  selectedAnnotationId,
  isLoading,
  error,
  onSelect,
  onReply,
  onEditAnnotation,
  onDeleteAnnotation,
  onEditReply,
  onStatusChange,
  onCreateDocumentAnnotation,
  onToggleAutoMonitor,
  onCopySuccessorInstruction,
  onSendToCodex,
  onRetryReviewEvent,
  onReload
}: AnnotationSidebarProps) {
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
      setDocumentAnnotationError(error instanceof Error ? error.message : "添加全文批注失败");
    } finally {
      setIsCreatingDocumentAnnotation(false);
    }
  };

  return (
    <aside className="annotation-sidebar" aria-label="批注">
      <div className="annotation-sidebar-header">
        <div>
          <span className="annotation-sidebar-kicker">Review</span>
          <h2>批注</h2>
        </div>
        <div className="annotation-sidebar-header-actions">
          <button
            type="button"
            aria-label="新建全文批注"
            title="新建全文批注"
            onClick={() => {
              setDocumentAnnotationError(null);
              setIsDocumentComposerOpen((current) => !current);
            }}
          >
            <MessageSquarePlus size={15} />
          </button>
          <button type="button" aria-label="刷新批注" title="刷新批注" onClick={onReload}>
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      <AnnotationCodexStatus
        codexLink={codexLink}
        error={codexLinkError}
        onToggleAutoMonitor={onToggleAutoMonitor}
        onCopySuccessorInstruction={onCopySuccessorInstruction}
      />

      {isDocumentComposerOpen ? (
        <form className="annotation-document-composer" onSubmit={submitDocumentAnnotation}>
          <textarea
            value={documentAnnotationDraft}
            placeholder="写下全文批注，不引用具体段落"
            aria-label="全文批注内容"
            autoFocus
            onChange={(event) => setDocumentAnnotationDraft(event.target.value)}
          />
          {documentAnnotationError ? (
            <div className="annotation-inline-error">{documentAnnotationError}</div>
          ) : null}
          <InlineFormActions
            isSaving={isCreatingDocumentAnnotation}
            primaryLabel="保存"
            onCancel={() => {
              setDocumentAnnotationDraft("");
              setDocumentAnnotationError(null);
              setIsDocumentComposerOpen(false);
            }}
          />
        </form>
      ) : null}

      <div className="annotation-filter" role="tablist" aria-label="批注筛选">
        <FilterButton active={filter === "all"} label="全部" onClick={() => setFilter("all")} />
        <FilterButton
          active={filter === "resolved"}
          label="已解决"
          onClick={() => setFilter("resolved")}
        />
        <FilterButton
          active={filter === "open"}
          label="未解决"
          onClick={() => setFilter("open")}
        />
      </div>

      {error ? <div className="annotation-error">{error}</div> : null}
      {isLoading ? <div className="annotation-empty">Loading annotations...</div> : null}

      {!isLoading && filteredAnnotations.length === 0 ? (
        <div className="annotation-empty">
          <MessageSquare size={17} />
          <span>{filter === "all" ? "还没有批注" : "还没有这个状态的批注"}</span>
        </div>
      ) : null}

      <div className="annotation-list">
        {filteredAnnotations.map((annotation) => (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            event={getLatestAnnotationEvent(events, annotation.id)}
            isSelected={annotation.id === selectedAnnotationId}
            onSelect={onSelect}
            onReply={onReply}
            onEditAnnotation={onEditAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onEditReply={onEditReply}
            onStatusChange={onStatusChange}
            onSendToCodex={onSendToCodex}
            onRetryReviewEvent={onRetryReviewEvent}
          />
        ))}
      </div>
    </aside>
  );
}

function AnnotationCodexStatus({
  codexLink,
  error,
  onToggleAutoMonitor,
  onCopySuccessorInstruction
}: {
  codexLink: CodexLinkResponse | null;
  error?: string | null;
  onToggleAutoMonitor: (enabled: boolean) => Promise<void>;
  onCopySuccessorInstruction: () => Promise<void>;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const connection = codexLink?.connection;
  const autoEnabled = Boolean(connection?.autoSendNewAnnotations);
  const view = getCodexRouteView(codexLink, error);
  const copyInstructionLabel = connection?.hasTarget ? "复制接续指令" : "复制连接指令";

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
      aria-label="Codex 连接状态"
    >
      <div className="annotation-codex-route-main">
        <span className="annotation-codex-route-dot" aria-hidden="true" />
        <div className="annotation-codex-route-copy">
          <strong>{view.label}</strong>
          <small title={view.threadTitle}>{view.detail}</small>
        </div>
      </div>

      <div className="annotation-codex-route-actions">
        {connection?.hasTarget ? (
          <button
            type="button"
            className={`annotation-codex-monitor${autoEnabled ? " annotation-codex-monitor-on" : ""}`}
            role="switch"
            aria-checked={autoEnabled}
            aria-label={autoEnabled ? "关闭自动监控" : "开启自动监控"}
            title={autoEnabled ? "关闭自动监控" : "开启自动监控"}
            disabled={isBusy}
            onClick={() => run(() => onToggleAutoMonitor(!autoEnabled))}
          >
            <span className="annotation-codex-switch" aria-hidden="true">
              <span />
            </span>
            <span>自动</span>
          </button>
        ) : null}
        <button
          type="button"
          className="annotation-codex-route-button"
          aria-label={copyInstructionLabel}
          title={copyInstructionLabel}
          data-tooltip={copyInstructionLabel}
          disabled={isBusy || (!codexLink && !error)}
          onClick={() => run(onCopySuccessorInstruction)}
        >
          <Link2 size={14} />
        </button>
      </div>
    </section>
  );
}

function getCodexRouteView(codexLink: CodexLinkResponse | null, error?: string | null) {
  if (error) {
    return {
      tone: "error",
      label: "状态读取失败",
      detail: error,
      threadTitle: error
    };
  }

  if (!codexLink) {
    return {
      tone: "checking",
      label: "检查会话关联",
      detail: "正在读取本地连接",
      threadTitle: "正在读取本地连接"
    };
  }

  const { connection, link } = codexLink;
  const target = link?.target;
  const threadId = target?.threadId ?? link?.source?.threadId ?? "";
  const threadLabel = threadId ? ` · ${formatThreadId(threadId)}` : "";
  const threadTitle = threadId ? `Codex thread: ${threadId}` : "";

  if (!connection.hasTarget) {
    return {
      tone: "unlinked",
      label: "未关联会话",
      detail: "批注仅保存在本地",
      threadTitle: "批注仅保存在本地"
    };
  }

  const label = connection.targetType === "successor" ? "接续会话" : "来源会话";
  const mode = connection.autoSendNewAnnotations ? "自动监控中" : "手动投递";

  return {
    tone: connection.autoSendNewAnnotations ? "auto" : connection.targetType ?? "source",
    label,
    detail: `${mode}${threadLabel}`,
    threadTitle: threadTitle || `${label} · ${mode}`
  };
}

function formatThreadId(threadId: string) {
  return threadId.length > 10 ? `${threadId.slice(0, 10)}...` : threadId;
}

type AnnotationCardProps = {
  annotation: ReviewAnnotation;
  event: ReviewEvent | null;
  isSelected: boolean;
  onSelect: (annotationId: string) => void;
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
  onStatusChange: (annotationId: string, status: AnnotationStatus) => Promise<void>;
  onSendToCodex: (annotationId: string) => Promise<void>;
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

function getAnnotationEventBadge(event: ReviewEvent | null): AnnotationEventBadge | null {
  switch (event?.deliveryStatus) {
    case "queued":
      return {
        label: "待投递",
        title: "已进入 Codex 队列，等待投递",
        tone: "queued"
      };
    case "delivering":
      return {
        label: "等待会话",
        title: "正在等待 Codex 会话可接收任务",
        tone: "delivering"
      };
    case "sent":
    case "processing":
      return {
        label: "Codex 处理中",
        title: "Codex 已收到任务，正在等待处理完成",
        tone: "processing"
      };
    case "handled":
      return {
        label: "已处理",
        title: "Codex 已完成这条批注的处理",
        tone: "handled"
      };
    case "failed":
      return {
        label: "未投递",
        title: "投递失败，可以重试",
        tone: "failed"
      };
    case "ignored":
    default:
      return null;
  }
}

type ReplyTargetDraft = {
  replyId: string;
  authorName: string;
};

function AnnotationCard({
  annotation,
  event,
  isSelected,
  onSelect,
  onReply,
  onEditAnnotation,
  onDeleteAnnotation,
  onEditReply,
  onStatusChange,
  onSendToCodex,
  onRetryReviewEvent
}: AnnotationCardProps) {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditingAnnotation, setIsEditingAnnotation] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState(annotation.body);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTargetDraft | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
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
  const eventBadge = getAnnotationEventBadge(event);

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

  const run = async (action: () => Promise<void>) => {
    setIsSaving(true);
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "操作失败");
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
    if (!body) {
      return;
    }
    void run(async () => {
      await onReply(annotation.id, {
        body,
        author: { type: "user", name: "User" },
        replyToReplyId: replyTarget?.replyId
      });
      setReplyDraft("");
      setReplyTarget(null);
      setIsReplying(false);
    });
  };

  const submitReplyEdit = (event: FormEvent<HTMLFormElement>, replyId: string) => {
    event.preventDefault();
    const body = replyDrafts[replyId]?.trim();
    if (!body) {
      return;
    }
    void run(async () => {
      await onEditReply(annotation.id, replyId, { body });
      setEditingReplyId(null);
    });
  };

  const sendToCodex = () => {
    void run(async () => {
      await onSendToCodex(annotation.id);
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
              {annotation.status === "open" ? "未解决" : "已解决"}
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
            aria-label="编辑批注"
            autoFocus
          />
          <span className="annotation-card-meta">
            {annotation.replies.length} 条回复 · {formatTime(annotation.updatedAt)}
          </span>
          <InlineFormActions
            isSaving={isSaving}
            primaryLabel="保存"
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
          onClick={() => onSelect(annotation.id)}
        >
          <span className="annotation-card-status-row">
            <span className={`annotation-status annotation-status-${annotation.status}`}>
              {annotation.status === "open" ? <CircleDot size={13} /> : <CheckCircle2 size={13} />}
              {annotation.status === "open" ? "未解决" : "已解决"}
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
            {annotation.replies.length} 条回复 · {formatTime(annotation.updatedAt)}
          </span>
        </button>
      )}

      <div className="annotation-card-top-actions">
        {hasFailedEvent ? (
          <button
            type="button"
            className="annotation-card-icon-action"
            aria-label="重试投递"
            title="重试投递"
            onClick={retryEvent}
            disabled={isSaving}
          >
            <RotateCcw size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="annotation-card-icon-action"
          aria-label={annotation.status === "open" ? "标记已解决" : "重新打开"}
          title={annotation.status === "open" ? "标记已解决" : "重新打开"}
          onClick={() =>
            onStatusChange(annotation.id, annotation.status === "open" ? "resolved" : "open")
          }
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
            disabled={isSaving}
            aria-label={isDeleteArmed ? "确认删除批注" : "删除批注"}
            title={isDeleteArmed ? "再次点击确认删除" : "删除批注"}
          >
            <Trash2 size={13} />
            {isDeleteArmed ? <span>确认删除</span> : null}
          </button>
        ) : null}
      </div>

      {!isEditingAnnotation ? (
        <div className="annotation-card-actions">
          <button type="button" onClick={openReply}>
            <Reply size={13} />
            回复
          </button>
          <button type="button" onClick={openAnnotationEdit}>
            <Pencil size={13} />
            编辑
          </button>
          <button type="button" onClick={sendToCodex} disabled={isSaving}>
            <AtSign size={13} />
            @codex
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
                          aria-label={`回复 ${reply.author.name}`}
                          title={`回复 ${reply.author.name}`}
                          onClick={() => openReplyToReply(reply)}
                        >
                          <Reply size={12} />
                        </button>
                      ) : canEditReply ? (
                        <button
                          type="button"
                          aria-label="编辑回复"
                          title="编辑回复"
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
                          aria-label="编辑回复内容"
                        />
                        <InlineFormActions
                          isSaving={isSaving}
                          primaryLabel="保存"
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
                  回复 <span>@{replyTarget.authorName}</span>
                </div>
              ) : null}
              <textarea
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                placeholder={replyTarget ? "继续回应这条回复" : "回复这条批注"}
                aria-label="回复批注"
              />
              <InlineFormActions
                isSaving={isSaving}
                primaryLabel="发送"
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
  primaryLabel,
  primaryIcon,
  onCancel
}: {
  isSaving: boolean;
  primaryLabel: string;
  primaryIcon?: ReactNode;
  onCancel: () => void;
}) {
  return (
    <div className="annotation-inline-actions">
      <button type="button" onClick={onCancel} disabled={isSaving}>
        <X size={13} />
        取消
      </button>
      <button type="submit" disabled={isSaving}>
        {primaryIcon ?? <Check size={13} />}
        {isSaving ? "处理中" : primaryLabel}
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
