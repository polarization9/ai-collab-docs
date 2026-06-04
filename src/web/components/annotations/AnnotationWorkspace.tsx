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
import type { ReviewAnchor, ReviewFile } from "../../../shared/reviewTypes";
import type { CodexLinkResponse } from "../../../shared/codexTypes";
import type { Heading, ReviewDocument } from "../../../shared/types";
import {
  createSuccessorInstruction,
  fetchCodexLink,
  retryReviewEvent,
  saveDocument,
  sendAnnotationToCodex,
  updateCodexLink
} from "../../api";
import type { AnnotationDraft } from "../../review/anchorCapture";
import { captureAnnotationDraft } from "../../review/anchorCapture";
import { scrollToAnnotation } from "../../review/anchorResolve";
import { useReview } from "../../hooks/useReview";
import { copyText } from "../../utils/clipboard";
import { DocumentViewer } from "../DocumentViewer";
import type {
  MarkdownEditorSelection,
  MarkdownSourceEditorHandle
} from "../editor/MarkdownSourceEditor";
import { AnnotationLayer } from "./AnnotationLayer";
import { AnnotationSelectionToolbar } from "./AnnotationSelectionToolbar";
import { AnnotationSidebar } from "./AnnotationSidebar";

const MarkdownSourceEditor = lazy(() =>
  import("../editor/MarkdownSourceEditor").then((module) => ({
    default: module.MarkdownSourceEditor
  }))
);

type AnnotationWorkspaceProps = {
  document: ReviewDocument;
  initialReview?: ReviewFile | null;
  initialCodexLink?: CodexLinkResponse | null;
  onDocumentChange: (document: ReviewDocument) => void;
};

type SwitchAnchor = {
  text: string;
  selectedText?: string;
  headingId: string | null;
  headingText: string | null;
  markdownOffset?: number;
};

export function AnnotationWorkspace({
  document,
  initialReview = null,
  initialCodexLink = null,
  onDocumentChange
}: AnnotationWorkspaceProps) {
  const contentRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<MarkdownSourceEditorHandle | null>(null);
  const pendingEditorAnchorRef = useRef<SwitchAnchor | null>(null);
  const pendingReadingAnchorRef = useRef<SwitchAnchor | null>(null);
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const [editorAnnotationDraft, setEditorAnnotationDraft] = useState<AnnotationDraft | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editorDraft, setEditorDraft] = useState(document.content);
  const [editorBaseContent, setEditorBaseContent] = useState(document.content);
  const [editorBaseHash, setEditorBaseHash] = useState(document.contentHash);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [codexLink, setCodexLink] = useState<CodexLinkResponse | null>(initialCodexLink);
  const [codexLinkError, setCodexLinkError] = useState<string | null>(null);
  const review = useReview(document.id, initialReview);
  const isDirty = editorDraft !== editorBaseContent;
  const annotations = useMemo(
    () => (review.state.status === "ready" ? review.state.review.annotations : []),
    [review.state]
  );

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

  const reloadCodexLink = useCallback(async () => {
    try {
      setCodexLink(await fetchCodexLink());
      setCodexLinkError(null);
    } catch (error) {
      setCodexLink(null);
      setCodexLinkError(error instanceof Error ? error.message : "连接状态加载失败");
    }
  }, []);

  useEffect(() => {
    if (initialCodexLink) {
      setCodexLink(initialCodexLink);
      setCodexLinkError(null);
      return;
    }

    void reloadCodexLink();
  }, [document.id, initialCodexLink, reloadCodexLink]);

  const captureSelection = () => {
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
  };

  const selectAnnotation = (annotationId: string) => {
    setIsSidebarOpen(true);
    review.setSelectedAnnotationId(annotationId);
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
    setEditorDraft(document.content);
    setEditorBaseContent(document.content);
    setEditorBaseHash(document.contentHash);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (isDirty && !window.confirm("当前有未保存修改，确定放弃吗？")) {
      return;
    }

    pendingReadingAnchorRef.current = captureEditorSwitchAnchor(
      editorDraft,
      editorRef.current?.getTopVisibleAnchor() ?? { offset: 0, text: "" }
    );
    setEditorDraft(editorBaseContent);
    setEditorError(null);
    setIsEditing(false);
  };

  const saveEdit = useCallback(async () => {
    if (!isDirty || isSaving) {
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
      });
      review.replaceReview(response.review);
      onDocumentChange(response.document);
      setEditorDraft(response.document.content);
      setEditorBaseContent(response.document.content);
      setEditorBaseHash(response.document.contentHash);
      pendingReadingAnchorRef.current = returnAnchor;
      setIsEditing(false);
      setFeedback("保存成功");
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [editorBaseHash, editorDraft, isDirty, isSaving, onDocumentChange, review]);

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
        suffix: editorDraft.slice(to, to + 40)
      }
    });
  };

  const createEditorAnnotation = async (body: string) => {
    if (!editorAnnotationDraft) {
      return;
    }

    try {
      if (isDirty) {
        setIsSaving(true);
        const response = await saveDocument({
          content: editorDraft,
          baseContentHash: editorBaseHash
        });
        review.replaceReview(response.review);
        onDocumentChange(response.document);
        setEditorDraft(response.document.content);
        setEditorBaseContent(response.document.content);
        setEditorBaseHash(response.document.contentHash);
        setFeedback("已保存并添加批注");
      }

      await review.create({ body, anchor: editorAnnotationDraft.anchor });
      setEditorAnnotationDraft(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "添加批注失败");
    } finally {
      setIsSaving(false);
    }
  };

  const createDocumentAnnotation = async (body: string) => {
    const anchor: ReviewAnchor = {
      kind: "document",
      headingId: null,
      headingText: null,
      selectedText: ""
    };
    await review.create({ body, anchor });
    setIsSidebarOpen(true);
    setFeedback("已添加全文批注");
  };

  const toggleAutoMonitor = async (enabled: boolean) => {
    if (enabled && !codexLink?.connection.hasTarget) {
      setFeedback("请先连接来源或接续对话");
      return;
    }

    try {
      const response = await updateCodexLink({
        bridge: {
          autoSendNewAnnotations: enabled
        }
      });
      setCodexLink(response);
      setCodexLinkError(null);
      setFeedback(enabled ? "自动监控已开启" : "自动监控已关闭");
    } catch (error) {
      setCodexLinkError(error instanceof Error ? error.message : "自动监控更新失败");
    }
  };

  const copySuccessorConnectionInstruction = async () => {
    try {
      const response = await createSuccessorInstruction();
      await copyText(response.instruction);
      setFeedback("指令复制成功，粘贴到目标会话发送给 Codex 即可重连");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "复制接续指令失败");
    }
  };

  const sendAnnotation = async (annotationId: string) => {
    const response = await sendAnnotationToCodex(annotationId);
    review.replaceReview(response.review);
    if (response.needsBinding) {
      setFeedback("请先连接来源或接续对话");
      return;
    }
    setFeedback(response.ok ? "已加入 Codex 队列" : "投递失败，已保留重试入口");
  };

  const retryEvent = async (eventId: string) => {
    const response = await retryReviewEvent(eventId);
    review.replaceReview(response.review);
    setFeedback(response.ok ? "已重新加入 Codex 队列" : "重试失败，稍后可再试");
  };

  return (
    <div
      className={`review-layout${isSidebarOpen ? " review-layout-sidebar-open" : ""}${
        isEditing ? " review-layout-editing" : ""
      }`}
    >
      <div className="document-action-dock" aria-label="文档操作">
        {isEditing ? (
          <>
            <button
              type="button"
              className={`document-action-button document-action-save${
                isDirty ? " document-action-save-dirty" : ""
              }`}
              aria-label={isSaving ? "保存中" : isDirty ? "保存修改" : "已保存"}
              title={isSaving ? "保存中" : isDirty ? "保存修改" : "已保存"}
              disabled={!isDirty || isSaving}
              onClick={saveEdit}
            >
              <Save size={16} />
              <span>{isSaving ? "保存中" : "保存"}</span>
            </button>
            <button
              type="button"
              className="document-action-button"
              aria-label="退出编辑"
              title="退出编辑"
              disabled={isSaving}
              onClick={cancelEdit}
            >
              <X size={16} />
              <span>退出</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="document-action-button"
            aria-label="编辑文档"
            title="编辑文档"
            onClick={enterEditMode}
          >
            <FilePenLine size={16} />
            <span>编辑</span>
          </button>
        )}
        <button
          type="button"
          className={`document-action-button document-action-button-icon${
            isSidebarOpen ? " document-action-button-active" : ""
          }`}
          aria-label={isSidebarOpen ? "收起批注列表" : "打开批注列表"}
          aria-expanded={isSidebarOpen}
          title={isSidebarOpen ? "收起批注列表" : "打开批注列表"}
          onClick={() => setIsSidebarOpen((current) => !current)}
        >
          <MessageSquareText size={17} />
          {annotations.length > 0 ? <span>{annotations.length}</span> : null}
        </button>
      </div>
      <div className="review-document-column">
        <div className="document-meta" title={document.relativePath}>
          {document.relativePath}
        </div>
        {editorError ? <div className="editor-error">{editorError}</div> : null}
        {feedback ? <div className="editor-toast">{feedback}</div> : null}
        {isEditing ? (
          <section className="editor-surface">
            <Suspense
              fallback={
                <div className="markdown-source-editor markdown-source-editor-loading">
                  Loading editor...
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
          <section
            className="review-document-surface"
            ref={contentRef}
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
          >
            <DocumentViewer document={document} />
            <AnnotationLayer
              annotations={annotations}
              containerRef={contentRef}
              selectedAnnotationId={review.selectedAnnotationId}
              onSelect={selectAnnotation}
            />
            <AnnotationSelectionToolbar
              draft={draft}
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
          codexLink={codexLink}
          codexLinkError={codexLinkError}
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
          onSendToCodex={sendAnnotation}
          onRetryReviewEvent={retryEvent}
          onReload={review.reload}
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
