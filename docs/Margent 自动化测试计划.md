# Margent 自动化测试计划

## 1. 文档信息

- 产品名称：Margent
- 模块名称：自动化测试体系
- 文档日期：2026-06-06
- 当前状态：测试计划草案
- 适用范围：本地 Markdown 阅读、批注、轻编辑、Tauri 桌面外壳、MCP / Codex 协作桥接

## 2. 背景

Margent 已经从 localhost 原型演进为本地优先的 Tauri 桌面 App，功能面覆盖 Markdown 阅读、Mermaid 增强、表格交互、批注、回复、轻编辑、多文档、主题、多语言、文件关联、MCP 工具和 Codex 自动投递。

当前验证方式主要依赖人工试用、`npm run typecheck`、`npm run build`、`npm run tauri:build` 和少量手工安装校验。随着功能之间的连接变多，单靠人工试用容易漏掉边界问题，尤其是文件路径、启动时序、批注锚点、事件队列和桌面打包相关问题。

这份计划的目标是建立一套“够用、可持续、贴近真实使用路径”的自动化测试体系，优先覆盖已经暴露过问题的本质风险，而不是为每个 UI 细节堆大量脆弱用例。

## 3. 测试目标

### 3.1 核心目标

- 确保 Markdown 文件可以稳定打开、读取、编辑和保存。
- 确保批注数据和正文之间的连接可靠，包括创建、回复、二级回复、编辑、删除、open / resolved 状态、锚点恢复。
- 确保 Mermaid、代码块、表格、本地图片等阅读增强能力不会被常规改动破坏。
- 确保 Codex Link、Review Event、MCP 工具和 Bridge 投递之间的合同稳定。
- 确保 Tauri 打包产物可安装、品牌字段正确、文件关联和 sidecar 基础能力可用。
- 在每次提交、PR、打包安装前有清晰的自动化准入门槛。

### 3.2 非目标

- 第一阶段不做完整跨平台测试，先以当前 macOS Apple Silicon 为主。
- 第一阶段不追求像素级视觉回归，只覆盖明显布局破坏、关键按钮消失、文本重叠和主要状态错误。
- 第一阶段不真实调用 Codex 远端服务做稳定性测试，Bridge 先通过 fake adapter / fake app server 验证投递合同。
- 第一阶段不为所有异常做复杂兜底测试，只覆盖高风险路径和已经出现过的真实 bad case。

## 4. 从已知 Bad Case 提炼测试边界

### 4.1 本地路径和 URL 边界

已出现问题：

- 本地图片路径没有 decode，导致 `%20`、中文路径、空格路径加载失败。
- 打开文件时出现过 `Unable to load document` 的启动闪现。

本质问题：

- WebView URL、文件系统路径、Markdown 引用路径和 API 请求参数之间存在编码边界。
- 启动流程里 server readiness、文档路径注入、前端首次请求之间存在时序边界。

测试策略：

- 所有文件读取、图片解析、文档打开测试都必须包含中文路径、空格路径和 URL encoded 路径。
- 桌面启动 smoke test 要验证首屏不会短暂进入错误态。

### 4.2 本地安全边界

已出现问题：

- desktop token 曾在 localhost 场景下被绕过。

本质问题：

- 本机 App 不是天然可信边界，localhost 请求也需要明确鉴权和来源判断。

测试策略：

- Server API 集成测试必须覆盖无 token、错 token、正确 token 三种请求。
- 需要明确哪些 API 允许无 token，哪些 API 必须拒绝。

### 4.3 并发写入边界

已出现问题：

- `.review.json` 使用固定 tmp 文件导致并发写冲突。

本质问题：

- 本地优先并不等于单线程；用户操作、外部编辑、Codex 写入、自动刷新可能同时触发读写。

测试策略：

- Review 写入测试需要包含并发创建批注、并发回复、状态更新和正文保存。
- 验证 JSON 文件不会损坏，最终数据结构可解析且不丢关键字段。

### 4.4 构建和打包边界

已出现问题：

- Tauri dev 配置和 Web build / dev server 关系不一致。
- 品牌名、图标、Info.plist、npm 包名和 CLI 名称曾需要多处统一。

本质问题：

- Web、server、sidecar、Tauri 配置和安装包是多产物链路，任何一段旧配置都可能透出旧状态。

测试策略：

- 打包 smoke test 必须读取 `Info.plist`、sidecar、icon、bundle 文件结构。
- 安装校验必须验证 `/Applications/Margent.app` 的关键字段和二进制时间戳。

### 4.5 产品层面的测试 Feature List

这一层从用户可感知的产品能力出发定义测试范围，不直接绑定单元测试、E2E 或 Tauri smoke 等技术分层。后续第 5 节的测试分层需要承接这些产品能力，把每个能力拆到合适的自动化测试层。

#### P0：核心可用闭环

- App 启动与空态：首次启动、无文档启动、恢复最近文档、打开失败提示、启动过程中不闪现错误态。
- 本地 Markdown 打开：通过空态按钮、顶部菜单、系统双击、右键打开方式打开 `.md` / `.markdown` 文件。
- Markdown 阅读：标题、段落、列表、引用、表格、代码块、Mermaid、本地图片稳定渲染。
- 批注生命周期：选区批注、全文批注、回复、二级回复、编辑、删除、resolved / reopen 状态可用。
- 轻编辑闭环：进入编辑、选区批注、`Ctrl+S` 保存、退出编辑、外部变更冲突提示。
- Codex 连接状态：未检测到会话、已检测到来源会话、接续会话、自动监控开关、手动 `@codex` 投递状态清晰。
- MCP 处理闭环：Codex 能读取批注、回复批注、修改正文、重新标记锚点、标记 event handled。
- 桌面安装包：`.app` / `.dmg` 产物存在，品牌字段、图标、文件关联和 sidecar 基础能力正确。

#### P1：主要体验增强

- 多文档工作区：打开多份文档、切换 tab、关闭 tab、保留各文档阅读位置和批注列表状态。
- 目录栏：目录跳转、收起 / 展开、正文区域随目录状态调整。
- 阅读增强：Mermaid 大图、源码切换、复制 PNG、复制源码、表格横向滚动和列宽拖拽。
- 多语言：中文 / 英文切换后，Web UI、Finder 打开弹窗、mac 顶部菜单和设置窗口文案一致；整体文案检测能发现中文 / 英文 key 缺失、空文案和未翻译占位。
- 配色方案：默认、蓝白、灰白切换后，正文、批注、按钮、表格、代码块和 Mermaid 状态一致。
- 外部文件变更：文档被 Codex 或其他编辑器修改后，Margent 能刷新正文并尽量恢复批注锚点。
- 最近文档：最近打开列表、缺失文件状态、移除最近记录、启动恢复逻辑稳定。

#### P2：发布质量和长期稳定性

- 性能：启动、打开大文档、创建批注、保存正文、切换编辑态达到可接受阈值。
- 可访问性：主要按钮、状态、批注操作和设置项有可读 label、键盘焦点和足够对比度。
- 视觉稳定性：空态、阅读态、编辑态、批注面板和设置窗口在常见桌面尺寸下不重叠、不溢出。
- 发布流程：打包、覆盖安装、默认打开方式、签名 / notarization 状态有稳定检查脚本。
- 回归机制：每次修复严重 bad case 后，补充对应产品能力测试，避免只做一次性人工验证。

## 5. 测试分层

### 5.1 静态检查层

目标：快速发现类型错误、构建错误、格式级问题和多语言文案缺失。

覆盖命令：

- `npm run typecheck`
- `npm run check:i18n-copy`
- `npm run build`
- `npm run desktop:sidecar`
- `npm run tauri:build`
- `git diff --check`

文案检测准入：

- 对比 `zh-CN` / `en-US` locale key 集合，任一语言缺失 key 都失败。
- 扫描 Web UI 的 `t("...")` 引用，确保每个引用 key 都存在于中文和英文 locale。
- 检查 locale value 为空字符串、仍等于 key、明显占位文案或重复未翻译文案。
- 检查桌面 native 文案，包括 Finder 打开弹窗、mac 顶部菜单、InfoPlist strings 和设置窗口标题。

建议新增脚本：

```json
{
  "check:i18n-copy": "node scripts/check-i18n-copy.mjs",
  "check": "npm run typecheck && npm run check:i18n-copy && npm run build && git diff --check"
}
```

准入：

- 每次提交前至少跑 `npm run typecheck`。
- 涉及 UI 文案、菜单、弹窗、设置窗口或语言切换时，必须跑 `npm run check:i18n-copy`。
- PR 前跑 `npm run check`。
- 安装包发布前跑 `npm run tauri:build`。

### 5.2 单元测试层

目标：覆盖纯逻辑和低依赖模块，定位快、执行快。

建议工具：

- `vitest`
- Node temp directory fixture

优先覆盖模块：

- `src/server/markdownBlocks.ts`
- `src/server/documentEdit.ts`
- `src/server/reviewAnchorRepair.ts`
- `src/server/paths.ts`
- `src/server/codexLink.ts`
- `src/server/codexDiscovery.ts`
- `src/web/review/anchorCapture.ts`
- `src/web/review/anchorResolve.ts`
- `src/shared/markdownHeadings.ts`

核心用例：

- Markdown heading 提取和目录结构稳定。
- 代码块、表格、Mermaid、普通段落的 block 切分稳定。
- 文档编辑能正确替换目标文本，不误改重复文本。
- 批注锚点优先通过 selected text + prefix / suffix 恢复。
- 找不到原位置时，批注可以挂到上一级标题附近。
- `.review.json` / `.codex.json` 路径生成支持中文、空格和多后缀文件名。
- Codex 来源自动发现只在明确命中时返回候选，不伪造来源。

### 5.3 Server API 集成测试层

目标：用真实 Express server + 临时文件目录验证本地 API 合同。

建议工具：

- `vitest`
- `supertest` 或 Node 原生 `fetch`
- 每个测试独立创建 temp workspace

优先覆盖 API：

- `GET /api/session`
- `POST /api/session/document`
- 文档读取、保存和刷新 API
- 批注 CRUD API
- 回复、二级回复、状态切换 API
- Review Event 创建、列表、状态更新 API
- Codex Link 读取、写入、接续绑定 API

核心用例：

- 打开不存在文件返回明确错误，不污染当前 session。
- 打开合法 Markdown 后可以读取正文、目录、批注和 Codex Link。
- 新建全文批注不依赖 selected text。
- 新建选区批注可以保存 selected text、prefix、suffix、heading。
- 编辑批注只改批注内容，不影响 replies。
- 删除批注后 `.review.json` 中对应批注和回复都被移除。
- open / resolved 状态切换后可重新打开。
- 自动监控开启时，新建批注会创建 auto event。
- 自动监控关闭时，新建批注不自动创建 auto event，但手动 `@codex` 可以创建 manual event。
- 多事件按文档维度串行进入 queued / delivering / handled 状态。
- 并发写 `.review.json` 后文件仍是合法 JSON。

### 5.4 MCP 合同测试层

目标：验证 Codex 能通过 MCP 工具完成批注处理闭环。

优先覆盖工具：

- `reviewer_get_document`
- `reviewer_list_annotations`
- `reviewer_get_annotation_context`
- `reviewer_add_annotation_reply`
- `reviewer_apply_document_edit`
- `reviewer_update_annotation_status`
- `reviewer_get_codex_link`
- `reviewer_bind_current_codex_thread`
- `reviewer_mark_review_event_handled`

核心用例：

- 读取单文档批注上下文时，返回 selected text、附近 Markdown、所属 heading 和已有 replies。
- 提问型批注可以只追加回复并标记 resolved。
- 明确修改型批注可以修改正文、回复处理说明并重新锚定。
- 模糊批注不修改正文，只回复讨论或澄清。
- mark event handled 只更新指定 event，不影响其他 queued event。
- 多文档模式下未传 `documentPath` 时返回明确错误。
- 传入错误 annotation id / event id 时返回可读错误。

### 5.5 Codex Bridge 测试层

目标：不真实依赖 Codex 服务，也能验证投递队列和任务 prompt 合同。

建议实现：

- 抽出 Bridge adapter interface。
- 测试中使用 fake Codex App Server。
- fake server 记录 `thread/resume`、`turn/start` 调用参数。

核心用例：

- source target 存在时，投递到 source thread。
- successor target 存在时，投递到 successor thread。
- 未连接 Codex 会话时，event 保持未投递状态，不创建无上下文新会话。
- 自动事件按同一文档串行投递。
- 一个事件 delivering 时，新事件保持 queued。
- 投递 prompt 包含 documentPath、annotationId、eventId、目标会话类型、处理步骤和 MCP 失败提示。
- 投递成功后事件状态更新；Codex 处理完成后 MCP 标记 handled。
- 失败时保留可重试状态，不吞掉 event。

### 5.6 前端组件和交互测试层

目标：覆盖不需要真实桌面环境的 UI 状态和用户交互。

建议工具：

- `vitest`
- `@testing-library/react`
- `jsdom`

优先覆盖：

- 空态启动页
- 顶部 tab 栏
- 文档右上角操作区
- 目录栏收起 / 展开
- 批注列表
- Codex 连接状态卡片
- 设置窗口语言 / 配色切换
- Toast
- CodeBlock / MermaidBlock 工具栏
- ResizableTable

核心用例：

- 刚打开文件时批注列表默认收起。
- 目录栏收起后，正文左上角出现浮动展开按钮。
- 阅读态和编辑态操作按钮切换正确。
- 保存成功 toast 出现在屏幕中间靠上位置。
- 删除二次确认只在二次点击时真正删除，5 秒后回退。
- Agent 回复不可编辑，但可以继续回复。
- 中文 / 英文切换后主要 UI 文案变化。
- UI 中不出现裸 key、空 label 或缺失翻译导致的 fallback 文案。
- 默认 / 蓝白 / 灰白主题切换后 body token 变化。

### 5.7 Web E2E 测试层

目标：用真实浏览器验证用户关键路径，减少组件 mock 带来的盲区。

建议工具：

- `playwright`
- 本地启动 `npm run dev:server` + `npm run dev:web`
- 测试数据放在 `test-fixtures/`

关键路径：

- 空态启动页选择文件并打开。
- 打开包含标题、表格、代码块、Mermaid、本地图片的 Markdown。
- 目录跳转和目录栏收起 / 展开。
- 选中文本创建批注。
- 新建全文批注。
- 回复、二级回复、编辑、删除、resolved / reopen。
- 切换编辑态，选中文字创建批注，`Ctrl+S` 保存。
- 阅读态和编辑态切换后滚动位置保持。
- Mermaid 图片 / 源码切换、复制 PNG、复制源码、缩放。
- 表格横向滚动和列宽拖拽。
- 多文档 tab 打开、切换、关闭。

视觉断言：

- 首屏没有 `Unable to load document` 闪现。
- 主要按钮可见且不重叠。
- 批注列表不遮挡正文主要操作区。
- 空态、阅读态、编辑态、设置窗口在 1280x800 和 1440x900 下布局可用。

### 5.8 Tauri 桌面 Smoke 测试层

目标：验证安装包和桌面外壳关键能力，不追求完整 UI E2E。

建议脚本：

- `scripts/smoke-tauri-app.mjs`
- `scripts/smoke-install-app.mjs`

核心用例：

- `src-tauri/target/release/bundle/macos/Margent.app` 存在。
- `src-tauri/target/release/bundle/dmg/Margent_0.1.0_aarch64.dmg` 存在。
- `Info.plist` 中 `CFBundleName`、`CFBundleDisplayName`、`CFBundleExecutable` 都是 `Margent`。
- `CFBundleIdentifier` 是 `com.margent.desktop`。
- `.md` / `.markdown` file association 存在。
- app bundle 内包含 sidecar `margent-server`。
- app bundle 内包含 Node runtime resources。
- `codesign --verify --deep --strict` 通过。
- 覆盖安装到 `/Applications/Margent.app` 后关键字段不变。
- 使用 `open -a /Applications/Margent.app <fixture.md>` 可以拉起 App。

说明：

- 未做 Developer ID 签名 / notarization 前，`spctl --assess` rejected 是预期状态，不作为本地测试失败。

### 5.9 性能和稳定性测试层

目标：避免明显退化，先关注真实影响体验的指标。

建议指标：

- 空态启动到可点击：目标 < 2s。
- 打开 100KB Markdown 到正文可见：目标 < 1s。
- 打开 1MB Markdown 到正文可见：目标 < 3s。
- 切换阅读 / 编辑态滚动定位：无动画等待，直接定位。
- 创建批注到列表出现：目标 < 300ms。
- 保存正文到磁盘完成：目标 < 500ms，视文件大小调整。
- Mermaid 首次渲染不导致页面跳到错误章节。

第一阶段只做脚本记录和阈值告警，不把所有性能指标设为 hard fail。

## 6. 测试 Fixture 设计

建议新增目录：

```text
test-fixtures/
├── markdown/
│   ├── simple.md
│   ├── chinese path 文档.md
│   ├── mermaid-and-code.md
│   ├── tables.md
│   ├── local-images.md
│   ├── long-document.md
│   └── duplicate-text.md
├── images/
│   ├── local image with space.png
│   └── 中文图片.png
├── review/
│   ├── basic.review.json
│   ├── replies.review.json
│   └── anchor-repair.review.json
└── codex/
    ├── source-linked.codex.json
    ├── successor-linked.codex.json
    └── unlinked.codex.json
```

fixture 原则：

- 每个测试复制 fixture 到临时目录运行，不直接修改 fixture 原件。
- Markdown fixture 要覆盖中文、空格、重复文本、同名标题、长表格、Mermaid、代码块和本地图片。
- Review fixture 要覆盖 open / resolved、回复、二级回复、agent 回复和锚点漂移。
- Codex fixture 要覆盖 source、successor、未连接和自动监控开关。

## 7. 建议新增 NPM Scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:unit": "vitest run tests/unit",
  "test:api": "vitest run tests/api",
  "test:mcp": "vitest run tests/mcp",
  "test:bridge": "vitest run tests/bridge",
  "test:ui": "vitest run tests/ui",
  "test:e2e": "playwright test",
  "test:desktop:smoke": "node scripts/smoke-tauri-app.mjs",
  "check:i18n-copy": "node scripts/check-i18n-copy.mjs",
  "check": "npm run typecheck && npm run check:i18n-copy && npm run test && npm run build && git diff --check",
  "check:release": "npm run check && npm run tauri:build && npm run test:desktop:smoke"
}
```

第一阶段可以先落：

- `test`
- `test:unit`
- `test:api`
- `test:mcp`
- `test:bridge`
- `test:e2e`
- `test:desktop:smoke`
- `check:i18n-copy`

`check` 和 `check:release` 等测试稳定后再设为强门槛。

## 8. 分阶段落地计划

### 8.1 P0：基础测试骨架和核心风险覆盖

目标：先让测试体系跑起来，并覆盖最容易再次出问题的核心链路。

任务：

- 引入 `vitest`。
- 建立 `tests/unit`、`tests/api`、`tests/mcp`、`tests/bridge` 目录。
- 建立 `test-fixtures`。
- 给路径解析、批注锚点、review 写入、codex link、review event 写第一批单元测试。
- 给 Server API 写临时目录集成测试。
- 给 MCP 工具写合同测试。
- 给 Bridge 写 fake adapter 投递测试。
- 新增整体文案检测脚本，对中英文 locale key、桌面 native 文案和 `t()` 引用做静态校验。
- 引入 Playwright，写一条完整 happy path：打开文档、创建批注、回复、resolved、编辑保存。
- 新增 Tauri bundle smoke 脚本。

完成标准：

- `npm run test` 可稳定通过。
- `npm run typecheck`、`npm run build`、`npm run test` 三者都能作为 PR 前基础检查。
- 最近出现过的路径、token、并发写、启动错误态、品牌字段问题都有对应测试或 smoke 检查。

### 8.2 P1：关键交互和多状态覆盖

目标：覆盖 Margent 主要用户路径，降低交互改动回归风险。

任务：

- 扩展 Playwright 用例到阅读、批注、编辑、多文档、主题、多语言。
- 增加 Mermaid、表格、代码块、本地图片 E2E。
- 增加批注列表复杂状态：agent 回复、二级回复、删除确认、reopen。
- 增加 Codex 连接 UI 状态：未连接、source、successor、自动监控开 / 关、未投递、处理中。
- 增加外部文件修改自动刷新测试。

完成标准：

- 主要用户路径都有 E2E 覆盖。
- UI 调整后能快速发现按钮缺失、状态错位和关键流程断裂。

### 8.3 P2：桌面和发布质量门槛

目标：让每次本机安装或发给别人试用前有稳定 release checklist。

任务：

- 完善 Tauri smoke：安装、启动、打开文件、Info.plist、sidecar、codesign。
- 建立 release fixture，专门用于打包后打开。
- 增加启动性能记录。
- 增加 GitHub Actions 或本地 release 脚本。
- 形成固定发布命令：`npm run check:release`。

完成标准：

- 打包前不再靠人工逐项记忆检查。
- 安装后可以明确判断是构建问题、签名问题、Finder 缓存问题，还是未 notarize 的预期限制。

## 9. CI / 本地执行策略

### 9.1 本地开发

日常改代码：

```bash
npm run typecheck
npm run test:unit
```

涉及 UI 文案 / 多语言：

```bash
npm run check:i18n-copy
```

涉及 Server / MCP / Bridge：

```bash
npm run test:api
npm run test:mcp
npm run test:bridge
```

涉及 UI 交互：

```bash
npm run test:ui
npm run test:e2e
```

准备 PR：

```bash
npm run check
```

准备本机安装包：

```bash
npm run check:release
```

### 9.2 CI

第一阶段 CI 可以只跑：

- install
- `npm run typecheck`
- `npm run check:i18n-copy`
- `npm run test`
- `npm run build`

第二阶段再加入：

- Playwright headless E2E
- Tauri build smoke

Tauri full build 对环境要求更高，可以先作为手动 release workflow，不必一开始卡所有 PR。

## 10. 发布前自动化准入

### 10.1 PR 准入

必须通过：

- `npm run typecheck`
- `npm run check:i18n-copy`
- `npm run test`
- `npm run build`
- `git diff --check`

涉及 UI：

- 至少跑相关 Playwright 用例。

涉及 UI 文案 / 多语言：

- 必须跑整体文案检测，确保中文和英文文案没有缺失 key、空文案和裸 key fallback。

涉及 MCP / Bridge：

- 必须跑 `test:mcp` 和 `test:bridge`。

### 10.2 安装包准入

必须通过：

- `npm run check`
- `npm run tauri:build`
- `npm run test:desktop:smoke`

人工补充检查：

- 双击 `.md` 或右键用 Margent 打开。
- 打开中文路径 / 空格路径文件。
- 新建一条批注并确认 `.review.json` 写入。
- 查看 macOS 菜单栏品牌是否是 Margent。

## 11. 测试代码组织建议

```text
tests/
├── unit/
│   ├── markdownBlocks.test.ts
│   ├── documentEdit.test.ts
│   ├── reviewAnchorRepair.test.ts
│   ├── codexLink.test.ts
│   └── paths.test.ts
├── api/
│   ├── document.test.ts
│   ├── review.test.ts
│   ├── codexLink.test.ts
│   └── reviewEvents.test.ts
├── mcp/
│   ├── tools.test.ts
│   └── multiDocument.test.ts
├── bridge/
│   ├── deliveryQueue.test.ts
│   ├── promptContract.test.ts
│   └── fakeCodexAdapter.test.ts
├── ui/
│   ├── AnnotationList.test.tsx
│   ├── EmptyState.test.tsx
│   ├── Toc.test.tsx
│   └── Settings.test.tsx
└── e2e/
    ├── open-document.spec.ts
    ├── annotations.spec.ts
    ├── editor.spec.ts
    ├── mermaid.spec.ts
    └── desktop-smoke.spec.ts
```

工具文件：

```text
tests/helpers/
├── tempWorkspace.ts
├── fixtureCopy.ts
├── testServer.ts
├── fakeCodexServer.ts
└── mcpClient.ts
```

## 12. 优先级清单

第一批最值得先写的测试：

1. 路径解析：中文、空格、`%20`、本地图片。
2. Review 写入：并发写不损坏 `.review.json`。
3. 批注锚点：正文修改后能重新定位到文本或上级标题。
4. Server token：无 token / 错 token 被拒绝。
5. MCP 合同：读取批注、回复、修改正文、mark event handled。
6. Bridge prompt：投递到 source thread，prompt 字段完整。
7. E2E happy path：打开文档、创建批注、回复、resolved、编辑保存。
8. Tauri smoke：Info.plist、sidecar、codesign、bundle 路径。

这 8 个测试能覆盖目前最核心的产品风险，应该优先于大量组件快照或边角 UI case。

## 13. 维护原则

- 测试围绕用户路径和数据合同写，不围绕实现细节写。
- API / MCP / Bridge 测试优先使用真实临时文件，避免过度 mock 文件系统。
- Bridge 不真实调用 Codex，使用 fake adapter 固化投递合同。
- E2E 测试只覆盖关键路径，不把所有 hover、tooltip、微交互都变成强断言。
- 每次修复严重 bad case 时，补一条能表达本质问题的回归测试。
- 测试 fixture 保持小而清晰，不复用用户真实文档。
