import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { createMarkdownEditorExtensions } from "../../editor/createMarkdownEditorExtensions";

export type MarkdownEditorSelection = {
  selectedText: string;
  from: number;
  to: number;
  anchorRect: DOMRect;
};

export type MarkdownSourceEditorHandle = {
  getTopVisibleAnchor: () => { offset: number; text: string };
  getTopVisibleOffset: () => number;
  scrollToOffset: (offset: number) => void;
};

type MarkdownSourceEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onTextSelection?: (selection: MarkdownEditorSelection | null) => void;
  readOnly?: boolean;
};

export const MarkdownSourceEditor = forwardRef<MarkdownSourceEditorHandle, MarkdownSourceEditorProps>(
  function MarkdownSourceEditor(
    {
      value,
      onChange,
      onTextSelection,
      readOnly = false
    }: MarkdownSourceEditorProps,
    ref
  ) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onTextSelectionRef = useRef(onTextSelection);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onTextSelectionRef.current = onTextSelection;
  }, [onTextSelection]);

  useImperativeHandle(ref, () => ({
    getTopVisibleAnchor() {
      const view = viewRef.current;
      const container = containerRef.current;
      if (!view || !container) {
        return { offset: 0, text: "" };
      }

      const lineElements = Array.from(container.querySelectorAll<HTMLElement>(".cm-line"));
      const topBoundary = 72;
      const line =
        lineElements.find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > topBoundary && rect.top < window.innerHeight && element.textContent?.trim();
        }) ?? null;
      const lineRect = line?.getBoundingClientRect();
      const offset = lineRect
        ? view.posAtCoords({
            x: lineRect.left + Math.min(180, Math.max(32, lineRect.width * 0.18)),
            y: lineRect.top + lineRect.height / 2
          })
        : null;

      return {
        offset: offset ?? view.state.selection.main.head,
        text: line?.textContent?.trim() ?? ""
      };
    },
    getTopVisibleOffset() {
      const view = viewRef.current;
      if (!view) {
        return 0;
      }

      const rect = view.scrollDOM.getBoundingClientRect();
      const offset = view.posAtCoords({
        x: rect.left + Math.min(180, Math.max(48, rect.width * 0.2)),
        y: Math.max(rect.top, 72) + 18
      });
      return offset ?? view.state.selection.main.head;
    },
    scrollToOffset(offset: number) {
      const view = viewRef.current;
      if (!view) {
        return;
      }

      const position = Math.max(0, Math.min(offset, view.state.doc.length));
      view.dispatch({
        effects: EditorView.scrollIntoView(position, {
          y: "start",
          yMargin: 72
        })
      });
    }
  }), []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...createMarkdownEditorExtensions(),
          EditorState.readOnly.of(readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              onTextSelectionRef.current?.(getEditorSelection(update.view));
            }
          })
        ]
      })
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value
      }
    });
  }, [value]);

    return <div className="markdown-source-editor" ref={containerRef} />;
  }
);

function getEditorSelection(view: EditorView): MarkdownEditorSelection | null {
  const selection = view.state.selection.main;
  if (selection.empty) {
    return null;
  }

  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  const selectedText = view.state.doc.sliceString(from, to).trim();
  if (!selectedText) {
    return null;
  }

  const coords = view.coordsAtPos(to) ?? view.coordsAtPos(from);
  if (!coords) {
    return null;
  }

  return {
    selectedText,
    from,
    to,
    anchorRect: new DOMRect(
      coords.left,
      coords.top,
      Math.max(1, coords.right - coords.left),
      Math.max(1, coords.bottom - coords.top)
    )
  };
}
