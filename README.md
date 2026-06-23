# Margent

Margent is a local-first desktop workspace for reading, annotating, lightly editing, and handing off Markdown review tasks to AI agents.

It is designed for people who already work through Markdown documents and want a focused review layer without moving files into a cloud platform.

## Main Features

- Lightweight Markdown reading for local `.md` and `.markdown` files.
- In-document annotations for review, discussion, and resolution tracking.
- Light editing inside the reading flow for small wording or structure fixes.
- Agent collaboration through a local handoff channel for annotation tasks.
- Local-first storage: annotations and Agent linkage stay next to the Markdown document.

## Quick Start

Download the latest `Margent_*_aarch64.dmg` artifact from the GitHub Release page, open it, and drag `Margent.app` into `Applications`.

GitHub release builds are signed with Apple Developer ID and notarized. If macOS still shows a warning after a manual local build, right-click `Margent.app` in Finder and choose `Open`.

After launching Margent for the first time, the recent documents list should include a Quickstart document for the active language. Open it to try reading, annotations, Mermaid, tables, and light editing.

## Build From Source

```bash
npm install
npm run tauri:build
```

The packaged app and DMG are generated under:

```text
src-tauri/target/release/bundle/macos/Margent.app
src-tauri/target/release/bundle/dmg/Margent_<version>_aarch64.dmg
```

To run the desktop app in development:

```bash
npm run tauri:dev
```

## Local Files

Margent keeps document-related data next to the Markdown file:

```text
Document.md
Document.review.json
Document.margent-agent.json
```

- `Document.md` is the Markdown source.
- `Document.review.json` stores annotations, replies, status, and review events.
- `Document.margent-agent.json` stores local Agent session linkage.
- Existing `Document.codex.json` files are still read for Codex compatibility.

Margent starts a local `127.0.0.1` service for the desktop app. It does not expose a public network service.

## Agent Collaboration

Margent can send annotation tasks to a connected Agent session. Codex is the first fully supported provider and remains the default provider for automatic collaboration.

For first setup, ask Codex to initialize Margent on your machine and read [Margent Codex 初始化指南.md](docs/Margent%20Codex%20初始化指南.md). The initialization should cover:

- installing or verifying Margent;
- setting Margent as the default app for Markdown files when possible;
- installing or repairing the Codex MCP registration in `~/.codex/config.toml`;
- verifying that Codex can access Margent review tools;
- binding the current Codex session to the active Markdown document when needed;
- verifying one annotation handling loop.

If Codex cannot see Margent MCP or reviewer tools, ask it to execute the "安装 / 修复 Codex MCP 连接" section in the initialization guide. Codex should say that the collaboration channel is not connected instead of pretending it can process annotations.

## Adoption Metrics

Margent currently uses GitHub Release asset download counts as its public adoption signal. The app does not collect DAU, document metadata, file paths, annotation content, or in-app telemetry.

To inspect release downloads:

```bash
node scripts/report-release-downloads.mjs
```

## Acknowledgements

Margent's Markdown source editing experience is built with [CodeMirror 6](https://codemirror.net/) and the CodeMirror Markdown language package. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license notices.

## License

Margent is released under the MIT License. See [LICENSE](LICENSE).

---

# 中文说明

Margent 是一个本地优先的桌面工作区，用来阅读 Markdown、添加批注、做轻量编辑，并把文档审阅任务交给 AI Agent。

它适合已经围绕 Markdown 文档工作的人：不需要把文档迁移到云端平台，也可以获得一个更适合审阅、讨论和交给 AI Agent 修改的工作流。

## 主要能力

- 轻量化阅读本地 `.md` 和 `.markdown` 文件。
- 在文档中添加批注，用于审阅、讨论和解决状态追踪。
- 在阅读流程中做轻编辑，适合小范围文案或结构调整。
- 通过本地协作通道把批注任务交给 Agent。
- 本地优先存储：批注和 Agent 连接信息都保存在 Markdown 文档旁边。

## 快速开始

从 GitHub Release 页面下载最新的 `Margent_*_aarch64.dmg`，打开后把 `Margent.app` 拖到 `Applications`。

GitHub Release 构建已使用 Apple Developer ID 签名并通过 notarization。如果你运行的是本机手动构建，macOS 仍可能提示无法验证开发者，可以在 Finder 里右键 `Margent.app`，选择 `打开`。

首次启动 Margent 后，最近文件列表里会出现一份和当前语言匹配的 Quickstart 文档。打开它可以体验阅读、批注、Mermaid、表格和轻编辑。

## 从源码构建

```bash
npm install
npm run tauri:build
```

打包后的 app 和 DMG 会生成在：

```text
src-tauri/target/release/bundle/macos/Margent.app
src-tauri/target/release/bundle/dmg/Margent_<version>_aarch64.dmg
```

开发模式运行桌面 App：

```bash
npm run tauri:dev
```

## 本地文件

Margent 会把文档相关数据保存在 Markdown 文件旁边：

```text
Document.md
Document.review.json
Document.margent-agent.json
```

- `Document.md` 是 Markdown 正文。
- `Document.review.json` 保存批注、回复、状态和投递事件。
- `Document.margent-agent.json` 保存本地 Agent 会话连接信息。
- 已有的 `Document.codex.json` 仍会作为 Codex 兼容文件读取。

Margent 会为桌面 App 启动一个本地 `127.0.0.1` 服务，不会暴露公网服务。

## Agent 协作

当当前文档已经连接到 Agent 会话时，Margent 可以把批注任务交给 Agent 处理。Codex 是当前第一个完整支持的 provider，也是自动协作的默认 provider。

首次配置时，可以让 Codex 阅读 [Margent Codex 初始化指南.md](docs/Margent%20Codex%20初始化指南.md)，并帮你完成：

- 安装或确认 Margent 可用；
- 在可能的情况下，将 Margent 设置为 Markdown 文件默认打开方式；
- 在 `~/.codex/config.toml` 中安装或修复 Codex MCP 注册；
- 确认 Codex 可以访问 Margent 的批注工具；
- 在需要时，把当前 Codex 会话绑定到正在处理的 Markdown 文档；
- 用一条真实或测试批注验证协作链路。

如果 Codex 看不到 Margent MCP 或 reviewer 工具，请让它执行初始化指南里的“安装 / 修复 Codex MCP 连接”章节。协作通道尚未连接时，Codex 需要明确说明，不能假装已经可以处理批注。

## 使用数据

Margent 当前只使用 GitHub Release asset 下载量作为公开采用信号。App 不统计 DAU，不收集文档元数据、文件路径、批注内容或应用内遥测。

查看 release 下载量：

```bash
node scripts/report-release-downloads.mjs
```

## 致谢

Margent 的 Markdown 轻编辑能力基于 [CodeMirror 6](https://codemirror.net/) 和 CodeMirror Markdown language package。许可证说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

Margent 使用 MIT License 发布。见 [LICENSE](LICENSE)。
