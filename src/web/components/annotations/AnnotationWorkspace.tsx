import { FilePenLine, MessageSquareText, Save, X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { parseHeadingLocations, parseHeadings } from "../../../shared/markdownHeadings";
import type { AgentLinkResponse } from "../../../shared/agentTypes";
import type {
  ReviewAnchor,
  ReviewEventDeliveryStatus,
  ReviewFile
} from "../../../shared/reviewTypes";
import type { Heading, ReviewDocument } from "../../../shared/types";
import {
  checkDocumentMergeStatus,
  createAgentSuccessorInstruction,
  fetchAgentLink,
  fetchDocument,
  retryReviewEvent,
  saveDocument,
  sendAnnotationToAgent,
  updateAgentLink
} from "../../api";
import type { AnnotationDraft } from "../../review/anchorCapture";
import { captureAnnotationDraft } from "../../review/anchorCapture";
import { scrollToAnnotation } from "../../review/anchorResolve";
import { useReview } from "../../hooks/useReview";
import { copyText } from "../../utils/clipboard";
import { DocumentViewer } from "../DocumentViewer";
import { useI18n } from "../../i18n";
import type {
  MarkdownEditorSelection,
  MarkdownSourceEditorHandle
} from "../editor/MarkdownSourceEditor";
import { AnnotationLayer } from "./AnnotationLayer";
import { AnnotationSelectionToolbar } from "./AnnotationSelectionToolbar";
import { AnnotationSidebar } from "./AnnotationSidebar";
import {
  DocumentUpdateNotice,
  type DocumentUpdateSource,
  type DocumentUpdateState
} from "./DocumentUpdateNotice";

const MarkdownSourceEditor = lazy(() =>
  import("../editor/MarkdownSourceEditor").then((module) => ({
    default: module.MarkdownSourceEditor
  }))
);

const AUTO_REVIEW_POLL_STATUSES = new Set<ReviewEventDeliveryStatus>([
  "queued",
  "delivering",
  "sent",
  "processing"
]);

type AnnotationWorkspaceProps = {
  document: ReviewDocument;
  initialReview?: ReviewFile | null;
  initialAgentLink?: AgentLinkResponse | null;
  onDocumentChange: (document: ReviewDocument) => void;
  externalRefreshEnabled?: boolean;
};

type SwitchAnchor = {
  text: string;
  selectedText?: string;
  headingId: string | null;
  headingText: string | null;
  markdownOffset?: number;
};

type EditorMergeSnapshot = {
  draft: string;
  baseContent: string;
  baseHash: string;
  version: number;
};

function hasEditorMergeSnapshotChanged(
  previous: EditorMergeSnapshot,
  current: EditorMergeSnapshot
): boolean {
  return (
    previous.version !== current.version ||
    previous.draft !== current.draft ||
    previous.baseContent !== current.baseContent ||
    previous.baseHash !== current.baseHash
  );
}

function hasAutoReviewPollEvents(review: ReviewFile | null | undefined): boolean {
  return Boolean(
    review?.events?.some((event) => AUTO_REVIEW_POLL_STATUSES.has(event.deliveryStatus))
  );
}

export function AnnotationWorkspace({
  document,
  initialReview = null,
  initialAgentLink = null,
  onDocumentChange,
  externalRefreshEnabled = true
}: AnnotationWorkspaceProps) {
  const { t } = useI18n();
  const contentRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<MarkdownSourceEditorHandle | null>(null);
  const pendingEditorAnchorRef = useRef<SwitchAnchor | null>(null);
  const pendingReadingAnchorRef = useRef<SwitchAnchor | null>(null);
  const latestReviewRef = useRef<ReviewFile | null>(
    initialReview?.documentId === document.id ? initialReview : null
  );
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const [editorAnnotationDraft, setEditorAnnotationDraft] = useState<AnnotationDraft | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editorDraft, setEditorDraft] = useState(document.content);
  const [editorBaseContent, setEditorBaseContent] = useState(document.content);
  const [editorBaseHash, setEditorBaseHash] = useState(document.contentHash);
  const editorMergeVersionRef = useRef(0);
  const editorMergeSnapshotRef = useRef<EditorMergeSnapshot>({
    draft: document.content,
    baseContent: document.content,
    baseHash: document.contentHash,
    version: 0
  });
  const [documentUpdateState, setDocumentUpdateState] = useState<DocumentUpdateState>({
    kind: "hidden"
  });
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [agentLink, setAgentLink] = useState<AgentLinkResponse | null>(initialAgentLink);
  const [agentLinkError, setAgentLinkError] = useState<string | null>(null);
  const review = useReview(document.id, initialReview, document.absolutePath);
  const isDirty = editorDraft !== editorBaseContent;
  const annotations = useMemo(
    () => (review.state.status === "ready" ? review.state.review.annotations : []),
    [review.state]
  );
  const hasPendingReviewEvents = useMemo(
    () =>
      review.state.status === "ready" &&
      hasAutoReviewPollEvents(review.state.review),
    [review.state]
  );
  const isDocumentConflictBlocked = documentUpdateState.kind === "conflictBlocked";

  useEffect(() => {
    if (review.state.status === "ready") {
      latestReviewRef.current = review.state.review;
    }
  }, [review.state]);

  useLayoutEffect(() => {
    editorMergeVersionRef.current += 1;
    editorMergeSnapshotRef.current = {
      draft: editorDraft,
      baseContent: editorBaseContent,
      baseHash: editorBaseHash,
      version: editorMergeVersionRef.current
    };
  }, [editorBaseContent, editorBaseHash, editorDraft]);

  useEffect(() => {
    if (!isEditing || !isDirty) {
      setEditorDraft(document.content);
      setEditorBaseContent(document.content);
      setEditorBaseHash(document.contentHash);
    }
  }, [document.content, document.contentHash, isDirty, isEditing]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => setFeedback(null), 1400);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (documentUpdateState.kind !== "autoUpdated") {
      return;
    }

    const timer = window.setTimeout(
      () => setDocumentUpdateState({ kind: "hidden" }),
      2000
    );
    return () => window.clearTimeout(timer);
  }, [documentUpdateState.kind]);

  const reloadAgentLink = useCallback(async () => {
    try {
      setAgentLink(await fetchAgentLink(document.absolutePath));
      setAgentLinkError(null);
    } catch (error) {
      setAgentLink(null);
      setAgentLinkError(error instanceof Error ? error.message : t("document.agentStatusFailed"));
    }
  }, [document.absolutePath, t]);

  const showAutoUpdated = useCallback((source: DocumentUpdateSource, merged = false) => {
    setDocumentUpdateState({ kind: "autoUpdated", source, merged });
  }, []);

  const reloadDocumentFromDisk = useCallback(async (
    source: DocumentUpdateSource = "unknown",
    showNotice = false
  ) => {
    try {
      const nextDocument = await fetchDocument(document.absolutePath);
      onDocumentChange(nextDocument);
      void review.reload({ silent: true });
      void reloadAgentLink();
      if (showNotice) {
        showAutoUpdated(source);
      }
    } catch {
      // Keep the current document visible; explicit user actions still surface load errors.
    }
  }, [
    document.absolutePath,
    onDocumentChange,
    reloadAgentLink,
    review.reload,
    showAutoUpdated
  ]);

  const isInteractingWithDocument = useCallback(() => {
    if (isEditing || isDirty || draft || editorAnnotationDraft) {
      return true;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const container = contentRef.current;
    if (!container) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const commonAncestor =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    return Boolean(commonAncestor && container.contains(commonAncestor));
  }, [draft, editorAnnotationDraft, isDirty, isEditing]);

  const handleDetectedDocumentChange = useCallback(async (
    source: DocumentUpdateSource,
    detectedDocument?: ReviewDocument
  ) => {
    try {
      const nextDocument = detectedDocument ?? await fetchDocument(document.absolutePath);
      const knownHash =
        documentUpdateState.kind === "conflictBlocked"
          ? documentUpdateState.externalContentHash
          : isEditing
            ? editorMergeSnapshotRef.current.baseHash
            : document.contentHash;

      if (nextDocument.contentHash === knownHash) {
        return;
      }

      if (!isEditing) {
        if (isInteractingWithDocument()) {
          setDocumentUpdateState({ kind: "updateAvailable", source });
          return;
        }

        onDocumentChange(nextDocument);
        void review.reload({ silent: true });
        void reloadAgentLink();
        showAutoUpdated(source);
        return;
      }

      const retryMergeWithLatestDraft = () => {
        window.setTimeout(() => {
          void handleDetectedDocumentChange(source, nextDocument);
        }, 0);
      };
      const mergeSnapshot = editorMergeSnapshotRef.current;

      try {
        const mergeStatus = await checkDocumentMergeStatus({
          baseContent: mergeSnapshot.baseContent,
          baseContentHash: mergeSnapshot.baseHash,
          draftContent: mergeSnapshot.draft
        }, document.absolutePath);

        if (hasEditorMergeSnapshotChanged(mergeSnapshot, editorMergeSnapshotRef.current)) {
          retryMergeWithLatestDraft();
          return;
        }

        onDocumentChange(nextDocument);
        void review.reload({ silent: true });
        void reloadAgentLink();

        if (mergeStatus.status === "unchanged") {
          return;
        }

        if (mergeStatus.status === "externalOnly") {
          setEditorDraft(mergeStatus.externalContent);
          setEditorBaseContent(mergeStatus.externalContent);
          setEditorBaseHash(mergeStatus.externalContentHash);
          showAutoUpdated(source);
          return;
        }

        if (mergeStatus.status === "merged") {
          setEditorDraft(mergeStatus.mergedContent);
          setEditorBaseContent(mergeStatus.externalContent);
          setEditorBaseHash(mergeStatus.externalContentHash);
          showAutoUpdated(source, true);
          return;
        }

        setDocumentUpdateState({
          kind: "conflictBlocked",
          source,
          externalContent: mergeStatus.externalContent,
          externalContentHash: mergeStatus.externalContentHash,
          conflicts: mergeStatus.conflicts,
          detailsOpen: false
        });
      } catch {
        if (hasEditorMergeSnapshotChanged(mergeSnapshot, editorMergeSnapshotRef.current)) {
          retryMergeWithLatestDraft();
          return;
        }

        onDocumentChange(nextDocument);
        setDocumentUpdateState({
          kind: "conflictBlocked",
          source,
          externalContent: nextDocument.content,
          externalContentHash: nextDocument.contentHash,
          conflicts: [],
          detailsOpen: false,
          mergeCheckFailed: true
        });
      }
    } catch {
      // Opportunistic refresh should not hide the current document or draft.
    }
  }, [
    document.absolutePath,
    document.contentHash,
    documentUpdateState,
    isEditing,
    isInteractingWithDocument,
    onDocumentChange,
    reloadAgentLink,
    review.reload,
    showAutoUpdated
  ]);

  useEffect(() => {
    if (initialAgentLink) {
      setAgentLink(initialAgentLink);
      setAgentLinkError(null);
      return;
    }

    void reloadAgentLink();
  }, [document.id, initialAgentLink, reloadAgentLink]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const handleFocus = () => {
      void reloadAgentLink();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [isSidebarOpen, reloadAgentLink]);

  useEffect(() => {
    if (!hasPendingReviewEvents) {
      return;
    }

    const reloadBackgroundReview = async () => {
      const previousReview = latestReviewRef.current;
      const nextReview = await review.reload({ silent: true });
      if (!nextReview) {
        return;
      }

      if (hasAutoReviewPollEvents(previousReview) && !hasAutoReviewPollEvents(nextReview)) {
        void reloadAgentLink();
        void handleDetectedDocumentChange("codex");
      }
    };

    const timer = window.setInterval(reloadBackgroundReview, 2500);
    return () => window.clearInterval(timer);
  }, [
    hasPendingReviewEvents,
    handleDetectedDocumentChange,
    reloadAgentLink,
    review.reload
  ]);

  useEffect(() => {
    if (!externalRefreshEnabled) {
      return;
    }

    if (
      typeof window.document.visibilityState !== "undefined" &&
      window.document.visibilityState === "hidden"
    ) {
      return;
    }

    let cancelled = false;
    const pollExternalChanges = async () => {
      try {
        const nextDocument = await fetchDocument(document.absolutePath);
        const knownHash =
          documentUpdateState.kind === "conflictBlocked"
            ? documentUpdateState.externalContentHash
            : isEditing
              ? editorBaseHash
              : document.contentHash;
        if (cancelled || nextDocument.contentHash === knownHash) {
          return;
        }
        void handleDetectedDocumentChange("external", nextDocument);
      } catch {
        // External refresh is opportunistic; visible user actions still surface errors.
      }
    };

    const timer = window.setInterval(pollExternalChanges, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    document.absolutePath,
    document.contentHash,
    documentUpdateState,
    editorBaseHash,
    externalRefreshEnabled,
    handleDetectedDocumentChange,
    isEditing,
    t
  ]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const timer = window.setInterval(() => {
      void review.reload({ silent: true });
      void reloadAgentLink();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isSidebarOpen, reloadAgentLink, review.reload]);

  const captureSelection = useCallback(() => {
    if (isEditing) {
      return;
    }

    window.setTimeout(() => {
      const container = contentRef.current;
      if (!container) {
        return;
      }
      setDraft(captureAnnotationDraft(container, document.headings));
    }, 0);
  }, [document.headings, isEditing]);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    window.document.addEventListener("mouseup", captureSelection);
    window.addEventListener("keyup", captureSelection);
    return () => {
      window.document.removeEventListener("mouseup", captureSelection);
      window.removeEventListener("keyup", captureSelection);
    };
  }, [captureSelection, isEditing]);

  const selectAnnotation = (annotationId: string, options: { scroll?: boolean } = {}) => {
    setIsSidebarOpen(true);
    void reloadAgentLink();
    review.setSelectedAnnotationId(annotationId);
    if (options.scroll === false) {
      return;
    }
    const annotation = annotations.find((item) => item.id === annotationId);
    const container = contentRef.current;
    if (annotation && container) {
      scrollToAnnotation(annotation, container);
    }
  };

  const enterEditMode = () => {
    pendingEditorAnchorRef.current = captureReadingSwitchAnchor(contentRef.current);
    setIsSidebarOpen(false);
    setDraft(null);
    setEditorAnnotationDraft(null);
    setEditorError(null);
    setDocumentUpdateState({ kind: "hidden" });
    setEditorDraft(document.content);
    setEditorBaseContent(document.content);
    setEditorBaseHash(document.contentHash);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (isDirty && !window.confirm(t("document.unsavedConfirm"))) {
      return;
    }

    pendingReadingAnchorRef.current = captureEditorSwitchAnchor(
      editorDraft,
      editorRef.current?.getTopVisibleAnchor() ?? { offset: 0, text: "" }
    );
    setEditorDraft(editorBaseContent);
    setEditorError(null);
    setDocumentUpdateState({ kind: "hidden" });
    setIsEditing(false);
  };

  const saveEdit = useCallback(async () => {
    if (!isDirty || isSaving) {
      return;
    }
    if (isDocumentConflictBlocked) {
      return;
    }

    setIsSaving(true);
    setEditorError(null);
    const returnAnchor = captureEditorSwitchAnchor(
      editorDraft,
      editorRef.current?.getTopVisibleAnchor() ?? { offset: 0, text: "" }
    );
    try {
      const response = await saveDocument({
        content: editorDraft,
        baseContentHash: editorBaseHash
      }, document.absolutePath);
      review.replaceReview(response.review);
      onDocumentChange(response.document);
      setEditorDraft(response.document.content);
      setEditorBaseContent(response.document.content);
      setEditorBaseHash(response.document.contentHash);
      setDocumentUpdateState({ kind: "hidden" });
      pendingReadingAnchorRef.current = returnAnchor;
      setIsEditing(false);
      setFeedback(t("document.saved"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("document.saveFailed");
      if (message.includes("Document was changed outside Margent")) {
        void handleDetectedDocumentChange("external");
      } else {
        setEditorError(message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    document.absolutePath,
    editorBaseHash,
    editorDraft,
    handleDetectedDocumentChange,
    isDocumentConflictBlocked,
    isDirty,
    isSaving,
    onDocumentChange,
    review,
    t
  ]);

  useLayoutEffect(() => {
    if (!isEditing) {
      return;
    }

    const anchor = pendingEditorAnchorRef.current;
    if (!anchor) {
      return;
    }

    pendingEditorAnchorRef.current = null;
    const offset = resolveMarkdownOffset(document.content, anchor);
    editorRef.current?.scrollToOffset(offset);
  }, [document.content, isEditing]);

  useLayoutEffect(() => {
    if (isEditing) {
      return;
    }

    const anchor = pendingReadingAnchorRef.current;
    const container = contentRef.current;
    if (!anchor || !container) {
      return;
    }

    pendingReadingAnchorRef.current = null;
    scrollReadingAnchorIntoView(anchor, container);
  }, [isEditing, document.content]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveEdit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditing, saveEdit]);

  const captureEditorSelection = (selection: MarkdownEditorSelection | null) => {
    if (!selection) {
      setEditorAnnotationDraft(null);
      return;
    }

    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    const selectedText = editorDraft.slice(from, to).trim();
    if (!selectedText) {
      setEditorAnnotationDraft(null);
      return;
    }

    const heading = findHeadingForMarkdownOffset(editorDraft, from);
    setEditorAnnotationDraft({
      selectedText,
      rect: selection.anchorRect,
      anchorRect: selection.anchorRect,
      anchor: {
        kind: "text",
        headingId: heading?.id ?? null,
        headingText: heading?.text ?? null,
        blockId: "editor-source",
        blockIndex: 0,
        startOffset: from,
        endOffset: to,
        selectedText,
        prefix: editorDraft.slice(Math.max(0, from - 40), from),
        suffix: editorDraft.slice(to, to + 40),
        originalSelectedText: selectedText,
        markdownOffset: from,
        anchorPrecision: "exact"
      }
    });
  };

  const createEditorAnnotation = async (body: string) => {
    if (!editorAnnotationDraft) {
      return;
    }

    try {
      if (isDirty) {
        if (isDocumentConflictBlocked) {
          return;
        }
        setIsSaving(true);
        const response = await saveDocument({
          content: editorDraft,
          baseContentHash: editorBaseHash
        }, document.absolutePath);
        review.replaceReview(response.review);
        onDocumentChange(response.document);
        setEditorDraft(response.document.content);
        setEditorBaseContent(response.document.content);
        setEditorBaseHash(response.document.contentHash);
        setDocumentUpdateState({ kind: "hidden" });
        setFeedback(t("document.savedWithAnnotation"));
      }

      await review.create({ body, anchor: editorAnnotationDraft.anchor });
      setEditorAnnotationDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("document.annotationFailed");
      if (message.includes("Document was changed outside Margent")) {
        void handleDetectedDocumentChange("external");
      } else {
        setEditorError(message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const createDocumentAnnotation = async (body: string) => {
    const anchor: ReviewAnchor = {
      kind: "document",
      headingId: null,
      headingText: null,
      selectedText: "",
      anchorPrecision: "heading"
    };
    await review.create({ body, anchor });
    setIsSidebarOpen(true);
    setFeedback(t("document.documentAnnotationAdded"));
  };

  const toggleAutoMonitor = async (enabled: boolean) => {
    if (enabled && !agentLink?.connection.hasTarget) {
      setFeedback(t("toast.needAgentBinding"));
      return;
    }

    try {
      const response = await updateAgentLink({
        bridge: {
          autoSendNewAnnotations: enabled
        }
      }, document.absolutePath);
      setAgentLink(response);
      setAgentLinkError(null);
      setFeedback(enabled ? t("toast.autoMonitorOn") : t("toast.autoMonitorOff"));
    } catch (error) {
      setAgentLinkError(error instanceof Error ? error.message : t("document.autoMonitorUpdateFailed"));
    }
  };

  const copySuccessorConnectionInstruction = async () => {
    try {
      const response = await createAgentSuccessorInstruction(
        document.absolutePath,
        agentLink?.connection.provider ?? "codex"
      );
      await copyText(response.instruction);
      setFeedback(t("toast.copyReconnect"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("document.copyInstructionFailed"));
    }
  };

  const sendAnnotation = async (annotationId: string) => {
    const response = await sendAnnotationToAgent(annotationId, document.absolutePath);
    review.replaceReview(response.review);
    if (response.needsBinding) {
      setFeedback(t("toast.needAgentBinding"));
      return;
    }
    setFeedback(response.ok ? t("toast.agentQueued") : t("toast.agentFailed"));
  };

  const retryEvent = async (eventId: string) => {
    const response = await retryReviewEvent(eventId, document.absolutePath);
    review.replaceReview(response.review);
    setFeedback(response.ok ? t("toast.agentRetryQueued") : t("toast.agentRetryFailed"));
  };

  const toggleAnnotationSidebar = () => {
    const nextOpen = !isSidebarOpen;
    setIsSidebarOpen(nextOpen);
    if (nextOpen) {
      void reloadAgentLink();
    }
  };

  const reloadReviewAndAgentLink = () => {
    void review.reload();
    void reloadAgentLink();
  };

  const applyAvailableDocumentUpdate = () => {
    const source =
      documentUpdateState.kind === "updateAvailable" ? documentUpdateState.source : "unknown";
    void reloadDocumentFromDisk(source, true);
  };

  const toggleConflictDetails = () => {
    setDocumentUpdateState((current) =>
      current.kind === "conflictBlocked"
        ? { ...current, detailsOpen: !current.detailsOpen }
        : current
    );
  };

  const useExternalDocumentVersion = () => {
    if (documentUpdateState.kind !== "conflictBlocked") {
      return;
    }
    if (!window.confirm(t("documentUpdate.useExternalConfirm"))) {
      return;
    }

    setEditorDraft(documentUpdateState.externalContent);
    setEditorBaseContent(documentUpdateState.externalContent);
    setEditorBaseHash(documentUpdateState.externalContentHash);
    setEditorError(null);
    setDocumentUpdateState({ kind: "hidden" });
  };

  const keepEditorDraftVersion = async () => {
    if (documentUpdateState.kind !== "conflictBlocked" || isSaving) {
      return;
    }
    if (!window.confirm(t("documentUpdate.keepMineConfirm"))) {
      return;
    }

    setIsSaving(true);
    setEditorError(null);
    try {
      const response = await saveDocument({
        content: editorDraft,
        baseContentHash: documentUpdateState.externalContentHash
      }, document.absolutePath);
      review.replaceReview(response.review);
      onDocumentChange(response.document);
      setEditorDraft(response.document.content);
      setEditorBaseContent(response.document.content);
      setEditorBaseHash(response.document.contentHash);
      setDocumentUpdateState({ kind: "hidden" });
      setFeedback(t("document.saved"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("document.saveFailed");
      if (message.includes("Document was changed outside Margent")) {
        void handleDetectedDocumentChange("external");
      } else {
        setEditorError(message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={`review-layout${isSidebarOpen ? " review-layout-sidebar-open" : ""}${
        isEditing ? " review-layout-editing" : ""
      }`}
    >
      <div className="document-action-dock" aria-label={t("document.actions")}>
        {isEditing ? (
          <>
            <button
              type="button"
              className={`document-action-button document-action-save${
                isDirty ? " document-action-save-dirty" : ""
              }`}
              aria-label={isSaving ? t("document.saving") : isDirty ? t("document.save") : t("document.saved")}
              title={
                isDocumentConflictBlocked
                  ? t("documentUpdate.saveBlocked")
                  : isSaving
                    ? t("document.saving")
                    : isDirty
                      ? t("document.save")
                      : t("document.saved")
              }
              disabled={!isDirty || isSaving || isDocumentConflictBlocked}
              onClick={saveEdit}
            >
              <Save size={16} />
              <span>{isSaving ? t("document.saving") : t("document.save")}</span>
            </button>
            <button
              type="button"
              className="document-action-button"
              aria-label={t("document.exit")}
              title={t("document.exit")}
              disabled={isSaving}
              onClick={cancelEdit}
            >
              <X size={16} />
              <span>{t("document.exit")}</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="document-action-button"
            aria-label={t("document.edit")}
            title={t("document.edit")}
            onClick={enterEditMode}
          >
            <FilePenLine size={16} />
            <span>{t("document.edit")}</span>
          </button>
        )}
        <button
          type="button"
          className={`document-action-button document-action-button-icon${
            isSidebarOpen ? " document-action-button-active" : ""
          }`}
          aria-label={isSidebarOpen ? t("document.closeAnnotations") : t("document.openAnnotations")}
          aria-expanded={isSidebarOpen}
          title={isSidebarOpen ? t("document.closeAnnotations") : t("document.openAnnotations")}
          onClick={toggleAnnotationSidebar}
        >
          <MessageSquareText size={17} />
          {annotations.length > 0 ? <span>{annotations.length}</span> : null}
        </button>
      </div>
      <div className="review-document-column">
        <div className="document-meta" title={document.relativePath}>
          {document.relativePath}
        </div>
        <DocumentUpdateNotice
          state={documentUpdateState}
          onApplyUpdate={applyAvailableDocumentUpdate}
          onToggleDetails={toggleConflictDetails}
          onUseExternal={useExternalDocumentVersion}
          onKeepMine={() => void keepEditorDraftVersion()}
        />
        {editorError ? <div className="editor-error">{editorError}</div> : null}
        {feedback ? <div className="editor-toast">{feedback}</div> : null}
        {isEditing ? (
          <section className="editor-surface">
            <Suspense
              fallback={
                <div className="markdown-source-editor markdown-source-editor-loading">
                  {t("document.editorLoading")}
                </div>
              }
            >
              <MarkdownSourceEditor
                ref={editorRef}
                value={editorDraft}
                onChange={setEditorDraft}
                onTextSelection={captureEditorSelection}
              />
            </Suspense>
            <AnnotationSelectionToolbar
              draft={editorAnnotationDraft}
              onCancel={() => setEditorAnnotationDraft(null)}
              onCreate={createEditorAnnotation}
            />
          </section>
        ) : (
          <section className="review-document-surface" ref={contentRef}>
            <DocumentViewer document={document} />
            <AnnotationLayer
              annotations={annotations}
              containerRef={contentRef}
              selectedAnnotationId={review.selectedAnnotationId}
              onSelect={selectAnnotation}
            />
            <AnnotationSelectionToolbar
              draft={draft}
              trackSelection
              onCancel={() => setDraft(null)}
              onCreate={async (body) => {
                if (!draft) {
                  return;
                }
                await review.create({ body, anchor: draft.anchor });
                window.getSelection()?.removeAllRanges();
                setDraft(null);
              }}
            />
          </section>
        )}
      </div>
      {isSidebarOpen ? (
        <AnnotationSidebar
          annotations={annotations}
          events={review.state.status === "ready" ? review.state.review.events ?? [] : []}
          agentLink={agentLink}
          agentLinkError={agentLinkError}
          selectedAnnotationId={review.selectedAnnotationId}
          isLoading={review.state.status === "loading"}
          error={review.state.status === "error" ? review.state.message : undefined}
          onSelect={selectAnnotation}
          onReply={review.reply}
          onEditAnnotation={review.editAnnotation}
          onDeleteAnnotation={review.removeAnnotation}
          onEditReply={review.editReply}
          onStatusChange={review.setStatus}
          onCreateDocumentAnnotation={createDocumentAnnotation}
          onToggleAutoMonitor={toggleAutoMonitor}
          onCopySuccessorInstruction={copySuccessorConnectionInstruction}
          onSendToAgent={sendAnnotation}
          onRetryReviewEvent={retryEvent}
          onReload={reloadReviewAndAgentLink}
        />
      ) : null}
    </div>
  );
}

function captureReadingSwitchAnchor(container: HTMLElement | null): SwitchAnchor | null {
  if (!container) {
    return null;
  }

  const selectionAnchor = captureReadingSelectionSwitchAnchor(container);
  if (selectionAnchor) {
    return selectionAnchor;
  }

  const block = getTopVisibleReviewBlock(container);
  if (!block) {
    return null;
  }

  const text = getVisibleBlockText(block);
  if (!text) {
    return null;
  }

  return {
    text,
    headingId: block.dataset.reviewHeadingId || null,
    headingText: block.dataset.reviewHeadingText || null
  };
}

function captureReadingSelectionSwitchAnchor(container: HTMLElement): SwitchAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const selectedText = normalizeText(selection.toString());
  if (!selectedText) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!commonAncestor || !container.contains(commonAncestor)) {
    return null;
  }

  const block = getReviewBlock(range.startContainer);
  return {
    text: selectedText,
    selectedText,
    headingId: block?.dataset.reviewHeadingId || null,
    headingText: block?.dataset.reviewHeadingText || null
  };
}

function captureEditorSwitchAnchor(
  markdown: string,
  visibleAnchor: { offset: number; text: string }
): SwitchAnchor {
  const safeOffset = clamp(visibleAnchor.offset, 0, markdown.length);
  const heading = findHeadingForMarkdownOffset(markdown, safeOffset);
  const visibleText = trimAnchorText(toReadableMarkdownText(visibleAnchor.text));
  return {
    text: visibleText || getMarkdownTextNearOffset(markdown, safeOffset),
    headingId: heading?.id ?? null,
    headingText: heading?.text ?? null,
    markdownOffset: safeOffset
  };
}

function resolveMarkdownOffset(markdown: string, anchor: SwitchAnchor): number {
  const headingOffset = getHeadingOffset(markdown, anchor);
  const selectedOffset = anchor.selectedText
    ? findTextInMarkdown(markdown, anchor.selectedText, headingOffset)
    : -1;
  if (selectedOffset >= 0) {
    return selectedOffset;
  }

  const textOffset = findTextInMarkdown(markdown, anchor.text, headingOffset);
  if (textOffset >= 0) {
    return textOffset;
  }

  return headingOffset >= 0 ? headingOffset : 0;
}

function scrollReadingAnchorIntoView(anchor: SwitchAnchor, container: HTMLElement): void {
  const queries = [anchor.selectedText, anchor.text].filter(Boolean) as string[];
  for (const query of queries) {
    const range = findRangeInRenderedBlocks(container, query, anchor.headingId);
    if (range) {
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        window.scrollBy({
          top: rect.top - 86,
          behavior: "auto"
        });
        return;
      }
    }
  }

  if (anchor.headingId) {
    document.getElementById(anchor.headingId)?.scrollIntoView({
      block: "start",
      behavior: "auto"
    });
  }
}

function getTopVisibleReviewBlock(container: HTMLElement): HTMLElement | null {
  const topBoundary = 72;
  const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-review-block-id]"));
  let bestBlock: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const block of blocks) {
    const text = normalizeText(block.textContent ?? "");
    if (!text) {
      continue;
    }

    const rect = block.getBoundingClientRect();
    if (rect.bottom <= topBoundary || rect.top >= window.innerHeight) {
      continue;
    }

    const score =
      rect.top >= topBoundary ? rect.top - topBoundary : topBoundary - rect.bottom + 48;
    if (score < bestScore) {
      bestScore = score;
      bestBlock = block;
    }
  }

  return bestBlock;
}

function getVisibleBlockText(block: HTMLElement): string {
  const blockText = block.textContent ?? "";
  const visibleOffset = getBlockOffsetNearViewportTop(block);
  return trimAnchorText(blockText.slice(visibleOffset) || blockText);
}

function getBlockOffsetNearViewportTop(block: HTMLElement): number {
  const rect = block.getBoundingClientRect();
  const y = clamp(Math.max(rect.top, 72) + 8, rect.top + 1, rect.bottom - 1);
  const xCandidates = [rect.left + 24, rect.left + rect.width * 0.28, rect.left + rect.width * 0.5];

  for (const x of xCandidates) {
    const range = getCaretRangeFromPoint(x, y);
    if (range && block.contains(range.startContainer)) {
      return getTextOffset(block, range.startContainer, range.startOffset);
    }
  }

  return 0;
}

function getCaretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
  };

  if (doc.caretRangeFromPoint) {
    return doc.caretRangeFromPoint(x, y);
  }

  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) {
    return null;
  }

  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function getMarkdownTextNearOffset(markdown: string, offset: number): string {
  const line = getLineAtOffset(markdown, offset);
  const lineText = trimAnchorText(toReadableMarkdownText(line));
  if (lineText.length >= 8) {
    return lineText;
  }

  const block = getMarkdownBlockAtOffset(markdown, offset);
  return trimAnchorText(toReadableMarkdownText(block));
}

function getLineAtOffset(markdown: string, offset: number): string {
  const start = markdown.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const end = markdown.indexOf("\n", offset);
  return markdown.slice(start, end === -1 ? markdown.length : end);
}

function getMarkdownBlockAtOffset(markdown: string, offset: number): string {
  let start = markdown.lastIndexOf("\n\n", Math.max(0, offset - 1));
  start = start === -1 ? 0 : start + 2;
  let end = markdown.indexOf("\n\n", offset);
  end = end === -1 ? markdown.length : end;
  return markdown.slice(start, end);
}

function getHeadingOffset(markdown: string, anchor: SwitchAnchor): number {
  if (!anchor.headingId && !anchor.headingText) {
    return 0;
  }

  const heading = parseHeadingLocations(markdown).find(
    (item) => item.id === anchor.headingId || item.text === anchor.headingText
  );
  return heading?.offset ?? 0;
}

function findTextInMarkdown(markdown: string, text: string, startOffset: number): number {
  const query = normalizeText(text);
  if (query.length < 4) {
    return -1;
  }

  const exactOffset = markdown.indexOf(query, startOffset);
  if (exactOffset >= 0) {
    return exactOffset;
  }

  const fallbackExactOffset = markdown.indexOf(query);
  if (fallbackExactOffset >= 0) {
    return fallbackExactOffset;
  }

  const markdownIndex = buildSearchableIndex(markdown);
  const queryIndex = buildSearchableIndex(query);
  if (queryIndex.text.length < 4) {
    return -1;
  }

  const normalizedStart = markdownIndex.map.findIndex((offset) => offset >= startOffset);
  const offset = markdownIndex.text.indexOf(queryIndex.text, Math.max(0, normalizedStart));
  if (offset >= 0) {
    return markdownIndex.map[offset] ?? -1;
  }

  const fallbackOffset = markdownIndex.text.indexOf(queryIndex.text);
  return fallbackOffset >= 0 ? markdownIndex.map[fallbackOffset] ?? -1 : -1;
}

function findRangeInRenderedBlocks(
  container: HTMLElement,
  text: string,
  headingId: string | null
): Range | null {
  const query = normalizeText(text);
  if (query.length < 4) {
    return null;
  }

  const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-review-block-id]"));
  const scopedBlocks = headingId
    ? blocks.filter(
        (block) => block.dataset.reviewHeadingId === headingId || block.id === headingId
      )
    : blocks;

  for (const block of scopedBlocks.length > 0 ? scopedBlocks : blocks) {
    const range = createRangeFromRenderedText(block, query);
    if (range) {
      return range;
    }
  }

  return null;
}

function createRangeFromRenderedText(root: HTMLElement, text: string): Range | null {
  const rawText = root.textContent ?? "";
  const exactIndex = rawText.indexOf(text);
  if (exactIndex >= 0) {
    return createRangeFromOffsets(root, exactIndex, exactIndex + text.length);
  }

  const rootIndex = buildNormalizedIndex(rawText);
  const queryIndex = buildNormalizedIndex(text);
  const normalizedIndex = rootIndex.text.indexOf(queryIndex.text);
  if (normalizedIndex < 0) {
    return null;
  }

  const start = rootIndex.map[normalizedIndex] ?? 0;
  const end = rootIndex.map[normalizedIndex + queryIndex.text.length - 1] ?? start;
  return createRangeFromOffsets(root, start, end + 1);
}

function createRangeFromOffsets(
  root: HTMLElement,
  startOffset: number,
  endOffset: number
): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let currentOffset = 0;
  let startSet = false;
  let endSet = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const textLength = node.textContent?.length ?? 0;
    const nextOffset = currentOffset + textLength;

    if (!startSet && startOffset >= currentOffset && startOffset <= nextOffset) {
      range.setStart(node, startOffset - currentOffset);
      startSet = true;
    }

    if (!endSet && endOffset >= currentOffset && endOffset <= nextOffset) {
      range.setEnd(node, endOffset - currentOffset);
      endSet = true;
      break;
    }

    currentOffset = nextOffset;
  }

  return startSet && endSet ? range : null;
}

function buildSearchableIndex(text: string): { text: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "]" && next === "(") {
      index += 2;
      while (index < text.length && text[index] !== ")") {
        index += 1;
      }
      continue;
    }

    if (char === "\\" || char === "`" || char === "*" || char === "[" || char === "]") {
      continue;
    }

    if (char === "#" && isHeadingMarker(text, index)) {
      continue;
    }

    if (/\s/.test(char)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += " ";
        map.push(index);
        lastWasSpace = true;
      }
      continue;
    }

    normalized += char;
    map.push(index);
    lastWasSpace = false;
  }

  return {
    text: normalized.trim().toLowerCase(),
    map
  };
}

function buildNormalizedIndex(text: string): { text: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += " ";
        map.push(index);
        lastWasSpace = true;
      }
      continue;
    }

    normalized += char;
    map.push(index);
    lastWasSpace = false;
  }

  return {
    text: normalized.trim().toLowerCase(),
    map
  };
}

function isHeadingMarker(text: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] !== "\n") {
    if (text[cursor] !== " ") {
      return false;
    }
    cursor -= 1;
  }
  return true;
}

function toReadableMarkdownText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/[*~]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function trimAnchorText(text: string): string {
  const normalized = normalizeText(text);
  return normalized.length > 180 ? normalized.slice(0, 180) : normalized;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getReviewBlock(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-review-block-id]") ?? null;
}

function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
    return range.toString().length;
  } finally {
    range.detach();
  }
}

function findHeadingForMarkdownOffset(markdown: string, targetOffset: number): Heading | null {
  const headings = parseHeadings(markdown);
  let headingIndex = 0;
  let currentHeading: Heading | null = null;
  let offset = 0;
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const lineEnd = offset + line.length;
    if (offset > targetOffset) {
      break;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      const length = fenceMatch[1].length;

      if (!fence) {
        fence = { marker, length };
      } else if (fence.marker === marker && length >= fence.length) {
        fence = null;
      }

      offset = lineEnd + 1;
      continue;
    }

    if (!fence) {
      const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
      if (headingMatch) {
        currentHeading = headings[headingIndex++] ?? currentHeading;
      }
    }

    offset = lineEnd + 1;
  }

  return currentHeading;
}
