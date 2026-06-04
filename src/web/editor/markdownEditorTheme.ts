import { EditorView } from "@codemirror/view";

export const markdownEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "#1f2926",
    fontSize: "15px"
  },
  ".cm-scroller": {
    fontFamily:
      "SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    lineHeight: "1.72",
    padding: "8px 0 30px",
    userSelect: "text"
  },
  ".cm-content": {
    minHeight: "calc(100vh - 208px)",
    padding: "30px 0 44px",
    caretColor: "#0d766e",
    userSelect: "text"
  },
  ".cm-line": {
    padding: "0 max(36px, calc((100% - 1040px) / 2))"
  },
  ".cm-selectionBackground": {
    backgroundColor: "#b7ddd4 !important"
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "#9fd0c4 !important"
  },
  ".cm-searchMatch": {
    backgroundColor: "#fff0b8",
    outline: "1px solid #e6bd4c"
  },
  ".cm-panels": {
    borderColor: "#d2ddd9",
    backgroundColor: "#f7faf8",
    color: "#24362f"
  },
  ".cm-cursor": {
    borderLeftColor: "#0d766e"
  },
  "&.cm-focused": {
    outline: "0"
  }
});
