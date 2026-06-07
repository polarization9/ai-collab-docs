---
name: Margent
description: Local-first Markdown review and Codex collaboration workbench
colors:
  canvas: "#f4f7f5"
  canvas-soft: "#edf3f0"
  paper: "#fcfdfc"
  paper-strong: "#ffffff"
  ink: "#1f2926"
  ink-strong: "#16231f"
  muted: "#61716b"
  border: "#d2ddd9"
  border-strong: "#b9cbc4"
  accent: "#0d766e"
  accent-strong: "#14564c"
  accent-soft: "#e5f3ef"
  warning: "#8a5c19"
  open-bg: "#fff2d7"
  open-text: "#79531c"
  resolved-bg: "#e3f1ec"
  resolved-text: "#2e6b57"
typography:
  headline:
    fontFamily: "SF Pro Text, SF Pro Display, PingFang SC, Hiragino Sans GB, Avenir Next, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 780
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "SF Pro Text, SF Pro Display, PingFang SC, Hiragino Sans GB, Avenir Next, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 720
    lineHeight: 1.25
    letterSpacing: "0"
  body:
    fontFamily: "SF Pro Text, SF Pro Display, PingFang SC, Hiragino Sans GB, Avenir Next, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.72
    letterSpacing: "0"
  label:
    fontFamily: "SF Pro Text, SF Pro Display, PingFang SC, Hiragino Sans GB, Avenir Next, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "0"
  mono:
    fontFamily: "SF Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0"
rounded:
  xs: "5px"
  sm: "7px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.paper-strong}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
    height: "42px"
  button-secondary:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: "38px"
  tab-active:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.md}"
    padding: "0 8px 0 12px"
    height: "38px"
  tab-inactive:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0 8px 0 12px"
    height: "38px"
  input:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Margent

## 1. Overview

**Creative North Star: "The Quiet Document Desk"**

Margent is a local document workbench for careful reading, annotation, light editing, and Codex handoff. The interface should feel native enough that opening a Markdown file is unsurprising, but specific enough that annotation status, Codex state, Mermaid tools, and multi-document switching remain legible.

The system is restrained by default. It uses tonal layers, clear borders, short labels, and familiar controls instead of visual flourish. The document is the main object; app chrome exists to hold state and navigation without competing with the text.

Margent explicitly rejects marketing-page composition, oversized hero typography, decorative illustration, generic SaaS card stacks, and chat-first layouts. The app should feel calm, precise, and capable while staying compact enough for real review work.

**Key Characteristics:**

- Document-first surfaces with app-level chrome kept thin.
- Stable layout boundaries between global app controls, current-document controls, and document content.
- Restrained color with semantic state badges for annotations, Codex delivery, missing files, loading, and save state.
- Native-feeling desktop behavior for opening, restoring, switching, and closing documents.

## 2. Colors

The palette is a cool, quiet paper system with a restrained teal accent used only for primary actions, active state, focus, and a small number of positive states.

### Primary

- **Workbench Teal** (`#0d766e`): used for focused controls, active document indicators, primary hover states, and selected state accents.
- **Deep Action Teal** (`#14564c`): used for primary buttons and high-confidence actions such as opening a file.
- **Soft Teal Wash** (`#e5f3ef`): used for low-emphasis selected surfaces, active tab underlays, and subtle positive backgrounds.

### Neutral

- **Canvas Mist** (`#f4f7f5`): app background. It should read as a quiet desktop canvas, not a tinted marketing backdrop.
- **Sidebar Mist** (`#edf3f0`): secondary layer for sidebars, empty-state recent lists, and non-document chrome.
- **Paper** (`#fcfdfc`) and **White Paper** (`#ffffff`): document and control surfaces.
- **Ink** (`#1f2926`) and **Strong Ink** (`#16231f`): main reading text and high-priority labels.
- **Muted Ink** (`#61716b`): secondary metadata. Keep contrast readable; do not push this lighter for elegance.
- **Fine Border** (`#d2ddd9`) and **Strong Border** (`#b9cbc4`): structure, dividers, focus-adjacent edges.

### Semantic

- **Open Comment** (`#fff2d7` / `#79531c`): unresolved annotation state. It is intentionally warm so unresolved work does not collapse into the teal system.
- **Resolved Comment** (`#e3f1ec` / `#2e6b57`): completed annotation state.
- **Warning Ink** (`#8a5c19`): missing file, blocked restore, or non-destructive warning text.

### Named Rules

**The Accent Rarity Rule.** Teal should not exceed roughly 10% of a normal screen. If a whole panel turns teal, the document loses priority.

**The State Has Two Signals Rule.** Do not rely on color alone. Pair color with label text, icon shape, or placement for annotation and Codex states.

## 3. Typography

**Display Font:** none. Margent is a product interface, not a brand surface.
**Body Font:** SF Pro / system sans with Chinese fallbacks.
**Label/Mono Font:** SF Mono for paths, code-adjacent labels, and compact technical metadata.

**Character:** compact, readable, and familiar. Typography should support long Markdown reading while keeping app controls dense and predictable.

### Hierarchy

- **Headline** (780, 28px, 1.2): empty-state main title, panel headings, and high-level product surfaces. Avoid fluid hero scale.
- **Title** (720, 18px, 1.25): sidebar titles, settings section headings, and document-adjacent panels.
- **Body** (400, 16px, 1.72): Markdown reading content. Keep prose width in the 65-75ch range when possible.
- **Compact Body** (400-560, 13-14px, 1.45): annotation cards, recent document rows, tab labels, and metadata.
- **Label** (650, 12-13px, 1.35): buttons, segmented controls, status badges, menu items.
- **Mono** (500, 12px, 1.45): file paths, code language labels, and technical identifiers.

### Named Rules

**The No Hero Type Rule.** Empty states may be clear and confident, but they must not use landing-page scale. The open-file task is the point, not the headline.

## 4. Elevation

Margent is flat by default and uses tonal layering before shadow. Shadows are reserved for floating surfaces that must visually detach from the document: annotation popovers, context menus, toasts, settings panels, and lightboxes. Static cards and tabs should use borders and background changes instead of ambient drop shadows.

### Shadow Vocabulary

- **Floating Surface** (`0 18px 54px rgba(20, 30, 26, 0.16)`): annotation popovers, settings panels, and modal-like panels.
- **Subtle Lift** (`0 10px 28px rgba(20, 30, 26, 0.10)`): hover or active affordance only when border and tonal change are insufficient.
- **No Shadow**: default for document tabs, recent document rows, sidebars, and document content containers.

### Named Rules

**The Flat At Rest Rule.** If an element is part of the persistent app shell, it should not float. It can become slightly raised on hover, focus, or drag-like interaction.

## 5. Components

### Buttons

- **Shape:** 8px radius for regular buttons; pill radius only for compact badges and segmented controls.
- **Primary:** Deep Action Teal background, white text, 42px height, used for opening a file and committing clear primary actions.
- **Secondary:** White Paper or transparent background, Fine Border, Ink text, 36-38px height.
- **Icon-only:** 32-36px square with transparent or low-tonal background. Use lucide icons and tooltips. The global open-file button in the document tab rail is a light `+` affordance, not a text button.
- **Hover / Focus:** change border and foreground first; use a visible focus ring or strong border. Avoid large shadows on persistent controls.

### Document Tabs

- **Role:** global app-level document carrier. Tabs sit above TOC, reading content, and annotation panels.
- **Active Tab:** White Paper, Strong Ink, 1px Strong Border, 38px height, 8px radius, small active dot or status mark.
- **Inactive Tab:** transparent or Sidebar Mist background, Muted Ink, no shadow.
- **Close Button:** hidden or low-contrast until hover/focus within the tab; never reserve so much space that filenames truncate early.
- **Open Button:** fixed at the right edge of the tab rail, icon-only, 36px square, `+` or file-plus icon. It should not scroll with the tab strip.
- **Overflow:** tab strip scrolls horizontally; active tab stays visible after switching. The right-side open button remains pinned.
- **States:** reserve visual patterns for unsaved, external update, missing file, and annotation count, but do not show fabricated badges when data is unavailable.

### Empty Startup Page

- **Role:** a real app start surface, not a marketing hero.
- **Structure:** global app background, a left recent-documents rail, and a right open-document workspace. Avoid a decorative faux macOS window frame.
- **Main Action:** one primary "Open Markdown file" action with a file icon. Secondary actions stay in the native menu or settings, not in a button cluster.
- **Recent Documents:** compact rows with filename, path or parent folder, last opened time, and a light remove affordance. Missing files stay in place with a warning label and disabled main click.
- **No Recent State:** the recent rail shows a quiet empty row rather than a blank panel.
- **Loading / Restoring:** use skeleton rows or inline loading state. Do not flash an error while the sidecar is starting.
- **Open Failed:** show a short warning below the main action or in the recent row that failed. Keep the user in the same start surface.

### Cards / Containers

- **Corner Style:** 8-12px radius. Do not exceed 16px for app cards or panels.
- **Background:** use Paper / White Paper for content and Sidebar Mist for secondary rails.
- **Border:** 1px Fine Border at rest, Strong Border on active or focused state.
- **Padding:** 16-24px for panels, 10-14px for rows and compact controls.
- **Shadow Strategy:** no shadow for static panels; use Floating Surface only for overlays.

### Inputs / Fields

- **Style:** White Paper background, 8px radius, Fine Border, Ink text.
- **Focus:** Strong Border plus a restrained teal focus treatment.
- **Placeholder:** must meet readable contrast; avoid pale gray on tinted backgrounds.
- **Disabled:** muted foreground and low-tonal background, with visible disabled cursor/state.

### Navigation

- **TOC:** belongs to the active document. It is not part of the global multi-document rail.
- **Tab Rail:** belongs to the app. It should be visually above and structurally separate from TOC and document content.
- **Annotation Panel:** belongs to the active document. It should switch with the active tab.
- **Settings:** global app-level affordance, accessible from native menu and a restrained app control when needed.

### Status Badges

- **Shape:** pill.
- **Typography:** 12-13px label, medium-bold.
- **Content:** include text, not color-only dots.
- **Placement:** near the object whose state it describes. Annotation processing status belongs inside the annotation card; document external-update state belongs on the relevant tab or document status line.

## 6. Do's and Don'ts

### Do:

- **Do** keep the document as the largest and quietest surface on the page.
- **Do** separate global document tabs from current-document TOC, reading, editing, and annotation controls.
- **Do** show empty-state sub-status inline: no recent files, missing recent file, loading, restoring, and open failure should all stay in the same start surface.
- **Do** use borders, tonal layers, and precise spacing before reaching for shadows.
- **Do** pair every state color with a label or icon.
- **Do** keep button, tab, input, badge, and panel radii within the 5-12px system unless a pill badge is intentional.

### Don't:

- **Don't** make the empty page a marketing landing page with hero copy, value-prop sections, decorative illustration, or conversion-focused layout.
- **Don't** create a heavy IDE or full publishing suite that foregrounds toolbars, palettes, and complex configuration over the document.
- **Don't** use generic SaaS dashboard patterns: oversized cards, soft shadow stacks, ornamental metrics, or nested cards.
- **Don't** make Margent chat-first. Codex collaboration is a bridge attached to document annotations, not the primary visual object.
- **Don't** put a faux macOS window frame inside the app canvas. The real desktop shell already provides that context.
- **Don't** let document tabs live inside the document content column. They are global app chrome.
- **Don't** flash an "unable to load" error during normal startup latency. Loading and restore states should appear before error states.
