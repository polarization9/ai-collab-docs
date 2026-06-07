# Product

## Register

product

## Users

Margent is for people who produce, read, review, and revise Markdown documents as part of an ongoing thinking or building workflow. The primary user is already working locally with files and Codex: they open a Markdown document, read it carefully, leave comments, make light edits, and ask Codex to answer or apply changes with the original conversation context where possible.

The usage context is focused and task-oriented. Users may be reviewing product PRDs, technical documents, architecture notes, Mermaid diagrams, tables, and Codex-generated drafts. They need the app to feel like a quiet document workbench, not a publishing tool, marketing site, or heavyweight editor.

## Product Purpose

Margent is a local-first Markdown review and AI collaboration app. It opens local `.md` and `.markdown` files, renders them for comfortable reading, supports Mermaid and code-heavy documents, lets users create and manage annotations, and connects annotation work back to Codex through local MCP and bridge capabilities.

Success means a user can open a document without remembering ports or commands, review it without losing reading flow, capture comments exactly where they belong, and let Codex process those comments through the right document and conversation context. The product should reduce copy-paste coordination between Markdown files and Codex chats while keeping the document itself as the source of truth.

## Brand Personality

Margent should feel calm, precise, and capable.

The interface should communicate expert restraint: clear enough to trust, refined enough for long sessions, and modest enough that the document remains the main object. It should feel closer to a native document workbench than a SaaS dashboard. The product voice is direct and functional, with short labels, concrete states, and no promotional flourish.

## Anti-references

Margent should not look or behave like:

- A marketing landing page with hero copy, value-prop sections, decorative illustration, or conversion-focused layout.
- A heavy IDE or full publishing suite that foregrounds toolbars, palettes, and complex configuration over the document.
- A generic SaaS dashboard with oversized cards, soft shadows, rounded container stacks, and ornamental metrics.
- A chat-first product where the document becomes secondary to an assistant panel.
- A design demo that prioritizes visual novelty over stable reading, annotation, and editing behavior.

Avoid product patterns that make local files feel remote, abstract, or platform-owned. Avoid hiding important document states behind decorative UI.

## Design Principles

1. Document first, tools second.
   The Markdown content is always the primary surface. Controls should appear where they help the task and stay quiet when the user is reading.

2. Local files should feel native and dependable.
   Opening, switching, restoring, and saving documents should behave like a desktop document app. The user should not need to think about localhost, sidecars, ports, or hidden service state.

3. State beats decoration.
   Annotation status, Codex connection state, save state, external updates, loading, and missing files must be legible and stable. Color and motion should support state, not decorate the page.

4. Multi-document is a global workbench layer.
   Open documents belong to the app shell, while the table of contents, reading area, annotations, and edit controls belong to the active document. Switching documents should preserve this mental model.

5. AI collaboration is a bridge, not a takeover.
   Margent connects document annotations to Codex and lets Codex act through explicit local tools. It should not invent hidden context, summarize conversations by default, or make the assistant feel more important than the document.

## Accessibility & Inclusion

Margent should target WCAG 2.1 AA for core reading and interaction surfaces. Body text, muted text, form placeholders, badges, and state labels need sufficient contrast across supported themes.

Keyboard access is required for document-level actions such as opening files, closing dialogs, saving edits, switching controls, and operating annotation workflows where feasible. Focus states should be visible and consistent. Motion should be short, purposeful, and compatible with reduced-motion settings. Color must not be the only indicator for annotation status, Codex delivery state, errors, or missing files.
