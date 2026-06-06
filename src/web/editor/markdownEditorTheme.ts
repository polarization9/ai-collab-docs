import { EditorView } from "@codemirror/view";

export const markdownEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--color-ink)",
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
    caretColor: "var(--color-accent)",
    userSelect: "text"
  },
  ".cm-line": {
    padding: "0 max(36px, calc((100% - 1040px) / 2))"
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 26%, transparent) !important"
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 34%, transparent) !important"
  },
  ".cm-searchMatch": {
    backgroundColor: "#fff0b8",
    outline: "1px solid #e6bd4c"
  },
  ".cm-panels": {
    borderColor: "var(--color-border)",
    backgroundColor: "var(--color-canvas)",
    color: "var(--color-ink)"
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-accent)"
  },
  "&.cm-focused": {
    outline: "0"
  }
});
