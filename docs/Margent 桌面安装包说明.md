# Margent 桌面安装包说明

## 目标安装包

- 平台：macOS 12+，Apple Silicon
- 预计产物：`src-tauri/target/release/bundle/dmg/Margent_0.1.0_aarch64.dmg`
- 运行依赖：无需额外安装 Node.js

> 说明：桌面安装包由后续桌面壳阶段产出。本说明记录目标安装体验和验证清单，不代表当前文档规划 PR 已经包含 `.app` 或 `.dmg` 构建产物。

## 安装方式

1. 桌面壳阶段完成打包后，双击打开 `.dmg`。
2. 将 `Margent.app` 拖入 `Applications`。
3. 第一次启动如果 macOS 提示无法验证开发者，可以在 Finder 中右键 App，选择“打开”。

## 打开 Markdown 文件

- 在 App 内点击“打开文件”选择 `.md` 或 `.markdown`。
- 首次启动后，最近文件中会出现一份和当前语言匹配的 Quickstart 文档，可以直接点击体验阅读、批注、Mermaid、表格和轻编辑。
- 也可以在 Finder 中右键 Markdown 文件，选择“打开方式”里的 `Margent`。
- 如果希望设为默认打开方式，可以在 Finder 中选中文件，打开“显示简介”，在“打开方式”里选择本 App，并点击“全部更改”。
- 如果希望让 Codex 帮忙完成默认打开方式和 MCP 初始化，可以让 Codex 读取 `docs/Margent Codex 初始化指南.md` 后执行。

## 数据说明

- 批注和审阅数据仍保存到 Markdown 文件旁边的本地 review 文件中。
- App 只启动本机 `127.0.0.1` 服务，不暴露局域网端口。
- 当前版本未做 Apple Developer ID 签名和 notarization，适合内部试用分发。
