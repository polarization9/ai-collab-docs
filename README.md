# Margent

Margent is a local-first Markdown reading, annotation, light editing, and Codex collaboration desktop app.

It opens local `.md` and `.markdown` files, renders them for review, supports Mermaid diagrams and wide tables, stores annotations next to the document, and can hand annotation tasks to Codex through local MCP tools.

## Current Status

Margent is in active development. The current desktop build targets macOS 12+ on Apple Silicon.

The local app bundle includes its own Node.js runtime, so people who install the `.app` do not need to install Node.js. Developers building from source still need Node.js, npm, Rust, and the Tauri toolchain.

## Main Features

- Open local `.md` and `.markdown` files.
- Restore and switch between multiple open documents with a tab bar.
- Read rendered Markdown with Mermaid diagrams, copyable code blocks, and horizontally scrollable tables.
- Resize table columns while reading.
- Create text annotations, replies, nested replies, and resolved or unresolved states.
- Edit annotations and replies.
- Make lightweight Markdown edits and save with `Ctrl+S`.
- Store review data locally in `.review.json` files next to the Markdown document.
- Store Codex session links locally in `.codex.json` files next to the Markdown document.
- Use English or Chinese UI copy.
- Use bundled themes: default, blue-white, and gray-white.

## Install From a Release

For a packaged macOS build, download the `Margent_0.1.0_aarch64.dmg` artifact from the GitHub Release page, open it, and drag `Margent.app` into `Applications`.

The current local build is ad-hoc signed. If macOS says the developer cannot be verified, right-click `Margent.app` in Finder and choose `Open`.

After launching Margent for the first time, the recent documents list should include `Margent Quickstart.md`. Open it to try reading, annotations, Mermaid, tables, and light editing.

## Build From Source

```bash
npm install
npm run tauri:build
```

The packaged app and DMG are generated under:

```text
src-tauri/target/release/bundle/macos/Margent.app
src-tauri/target/release/bundle/dmg/Margent_0.1.0_aarch64.dmg
```

To run the desktop app in development:

```bash
npm run tauri:dev
```

To run the web and server development setup:

```bash
npm run dev
```

## Quickstart Documents

The app includes a Chinese quickstart document:

```text
examples/Margent Quickstart.md
```

An English version is also available:

```text
examples/Margent Quickstart.en.md
```

On first launch, Margent currently copies the Chinese quickstart to:

```text
~/Documents/Margent/Margent Quickstart.md
```

If you prefer the English quickstart, open `examples/Margent Quickstart.en.md` manually from the repository or from a packaged copy.

## Local Files

Margent keeps document-related data next to the Markdown file:

```text
Document.md
Document.review.json
Document.codex.json
```

- `Document.md` is the Markdown source.
- `Document.review.json` stores annotations, replies, status, and review events.
- `Document.codex.json` stores local Codex session linkage.

Margent starts a local `127.0.0.1` service for the desktop app. It does not expose a public network service.

## Codex Collaboration

Margent can send annotation tasks to Codex when the current document is connected to a Codex session.

For a first setup, ask Codex to initialize Margent on your machine. The initialization should cover:

- Setting Margent as the default app for Markdown files when possible.
- Verifying that Codex can access Margent review tools.
- Binding the current Codex session to the active Markdown document when needed.
- Verifying one annotation handling loop.

The detailed product-facing initialization guide is in:

```text
docs/Margent Codex 初始化指南.md
```

If Codex cannot see Margent MCP or reviewer tools, it should say that the collaboration channel is not connected instead of pretending it can process annotations.

## Verification

Useful checks while developing:

```bash
npm run typecheck
npm run build
npm run test
npm run test:e2e
npm run test:install:smoke
```

The broader release check is:

```bash
npm run check:release
```

## Known Limitations

- The current packaged app targets macOS Apple Silicon.
- Release notarization is not yet configured.
- Codex handoff depends on local MCP and the current Codex environment.
- Automatic Codex event delivery can queue when the target Codex session is busy.
- The first-launch quickstart currently defaults to the Chinese document.

## License

License information has not been added yet.
