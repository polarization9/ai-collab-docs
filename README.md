# Margent

Margent is a local-first Markdown reading, annotation, light editing, and Codex collaboration desktop app.

It opens local `.md` and `.markdown` files, renders them for review, supports Mermaid diagrams and wide tables, stores annotations next to the document, and can hand annotation tasks to Codex through local MCP tools.

## Current Status

Margent is in active development. The current desktop build targets macOS 12+ on Apple Silicon.

The local app bundle includes its own Node.js runtime, so people who install the `.app` do not need to install Node.js. Developers building from source still need Node.js, npm, Rust, and the Tauri toolchain.

## Main Features

- Lightweight Markdown reading for local documents, with a focused workspace for review and discussion.
- Light editing inside the reading flow, so small wording and structure fixes do not require switching tools.
- Local-first annotation workflows that keep review context and handling status next to the document.
- Codex collaboration through a local handoff channel, so annotation tasks can be sent to a connected Codex session.
- English and Chinese desktop experience.

## Install From a Release

For a packaged macOS build, download the `Margent_0.1.0_aarch64.dmg` artifact from the GitHub Release page, open it, and drag `Margent.app` into `Applications`.

The current local build is ad-hoc signed. If macOS says the developer cannot be verified, right-click `Margent.app` in Finder and choose `Open`.

After launching Margent for the first time, the recent documents list should include a Quickstart document for the active language. Open it to try reading, annotations, Mermaid, tables, and light editing.

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

On first launch, Margent copies the Quickstart document that matches the active language:

```text
~/Documents/Margent/Margent Quickstart.md
~/Documents/Margent/Margent Quickstart.en.md
```

If the language setting is `system`, Chinese system languages use the Chinese Quickstart. Other system languages use the English Quickstart.

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

## Adoption Metrics

Margent currently uses GitHub Release asset download counts as its public adoption signal. The app does not collect DAU, document metadata, file paths, annotation content, or in-app telemetry.

To inspect release downloads:

```bash
node scripts/report-release-downloads.mjs
```

This script reads GitHub Release asset `download_count` values through the GitHub CLI. It does not collect data from installed apps.

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

## License

License information has not been added yet.

---

# 中文说明

Margent 是一个本地优先的 Markdown 阅读、批注、轻编辑和 Codex 协作桌面 App。

它可以打开本地 `.md` 和 `.markdown` 文件，把 Markdown 渲染成适合审阅的阅读界面，支持 Mermaid 图表和宽表，批注数据保存在文档旁边，并且可以通过本地 MCP 工具把批注任务交给 Codex 处理。

## 当前状态

Margent 正在积极开发中。当前桌面构建面向 macOS 12+，Apple Silicon。

桌面安装包内置 Node.js runtime，普通用户安装 `.app` 后不需要额外安装 Node.js。从源码构建时仍然需要 Node.js、npm、Rust 和 Tauri 工具链。

## 主要功能

- 轻量化 Markdown 阅读，把本地文档变成适合审阅和讨论的工作区。
- 在阅读流程里完成轻编辑，快速修正文案和结构，不需要切换工具。
- 本地优先的批注工作流，把审阅上下文和处理状态留在文档旁边。
- 通过本地协作通道连接 Codex，把批注任务交给已连接的 Codex 会话处理。
- 支持中文和英文桌面体验。

## 从 Release 安装

如果使用已打包的 macOS 版本，请从 GitHub Release 页面下载 `Margent_0.1.0_aarch64.dmg`，打开后把 `Margent.app` 拖入 `Applications`。

当前本地构建使用 ad-hoc 签名。如果 macOS 提示无法验证开发者，可以在 Finder 中右键 `Margent.app`，选择“打开”。

首次启动 Margent 后，最近文件列表里应该会出现一份和当前语言匹配的 Quickstart 文档。打开它可以体验阅读、批注、Mermaid、表格和轻编辑。

## 从源码构建

```bash
npm install
npm run tauri:build
```

打包后的 App 和 DMG 会生成在：

```text
src-tauri/target/release/bundle/macos/Margent.app
src-tauri/target/release/bundle/dmg/Margent_0.1.0_aarch64.dmg
```

运行桌面开发环境：

```bash
npm run tauri:dev
```

运行 Web 和 Server 开发环境：

```bash
npm run dev
```

## Quickstart 示例文档

App 内置一份中文 Quickstart：

```text
examples/Margent Quickstart.md
```

也提供一份英文 Quickstart：

```text
examples/Margent Quickstart.en.md
```

首次启动时，Margent 会根据当前语言复制对应的 Quickstart：

```text
~/Documents/Margent/Margent Quickstart.md
~/Documents/Margent/Margent Quickstart.en.md
```

如果语言设置是 `system`，中文系统语言会使用中文 Quickstart，其他系统语言会使用英文 Quickstart。

## 本地文件

Margent 会把文档相关数据保存在 Markdown 文件旁边：

```text
Document.md
Document.review.json
Document.codex.json
```

- `Document.md` 是 Markdown 正文。
- `Document.review.json` 保存批注、回复、状态和审阅事件。
- `Document.codex.json` 保存本地 Codex 会话连接信息。

Margent 会为桌面 App 启动一个本机 `127.0.0.1` 服务，不会暴露公网或局域网服务。

## Codex 协作

当当前文档已经连接到某个 Codex 会话时，Margent 可以把批注任务发送给 Codex。

首次配置时，可以让 Codex 帮你初始化 Margent。初始化应包括：

- 尽可能把 Margent 设置为 Markdown 文件的默认打开方式。
- 验证 Codex 是否能访问 Margent 批注工具。
- 在需要时把当前 Codex 会话绑定到正在处理的 Markdown 文档。
- 验证一条批注处理闭环。

面向用户的初始化指南在：

```text
docs/Margent Codex 初始化指南.md
```

如果 Codex 看不到 Margent MCP 或 reviewer 工具，它应该明确说明协作通道尚未连接成功，而不是假装已经可以处理批注。

## 采用情况统计

Margent 当前只把 GitHub Release asset 下载量作为公开采用情况指标。App 不采集 DAU、文档元数据、文件路径、批注内容或 App 内 telemetry。

查看 Release 下载量：

```bash
node scripts/report-release-downloads.mjs
```

这个脚本通过 GitHub CLI 读取 GitHub Release asset 的 `download_count`，不会从已安装的 App 中采集数据。

## 验证

开发时常用检查：

```bash
npm run typecheck
npm run build
npm run test
npm run test:e2e
npm run test:install:smoke
```

更完整的 release 检查：

```bash
npm run check:release
```

## 已知限制

- 当前安装包面向 macOS Apple Silicon。
- Release notarization 尚未配置。
- Codex 协作依赖本地 MCP 工具和当前 Codex 环境。
- 当目标 Codex 会话正忙时，自动投递批注任务可能会排队。

## 许可证

许可证信息尚未补充。
