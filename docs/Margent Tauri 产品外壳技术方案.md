# Margent Tauri 产品外壳技术方案

## 1. 文档信息

- 产品名称：Margent
- 技术模块：Tauri 产品外壳
- 文档日期：2026-06-03
- 关联 PRD：`Margent 产品外壳与 Codex 连接 PRD.md`
- 目标版本：v0.4.0
- 当前状态：技术方案草案

## 2. 技术目标

Tauri 产品外壳的目标不是重写现有 Web App，而是把当前本地 Markdown Reviewer 包装成一个可自然打开 `.md` 文件的桌面 App。

核心目标：

- 复用当前 React / Vite 前端。
- 复用当前 Express server、`.review.json`、MCP 和轻编辑能力。
- 支持双击、右键打开方式、拖拽或 App 内选择 Markdown 文件。
- App 启动后自动启动本地服务，用户不再关心端口和 CLI。
- 为后续 `.codex.json` 来源会话绑定、Codex Bridge 和自动处理批注留出进程与接口位置。

非目标：

- 不在第一版把 Markdown 读写全部改成 Rust。
- 不在第一版做多窗口、多标签或复杂文档工作区。
- 不在第一版实现完整 Codex Bridge，只预留连接点。
- 不把 Tauri 作为 Codex 联动的核心逻辑层，Codex 联动仍由 MCP / Bridge / sidecar 承担。

## 3. 当前工程现状

当前工程主要由三部分组成：

```text
src/
├── cli.ts                 # CLI 入口，启动 HTTP server 或 MCP server
├── server/                # Express API、文档解析、批注、编辑写回
├── mcp/                   # MCP server 和工具定义
└── web/                   # React UI、Markdown 阅读、批注、编辑器
```

当前运行模式：

```text
margent <markdown-file> --port 4318
→ Express 监听 127.0.0.1:4318
→ Express 提供 /api/*
→ Express 在生产模式下提供 dist/web 静态资源
```

当前限制：

- CLI 必须传入 Markdown 文件路径。
- 用户需要知道 URL 和端口。
- 打开另一个文件需要重新启动服务或走还未完成的 session API。
- App 内打开文件体验还不完整。
- MCP 仍以“指定单个 Markdown 文件”为主。

## 4. 目标架构

第一版采用“桌面壳 + Node sidecar server”的架构。

```text
Margent.app
├── Tauri Shell
│   ├── macOS 文件打开事件
│   ├── 单实例管理
│   ├── App 窗口
│   ├── 最近文档
│   └── 本地服务生命周期
├── Reviewer Server Sidecar
│   ├── Express API
│   ├── Markdown 解析
│   ├── .review.json 读写
│   ├── .codex.json 读写
│   └── MCP / Codex Bridge 预留
└── Web UI
    ├── 阅读模式
    ├── 批注面板
    ├── 轻编辑
    └── 打开文件空状态
```

运行流程：

```text
用户打开 App 或双击 md
→ Tauri 捕获文件路径
→ Tauri 启动或复用 Reviewer Server sidecar
→ Tauri 把文件路径传给 server session
→ Tauri 打开 WebView 指向本地 server URL
→ React UI 通过 /api/* 读取文档
```

## 5. 技术选型

### 5.1 Tauri 版本

采用 Tauri v2。

原因：

- Tauri v2 已经把插件、权限和 capabilities 做成明确模型。
- 文件关联、单实例、deep link、dialog、sidecar 等能力都有官方插件或官方方案。
- 当前前端是 Vite / React，适合直接接入 Tauri。

### 5.2 Server 承载方式

第一版使用 Node sidecar 承载现有 Express server。

原因：

- 当前业务逻辑已经在 TypeScript server 中跑通。
- Markdown、Mermaid、批注、编辑和 MCP 逻辑都依赖现有 Node 生态。
- 重写 Rust server 成本高，且不会明显改善当前产品体验。

Sidecar 打包要求：

- 开发态可以使用本机 Node 运行 `dist/cli.js`。
- 发布态随 App bundle 携带受控 Node runtime，避免用户安装 Node。
- sidecar 只监听 `127.0.0.1`，不暴露局域网端口。

当前实现状态：

- 已实现 Node sidecar 启动器，并随 Tauri bundle 一起打包。
- 启动器会在开发目录、release 目录和 macOS `.app` bundle 的 Resources 目录中寻找 `dist/cli.js`。
- 构建脚本会复制当前 Node 可执行文件到 `src-tauri/resources/node/bin/node`，并作为 Tauri resource 打进 `.app`。
- sidecar 启动器优先使用 bundle 内置 Node；仅开发调试时才回退到本机 `node`。

### 5.3 WebView 加载方式

第一版 WebView 直接加载 sidecar 提供的本地 URL：

```text
http://127.0.0.1:<dynamic-port>/
```

这样当前前端的 `/api/*` 调用可以保持不变，不需要立即改成 Tauri command。

后续如果需要更强安全边界，可以改为：

```text
tauri://localhost 加载静态前端
→ API 请求到 http://127.0.0.1:<dynamic-port>
→ 使用 token header
```

第一版先不做这层拆分。

## 6. 工程结构

新增结构：

```text
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
│   └── default.json
├── binaries/
│   └── margent-server-<target-triple>
└── src/
    ├── lib.rs
    ├── main.rs
    ├── server.rs
    ├── files.rs
    └── state.rs
```

职责：

- `lib.rs`：注册插件、初始化状态、启动 App。
- `server.rs`：启动、停止和健康检查 sidecar server。
- `files.rs`：处理文件打开事件、URL 转路径、路径校验。
- `state.rs`：保存 active document、server port、session token、recent documents。
- `capabilities/default.json`：声明前端可访问的 Tauri API 权限。

现有结构调整：

```text
src/
├── desktop/
│   └── bootstrap.ts       # 可选：Tauri 环境下读取 bootstrap 配置
├── server/
│   └── index.ts           # 支持 markdownPath 为空启动
└── cli.ts                 # 增加 --desktop-server 模式
```

## 7. Tauri 配置

### 7.1 package scripts

新增脚本：

```json
{
  "scripts": {
    "desktop:runtime": "node scripts/build-desktop-runtime.mjs",
    "desktop:sidecar": "npm run build:server && npm run desktop:runtime && node scripts/build-desktop-sidecar.mjs",
    "tauri:dev": "npm run desktop:sidecar && tauri dev",
    "tauri:build": "npm run build && npm run desktop:sidecar && tauri build",
  }
}
```

### 7.2 tauri.conf.json

核心配置示意：

```json
{
  "productName": "Margent",
  "identifier": "com.ai-collab-docs.reviewer",
  "build": {
    "beforeDevCommand": "npm run build:server",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://127.0.0.1:5173",
    "frontendDist": "../dist/web"
  },
  "app": {
    "windows": []
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "externalBin": ["binaries/margent-server"],
    "fileAssociations": [
      {
        "ext": ["md", "markdown"],
        "mimeType": "text/markdown",
        "name": "Markdown Document",
        "role": "Editor",
        "rank": "Alternate",
        "exportedType": {
          "identifier": "com.ai-collab-docs.markdown",
          "conformsTo": ["public.plain-text"]
        }
      }
    ]
  },
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["margent"]
      }
    }
  }
}
```

说明：

- `windows` 先设为空，由 Rust 在 sidecar ready 后创建主窗口。
- `rank` 第一版使用 `Alternate`，让 App 出现在“打开方式”里，不主动抢默认打开权。
- 用户后续可以在系统里手动设为 `.md` 默认打开方式。
- deep link 先配置 scheme，P2 用于从 Codex 或其他工具打开文档。

## 8. 插件与权限

### 8.1 插件清单

P0 使用：

- `tauri-plugin-single-instance`：保证只有一个 App 实例。
- `tauri-plugin-dialog`：App 内打开 Markdown 文件。
- `tauri-plugin-shell`：Rust 侧启动 sidecar。
- `tauri-plugin-deep-link`：预留 `margent://`。

P1/P2 视需要增加：

- `tauri-plugin-notification`：批注处理完成通知。
- `tauri-plugin-store` 或自有 JSON：保存最近文档和偏好。
- `tauri-plugin-opener`：打开来源文件夹或外部链接。

### 8.2 capabilities

原则：

- 前端不直接获得任意文件系统读写权限。
- 前端不获得任意 shell 执行权限。
- Markdown 读写仍由 sidecar server 执行，并受 active document 限制。
- Tauri command 只暴露打开文件、读取启动配置、聚焦窗口等必要能力。

`capabilities/default.json` 示例：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main",
  "description": "Main window capability",
  "windows": ["main"],
  "permissions": [
    "core:app:default",
    "core:event:default",
    "core:window:default",
    "dialog:default"
  ]
}
```

如果 sidecar 由 Rust 启动，不向前端暴露 `shell:allow-execute`。

## 9. Sidecar Server

### 9.1 CLI 模式扩展

当前 CLI 要求必须传入 Markdown 文件。桌面模式需要支持无文档启动。

新增参数：

```text
margent --desktop-server --port 0 --no-open
margent --desktop-server --port 4317 --document /path/to/doc.md
```

行为：

- `--desktop-server` 允许 `markdownPath` 为空。
- `--port 0` 表示使用系统分配的空闲端口。
- server 启动后向 stdout 输出一行 JSON，供 Tauri 读取：

```json
{
  "type": "server-ready",
  "url": "http://127.0.0.1:49321",
  "port": 49321
}
```

### 9.2 Server 启动参数

`startServer` 调整：

```ts
type StartServerOptions = {
  markdownPath?: string;
  port: number;
  dev?: boolean;
  desktopToken?: string;
};
```

当 `port = 0` 时，需要从 `server.address()` 读取真实端口，并返回正确 URL。

### 9.3 Session API

补齐桌面模式需要的 session API：

```text
GET  /api/session
POST /api/session/document
POST /api/session/close
```

`GET /api/session` 返回：

```ts
type ReviewSession = {
  hasDocument: boolean;
  documentPath: string | null;
  reviewPath: string | null;
  codexPath: string | null;
  sourceThreadId: string | null;
};
```

`POST /api/session/document` 请求：

```ts
type OpenDocumentRequest = {
  path: string;
};
```

行为：

- 校验路径存在。
- 校验扩展名为 `.md` 或 `.markdown`。
- 切换 active document。
- 返回新的 `ReviewDocument`。
- 前端收到后刷新阅读态和批注态。

### 9.4 No Document 状态

当没有 active document 时：

- `GET /api/document` 返回 404 `No document is open.`
- 前端展示打开文档空状态。
- 批注、编辑、目录、MCP 文档工具不可用。

## 10. 文件打开流程

### 10.1 冷启动打开文件

```text
用户双击 xxx.md
→ macOS 启动 Margent.app
→ Tauri 收到 RunEvent::Opened
→ Rust 保存 opened URL
→ sidecar 启动
→ POST /api/session/document
→ 创建主窗口加载 server URL
→ 前端读取文档
```

实现要点：

- Rust 层需要把 `file://` URL 转成 POSIX path。
- 如果启动时先收到文件事件、前端还没加载，先写入 `OpenedUrls` 状态。
- 主窗口 ready 后再通知前端或直接由 Rust 调用 session API。

### 10.2 App 已运行时打开文件

```text
用户再次双击 yyy.md
→ single-instance 阻止第二个进程常驻
→ 已运行实例收到 args / opened event
→ 聚焦主窗口
→ POST /api/session/document
→ 前端刷新文档
```

实现要点：

- `single-instance` 插件必须优先注册。
- 打开新文件前，如果当前文档有未保存编辑，前端需要拦截并提示。
- 第一版可以先只支持“单文档切换”，不保留多文档标签。

### 10.3 App 内打开文件

```text
用户点击打开文件
→ Tauri dialog 选择 .md
→ 前端或 Rust 调用 POST /api/session/document
→ 刷新文档
```

建议由前端使用 dialog 插件拿到路径，再调用 session API。

如果后续需要更强控制，可以改为 Rust command 统一处理选择和打开。

### 10.4 拖拽打开

第一版可选。

实现方式：

- 前端监听 drop。
- 如果 Tauri WebView 能拿到文件路径，则调用 session API。
- 如果路径不可用，退回 App 内打开文件入口。

## 11. 前端改造

### 11.1 App 状态

当前 `App.tsx` 只有：

```ts
loading | error | ready
```

需要调整为：

```ts
type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ready"; document: ReviewDocument };
```

### 11.2 空状态

`empty` 状态展示：

- 打开 Markdown 文件按钮。
- 最近文档列表。
- 拖入文件提示。

不展示营销介绍，不占用过大视觉空间。

### 11.3 打开文件 API

新增前端 API：

```ts
export async function fetchSession(): Promise<ReviewSession>;
export async function openDocument(path: string): Promise<ReviewDocument>;
```

Tauri 环境下新增：

```ts
export async function pickMarkdownFile(): Promise<string | null>;
```

Web / localhost 环境下：

- App 内打开文件可以暂时不可用，或继续走现有 server pick API。
- 桌面 App 是主要目标体验。

### 11.4 未保存编辑拦截

切换文档前需要检查：

- 是否处于编辑态。
- 是否存在 unsaved draft。

如果有未保存内容：

- 阻止直接切换。
- 展示轻量确认。
- 用户选择保存、放弃或取消。

## 12. 本地 API 安全

因为 sidecar server 提供文档写入能力，不能只依赖“绑定 127.0.0.1”。

P0 增加 session token：

```text
Tauri 生成随机 token
→ 作为 env 传给 sidecar
→ 前端通过 Tauri command 获取 token
→ 所有写操作带 X-Margent-Token
→ server 校验 token
```

规则：

- `GET /health` 不要求 token。
- `GET /api/document` 可以要求 token，桌面模式下统一要求更简单。
- 所有 `POST` / `PUT` / `PATCH` / `DELETE` 必须要求 token。
- 不开启 CORS。
- server 只监听 `127.0.0.1`。

这样可以降低其他本地网页或进程误调用写接口的风险。

## 13. 最近文档

P0 支持最近文档：

```ts
type RecentDocument = {
  path: string;
  title: string;
  lastOpenedAt: string;
  sourceThreadId?: string;
};
```

存储位置：

```text
~/Library/Application Support/Margent/recent-documents.json
```

行为：

- 成功打开文档后写入最近文档。
- 只保留最近 20 条。
- 文件不存在时从列表中静默移除。
- 最近文档只影响打开体验，不影响 `.review.json`。

## 14. `.codex.json` 连接预留

Tauri P0 不直接实现 Codex Bridge，但需要支持读取和展示连接状态。

server 增加：

```text
GET /api/codex-link
PUT /api/codex-link
```

文件位置：

```text
<markdown basename>.codex.json
```

P0 只做：

- 打开文档时读取。
- 返回 `sourceThreadId`。
- 前端展示“已关联 / 未关联来源会话”。

P1 再做：

- 写入来源会话。
- 发送批注事件。
- Codex Bridge Adapter。

## 15. MCP 影响

当前 MCP server 是独立 stdio 模式：

```text
margent-mcp <markdown-file>
```

Tauri P0 不改变这个能力。

后续需要一个 desktop-aware MCP 模式：

```text
margent-mcp --desktop
```

能力：

- 查询当前 App active document。
- 列出最近文档。
- 打开指定文档。
- 读取当前文档批注。
- 修改当前文档。

P0 只需要保证桌面 App 写出的 `.review.json` 与当前 MCP 工具兼容。

## 16. Codex Bridge 影响

Tauri 只负责承载 Bridge 运行环境，不把 Bridge 写进 Rust UI 层。

推荐后续结构：

```text
src/
└── bridge/
    ├── codexBridge.ts
    ├── adapters/
    │   ├── sdkAdapter.ts
    │   ├── appServerAdapter.ts
    │   └── execResumeAdapter.ts
    └── prompts.ts
```

Tauri 管理：

- Bridge 是否随 App 启动。
- 自动发送是否开启。
- 通知用户处理结果。

Bridge 管理：

- 读取 `.codex.json`。
- 投递到来源 thread。
- 写入 event delivery 状态。

## 17. 构建与打包

### 17.1 开发态

开发态推荐：

```text
npm run build:server
npm run tauri:dev
```

Tauri dev 启动后：

- Rust 使用本地 Node 执行 `dist/cli.js --desktop-server`。
- WebView 使用 Vite dev URL。
- Vite proxy 指向 sidecar port。

如果 sidecar 使用动态端口，Vite proxy 需要由 Tauri 注入 API base，或开发态固定使用 4317。

第一版开发态可以固定 4317，降低复杂度。

### 17.2 发布态

发布态：

```text
npm run tauri:build
```

构建步骤：

1. `vite build` 输出 `dist/web`。
2. `tsc -p tsconfig.server.json` 输出 `dist/*.js`。
3. 复制可分发 Node runtime 到 `src-tauri/resources/node/`。
4. 打包 server sidecar 启动器。
5. 将 sidecar 放入 `src-tauri/binaries/` 并带 target triple 后缀。
6. `tauri build` 生成 `.app` 和 `.dmg`。

### 17.3 macOS bundle

macOS 输出：

```text
src-tauri/target/release/bundle/macos/Margent.app
src-tauri/target/release/bundle/dmg/Margent_*.dmg
```

第一版可以先做本机 unsigned build，用于内部试用。

后续公开分发需要：

- Developer ID 证书签名。
- notarization。
- DMG 分发。

## 18. 测试计划

### 18.1 单元与类型检查

继续保留：

```text
npm run typecheck
npm run build
```

新增：

```text
cargo check
cargo test
```

### 18.2 桌面 smoke test

需要覆盖：

- 直接启动 App，看到空状态。
- App 内选择 `.md`，成功打开。
- 双击 `.md`，App 启动并打开文档。
- App 已运行时双击另一个 `.md`，窗口聚焦并切换文档。
- 创建批注后 `.review.json` 写入同目录。
- 编辑正文并保存，原 Markdown 文件被更新。
- 有未保存编辑时打开新文件，会提示确认。
- 关闭 App 后 sidecar 进程退出。

### 18.3 本地 API 安全测试

需要覆盖：

- 无 token 调用写接口返回 401。
- 错 token 调用写接口返回 401。
- 正确 token 可以写入。
- server 只监听 `127.0.0.1`。
- CORS 未开启。

### 18.4 打包验证

需要覆盖：

- `.app` 可直接启动。
- `.dmg` 安装后可启动。
- 没有本机 Node 环境时 App 仍可运行。
- `.md` 打开方式中出现 Margent。
- sidecar 在 Apple Silicon 目标下能启动。

## 19. 实施步骤

### Step 1：整理 server 桌面模式

- 允许 `markdownPath` 为空启动。
- 补齐 `/api/session` 和 `/api/session/document`。
- 支持 `port = 0` 返回真实端口。
- 增加 desktop token 校验。
- 前端支持 `empty` 状态。

### Step 2：创建 Tauri shell

- 初始化 `src-tauri`。
- 注册 single-instance、dialog、deep-link。
- Rust 启动 sidecar。
- sidecar ready 后创建主窗口。
- App 内打开文件跑通。

### Step 3：接入文件关联

- 配置 `bundle.fileAssociations`。
- 处理 macOS `RunEvent::Opened`。
- 处理 App 已运行时的新文件打开。
- 加未保存编辑拦截。

### Step 4：打包 sidecar

- 增加 sidecar build 脚本。
- 生成 target triple 后缀产物。
- 打出本机 `.app`。
- 验证无全局 Node 依赖。

### Step 5：补连接状态

- 增加 `.codex.json` 读取。
- session 返回 `sourceThreadId`。
- UI 展示文档来源连接状态。

## 20. 风险与处理

### 20.1 Node sidecar 体积

Node sidecar 会增加包体，但仍显著小于 Electron 级别的整套 Chromium。

处理：

- 第一版优先接受包体增加，换取复用现有代码。
- 后续只有在性能或包体成为真实问题时，再考虑 Rust 化 server 的高频能力。

### 20.2 动态端口和前端 API base

动态端口更安全，但开发态复杂。

处理：

- 发布态使用动态端口。
- 开发态可以固定 4317。
- 前端通过 Tauri bootstrap 获取 API base。

### 20.3 文件切换与未保存编辑冲突

这是高风险体验点。

处理：

- 文件切换统一经过前端 guard。
- 如果来自系统双击事件，也先通知前端确认，再真正切换 active document。

### 20.4 App Store 沙盒

第一版不以 Mac App Store 为目标。

处理：

- 先做 Developer ID / DMG 分发。
- 如果未来进入 App Store，再重新评估 security-scoped file access 和 sandbox entitlement。

## 21. 官方参考

- Tauri file associations and opened file events: https://tauri.app/learn/mobile-file-associations/
- Tauri single instance plugin: https://v2.tauri.app/plugin/single-instance/
- Tauri sidecar binaries: https://v2.tauri.app/develop/sidecar/
- Tauri Node.js sidecar guide: https://v2.tauri.app/learn/sidecar-nodejs/
- Tauri deep link plugin: https://v2.tauri.app/plugin/deep-linking/
- Tauri capabilities: https://v2.tauri.app/security/capabilities/
- Tauri macOS application bundle: https://v2.tauri.app/distribute/macos-application-bundle/
