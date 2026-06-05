# Margent Codex 连接协作技术方案

## 1. 文档信息

- 产品名称：Margent
- 技术模块：Codex 连接协作
- 文档日期：2026-06-04
- 关联 PRD：`Margent 产品外壳与 Codex 连接 PRD.md`
- 关联技术方案：`Margent Tauri 产品外壳技术方案.md`
- 目标版本：v0.4.0 起逐步落地
- 当前状态：技术方案草案，已纳入 App Server 来源会话续写验证结论

## 2. 设计边界

本技术方案对应 PRD 中的“产品外壳与 Codex 连接”模块，核心目标是让 Margent 成为 Markdown 文档和 Codex 会话之间的本地桥梁。

产品负责：

- 打开本地 Markdown 文档。
- 读取和保存 `.review.json` 批注文件。
- 读取和保存 `.codex.json` 文档连接文件。
- 记录来源会话和当前投递目标。
- 在用户手动点击 `@codex` 或开启自动监控后，把批注任务投递给当前目标 Codex 会话。
- 默认通过 Codex App Server `thread/resume` 把批注任务追加到来源会话，保留来源会话已有上下文。
- 提供 MCP 工具，让 Codex 自己读取文档、读取批注、回复批注、修改正文和更新状态。
- 来源会话不可用时，提供“复制接续指令”，让用户在目标 Codex 会话里完成重新绑定。

产品不负责：

- 不保存或维护 Codex 会话摘要。
- 不生成上下文包。
- 不把完整聊天记录复制到文档旁边。
- 不在来源会话不可用时自动创建新对话处理复杂修改。
- 不把新建对话伪装成来源会话。
- 不在普通用户 UI 中展示投递 prompt、event id、MCP 调用链或详细错误信息。
- 不强制所有 Markdown 都必须关联 Codex 会话。
- 不依赖单一未稳定 Codex 内部接口。

这意味着：Margent 只做“连接和投递”，上下文判断仍发生在 Codex 会话里。

### 2.1 已验证技术结论

2026-06-04 已完成最小 POC：

- `codex app-server` 可以通过 `thread/start` 创建本地 Codex thread。
- 创建 thread 时显式传入 `threadSource: "user"` 后，Desktop 前端可以索引并打开该 thread。
- `thread/resume` 可以恢复一个已有 Codex thread。
- 对已恢复 thread 调用 `turn/start` 后，新 turn 会追加回同一个 thread。
- 续写后的 Codex 能读取该 thread 的历史 turn，并基于来源会话上下文回答问题。

因此，本阶段主线确定为：

```text
文档绑定来源 thread
→ 批注创建 review event
→ Bridge 使用 App Server thread/resume 恢复来源 thread
→ Bridge 使用 turn/start 投递批注任务
→ Codex 在来源会话上下文中通过 MCP 处理批注
```

新建 thread 只作为没有来源绑定或用户主动配置接续对话时的 fallback，不作为默认协作路径。

## 3. 目标体验闭环

### 3.1 打开闭环

```text
用户双击或选择 Markdown
→ Tauri App 启动
→ Reviewer Server sidecar 启动
→ App 加载 Markdown、.review.json、.codex.json
→ UI 展示文档、批注和 Codex 连接状态
```

### 3.2 手动协作闭环

```text
用户创建批注
→ 批注保存到 .review.json
→ 用户点击批注卡片操作行的 @codex
→ Server 创建 manual review event
→ Codex Bridge resume 当前目标会话
→ Codex Bridge 在同一 thread 中启动新 turn
→ Codex 收到最小任务 prompt
→ Codex 通过 MCP 读取批注和文档
→ Codex 回复批注、修改正文、更新状态
→ Reviewer 刷新文档和批注
```

### 3.3 自动监控闭环

```text
用户开启 Codex 自动监控批注
→ 用户创建新批注
→ Server 创建 auto review event
→ Bridge 按文档维度串行投递
→ Bridge 逐条 resume 目标 Codex 会话并追加 turn
→ 目标 Codex 会话在自身上下文中逐条处理批注
→ Codex 通过 MCP 完成回复、正文修改和状态更新
→ Bridge 标记事件 handled，继续下一条 queued 事件
```

### 3.4 接续绑定闭环

```text
来源会话不可用
→ UI 展示来源不可用状态
→ 用户点击复制接续指令
→ App 复制一段给 Codex 的绑定指令
→ 用户粘贴到目标 Codex 会话
→ 目标 Codex 调用 MCP 绑定自己为接续对话
→ .codex.json 的当前 target 切换为 successor
→ 后续 @codex 或自动监控投递到接续对话
```

## 4. 当前实现基础

当前代码已经具备：

- Tauri 桌面 App。
- `.md` / `.markdown` 文件关联。
- 内置 Node runtime 的 macOS Apple Silicon 安装包。
- 本地 Reviewer Server sidecar。
- `/api/session` 读取当前打开文档和来源 thread。
- `POST /api/session/document` 切换当前打开文档。
- `.review.json` 批注读写。
- `.codex.json` 读取。
- 单文档 stdio MCP server。
- MCP 工具读文档、读批注、回复批注、改状态、修改正文。

仍需补齐：

- `.codex.json` 写入和目标会话切换。
- 接续指令生成和 MCP 绑定工具。
- 批注事件模型。
- `@codex` 手动投递。
- Codex 自动监控开关。
- 串行投递队列。
- Codex Bridge Adapter。
- MCP 事件读取和事件状态更新工具。
- UI 中的连接状态、自动监控状态、轻量异常处理。

## 5. 总体架构

```text
Margent.app
├── Tauri Shell
│   ├── 文件关联
│   ├── 打开文件事件
│   ├── sidecar 生命周期
│   └── WebView 容器
├── Reviewer Server
│   ├── Session API
│   ├── Document API
│   ├── Review API
│   ├── Codex Link API
│   ├── Review Event API
│   └── Bridge API
├── Reviewer MCP
│   ├── 文档读取
│   ├── 批注上下文读取
│   ├── 批注回复和状态更新
│   ├── Markdown 正文修改
│   ├── Codex Link 绑定
│   └── Review Event 读取和状态更新
└── Codex Bridge
    ├── Codex SDK Adapter
    ├── Codex App Server Adapter
    ├── codex exec resume Adapter
    └── future thread API Adapter
```

分工原则：

- Tauri Shell 只负责本地 App 形态和系统打开能力。
- Reviewer Server 负责本地文件读写、连接状态、事件队列和 Bridge 调度。
- Reviewer MCP 负责把文档操作能力暴露给 Codex。
- Codex Bridge 负责投递任务，不直接读批注、不修改正文、不判断业务处理方式。

## 6. Codex Link 设计

### 6.1 文件位置

每个 Markdown 文档旁边保存一份连接文件：

```text
<markdown basename>.codex.json
```

示例：

```text
product-prd.md
product-prd.review.json
product-prd.codex.json
```

### 6.2 数据结构

```ts
type CodexTargetType = "source" | "successor";

type CodexDocumentLink = {
  version: 1;
  documentPath: string;
  source?: {
    type: "codex";
    threadId?: string;
    turnId?: string;
    cwd?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  target?: {
    type: CodexTargetType;
    threadId?: string;
    cwd?: string;
    configuredAt?: string;
    configuredBy?: "codex" | "user";
    configuredVia?: "source" | "mcp-bind-instruction" | "manual";
  };
  bridge?: {
    autoSendNewAnnotations?: boolean;
    lastDeliveredEventId?: string;
    lastDeliveryAt?: string;
  };
};
```

说明：

- `source` 是产出或大改这份 Markdown 的来源 Codex 会话。
- `target` 是当前投递目标，默认指向 `source`。
- 当来源会话不可用，用户通过接续指令绑定新会话后，`target.type` 切换为 `successor`。
- 文件中不保存 `context`、`summary`、`keyDecisions` 等上下文字段。

### 6.3 读取 API

```text
GET /api/codex-link
```

返回：

```ts
type CodexLinkResponse = {
  documentPath: string;
  codexLinkPath: string;
  link: CodexDocumentLink | null;
  connection: {
    hasSource: boolean;
    hasTarget: boolean;
    targetType: CodexTargetType | null;
    autoSendNewAnnotations: boolean;
    sourceAvailable: boolean | null;
  };
};
```

### 6.4 更新 API

```text
PUT /api/codex-link
```

输入：

```ts
type UpdateCodexLinkRequest = {
  source?: CodexDocumentLink["source"];
  target?: CodexDocumentLink["target"];
  bridge?: CodexDocumentLink["bridge"];
};
```

写入规则：

- `documentPath` 始终由 server 根据 active document 填充。
- 前端不能提交任意 `documentPath` 覆盖连接文件路径。
- `version` 固定为 `1`。
- 更新时保留未覆盖字段。
- 写入前做 schema 校验。
- 写入采用临时文件加 rename，避免半写入 JSON。

### 6.5 绑定来源会话

当 Codex 产出 Markdown 文档时，应通过 MCP 或 helper 同步写入 `.codex.json`。

推荐 MCP 工具：

```text
reviewer_bind_current_codex_thread
```

输入：

```ts
type BindCurrentCodexThreadInput = {
  documentPath: string;
  role: "source" | "successor";
  autoSendNewAnnotations?: boolean;
};
```

行为：

- `role="source"` 时写入 `source`，并把 `target` 默认设置为 `source`。
- `role="successor"` 时写入 `target.type="successor"`。
- `threadId` 和 `cwd` 优先由 Codex 环境或 adapter 提供。
- 如果当前 Codex 环境暂时不能稳定提供 thread id，MCP 返回明确错误，由 Codex 向用户说明当前无法自动绑定。

这里不提供普通用户手填 thread id 的主流程。用户侧主流程是复制指令给目标 Codex 会话，由 Codex 通过 MCP 自动绑定。

### 6.6 接续指令生成

Server 提供：

```text
POST /api/codex-link/successor-instruction
```

返回：

```ts
type SuccessorInstructionResponse = {
  documentPath: string;
  instruction: string;
};
```

指令模板：

```text
请把你当前这个 Codex 会话绑定为 Margent 的接续对话。

文档路径：
{{documentPath}}

请调用 Margent MCP：
reviewer_bind_current_codex_thread({
  documentPath: "{{documentPath}}",
  role: "successor"
})

绑定成功后，请回复我：已连接接续对话。
```

UI 行为：

- 点击“复制接续指令”后复制 `instruction`。
- 展示 toast：`指令复制成功，粘贴到目标会话发送给 Codex 即可重连`。
- 不要求用户输入或查找 thread id。

## 7. Review Event 设计

### 7.1 存储位置

第一版将事件存储在 `.review.json` 中，减少额外状态文件。

```ts
type ReviewFile = {
  version: 1;
  documentPath: string;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  annotations: ReviewAnnotation[];
  events?: ReviewEvent[];
};
```

### 7.2 事件结构

```ts
type ReviewEvent = {
  id: string;
  type: "annotation_created";
  documentPath: string;
  annotationId: string;
  sourceThreadId?: string;
  targetThreadId?: string;
  targetType?: "source" | "successor";
  deliveryMode: "manual" | "auto";
  deliveryStatus:
    | "ignored"
    | "queued"
    | "delivering"
    | "sent"
    | "processing"
    | "handled"
    | "failed";
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  delivery?: {
    adapter?: "codex-sdk" | "app-server" | "codex-exec-resume" | "future-thread-api";
    threadId?: string;
    turnId?: string;
    deliveryId?: string;
    lastAttemptAt?: string;
  };
};
```

### 7.3 状态含义

- `ignored`：不需要投递，通常来自批注删除、已解决或用户取消。
- `queued`：等待投递。
- `delivering`：Bridge 正在投递。
- `sent`：任务已发送到目标 Codex 会话。
- `processing`：Codex 已开始通过 MCP 处理。
- `handled`：Codex 已完成回复、正文修改或状态更新。
- `failed`：投递或处理链路失败，可重试。

`deliveryStatus`、`attemptCount`、`lastError` 是内部字段。用户界面不使用它们作为批注列表筛选条件，也不展示详细错误。Codex 可以通过 MCP 读取这些字段分析问题。

`delivery.threadId` 和 `delivery.turnId` 记录 App Server 实际投递到哪个 Codex thread / turn，用于 MCP 排查和后续 deep link，不作为用户主路径展示。

### 7.4 状态流转

手动投递：

```text
用户点击 @codex
→ queued
→ delivering
→ sent
→ processing
→ handled
```

自动监控：

```text
新批注
→ queued
→ 等待文档队列空闲
→ delivering
→ sent
→ processing
→ handled
```

异常：

```text
queued / delivering / sent / processing
→ failed
→ 用户点击重试图标
→ queued
```

取消：

```text
queued
→ ignored
```

## 8. 批注创建与投递

### 8.1 创建批注

```text
POST /api/review/annotations
→ 写入 annotation
→ 读取 .codex.json
→ 根据 autoSendNewAnnotations 决定是否创建 event
→ 返回 annotation 和轻量连接状态
```

规则：

- 自动监控关闭：只保存批注，不创建自动投递事件。
- 自动监控开启且存在可用目标：创建 `deliveryMode="auto"`、`deliveryStatus="queued"` 的事件。
- 自动监控开启但没有可用目标：保存批注，不投递；UI 提示先绑定来源会话或复制接续指令。
- 批注创建不因为 Codex 连接异常而失败。

### 8.2 手动 `@codex`

```text
POST /api/bridge/annotations/:annotationId/send
```

行为：

- 读取当前批注。
- 读取当前目标会话。
- 如果不存在可用目标，返回需要绑定。
- 查找该批注最近一条未完成事件；没有则创建 manual event。
- 将事件置为 `queued`。
- 触发 Bridge 调度。

用户界面：

- `@codex` 放在批注卡片操作行，与 `回复`、`编辑` 同级。
- 不做醒目的“发送给 Codex”主按钮。
- 自动监控开启时，`@codex` 仍可用于失败后的手动补发。

### 8.3 删除、编辑和状态变化对事件的影响

- 删除批注：未投递事件标记为 `ignored`；已经投递的事件不撤回。
- 编辑批注：如果事件还在 `queued`，投递时读取最新批注内容。
- 标记 `resolved`：未投递事件标记为 `ignored`。
- 重新打开批注：不自动创建事件，用户可点击 `@codex` 或等待后续新批注触发自动监控。

## 9. 自动监控与串行队列

### 9.1 开关位置

自动监控是文档级设置：

```ts
link.bridge.autoSendNewAnnotations = boolean;
```

默认关闭。

开启前要求：

- 当前文档存在可用目标会话，来源会话或接续对话均可。
- 如果没有目标，UI 引导用户先绑定来源会话或复制接续指令。

关闭开关只影响后续新增批注。已经发送、正在处理或已经进入队列的事件不自动撤销，用户可以按事件状态重试或忽略。

### 9.2 串行投递

同一文档、同一目标会话，同一时间只允许一个 active event。

active event 包括：

- `delivering`
- `sent`
- `processing`

调度规则：

1. 按 `createdAt` 升序读取 `queued` 事件。
2. 如果存在 active event，不投递下一条。
3. active event 进入 `handled` 或 `failed` 后，继续下一条。
4. 如果用户手动重试失败事件，将该事件重新放回 `queued`。

串行投递的目标是避免多个 Codex turn 同时修改同一份 Markdown，导致正文冲突和批注锚点反复修复。

### 9.3 UI 表达

用户界面只展示轻量状态：

- 未开启自动监控。
- Codex 自动监控已开启。
- 当前目标：来源会话或接续对话。
- 有异常时提供重试图标或复制接续指令。

批注列表筛选始终是：

- 全部。
- 已解决。
- 未解决。

不展示 `queued`、`sent`、`processing`、`handled` 等投递状态分类。

## 10. Codex Bridge Adapter

### 10.1 上层接口

```ts
type SendToThreadInput = {
  threadId: string;
  cwd?: string;
  documentPath: string;
  annotationId: string;
  eventId: string;
  targetType: "source" | "successor";
  prompt: string;
};

type SendToThreadResult = {
  ok: boolean;
  threadId?: string;
  turnId?: string;
  deliveryId?: string;
  error?: string;
};

type CodexBridgeAdapter = {
  name: "codex-sdk" | "app-server" | "codex-exec-resume" | "future-thread-api";
  isAvailable(): Promise<boolean>;
  sendToThread(input: SendToThreadInput): Promise<SendToThreadResult>;
};
```

Bridge 负责：

- 选择可用 adapter。
- 生成 prompt。
- 投递任务。
- 写入 `delivery.adapter`、`delivery.threadId`、`delivery.turnId`、`delivery.deliveryId` 和 `lastAttemptAt`。
- 根据结果更新事件状态。

Bridge 不负责：

- 读取批注上下文。
- 修改 Markdown。
- 判断批注是提问还是修改。
- 标记批注 `resolved`。

### 10.2 Adapter 优先级

P0 采用已验证的 Codex App Server Adapter：

1. Codex App Server Adapter。
2. Future Thread API Adapter。
3. Codex SDK Adapter。
4. `codex exec resume` Adapter。

上层 UI 不感知具体 adapter。adapter 失败时只影响事件内部状态和轻量 UI 异常入口。

选择 App Server 作为 P0 的原因：

- 已验证可以 `thread/resume` 已有来源会话。
- 已验证 `turn/start` 会把新任务追加到同一个 thread。
- 已验证续写后的 Codex 能读取该 thread 的历史 turn。
- 不需要产品维护上下文摘要或上下文包。
- 仍可通过 Adapter 接口替换为未来更稳定的 thread API。

### 10.3 App Server Adapter 流程

App Server Adapter 通过本机 `codex app-server` 的 JSON-RPC stdio 协议投递。

来源会话主流程：

```text
输入：target.threadId, target.cwd, prompt
→ 启动 codex app-server
→ initialize / initialized
→ thread/resume({ threadId })
→ turn/start({
    threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }]
  })
→ 监听 turn/completed 或错误通知
→ 返回 { ok, threadId, turnId, deliveryId }
```

`thread/resume` 是保留上下文的关键。它恢复的是来源 Codex thread，而不是新建一个无上下文 thread。

接续对话流程与来源会话相同，但 `threadId` 来自 `.codex.json.target` 中的 successor。

新建 thread fallback：

```text
仅在没有来源会话、用户主动选择创建接续对话、或未来产品明确提供“新对话处理”入口时使用。
创建时必须传 threadSource: "user"，避免 Desktop 前端无法按普通用户会话索引。
```

第一版不把新建 thread 作为自动 fallback。来源会话不可用时，默认让用户复制接续指令到目标 Codex 会话完成绑定。

### 10.4 目标会话选择

```text
优先使用 .codex.json.target
→ 如果 target 缺失但 source 存在，target=source
→ 如果 source 不可用且 successor 存在，target=successor
→ 如果没有可用 target，返回 needs_binding
```

UI 必须区分：

- 来源会话：原始文档讨论上下文。
- 接续对话：用户显式绑定的新 Codex 会话，不保证拥有历史上下文。

判断目标可用性时，Bridge 只做最小探测：

- `threadId` 存在。
- App Server Adapter 可用。
- `thread/resume` 没有返回明确失败。

不做复杂兜底或多轮恢复。失败事件保留在本地，由用户重试或复制接续指令重新绑定。

## 11. 投递 Prompt

Bridge 只发送最小任务信息，不发送完整 Markdown，不发送聊天摘要。

基础模板：

```text
Margent 有一条新的批注任务需要处理。

文档路径：
{{documentPath}}

批注 ID：
{{annotationId}}

事件 ID：
{{eventId}}

目标会话类型：
{{targetType}}

请按以下步骤处理：

1. 调用 Margent MCP 读取这条批注：
   reviewer_get_annotation_context({
     documentPath: "{{documentPath}}",
     annotationId: "{{annotationId}}"
   })

2. 根据批注内容判断处理方式：
   - 如果是提问型批注：直接回复批注。
   - 如果是明确修改型批注：修改 Markdown 正文，并回复处理说明。
   - 如果修改目标或意图不明确：只回复讨论或澄清问题，不擅自改正文。

3. 如果修改了正文，请保存文档，并让 Reviewer 重新标记批注锚点在修改后的文本上。

4. 如果这条批注已经处理完成，可以按需要标记为 resolved。

5. 完成后，调用事件工具把 {{eventId}} 标记为 handled。

注意：
- 不要要求用户把整份 Markdown 粘贴到对话里。
- 需要正文或更多上下文时，通过 MCP 读取本地文档。
- 如果 MCP 不可用，请回复说明无法处理，不要假装已经完成。
```

来源会话补充：

```text
你正在来源 Codex 会话中处理这条批注。可以使用本会话已有讨论上下文判断产品意图和修改边界。
```

接续对话补充：

```text
你正在接续对话中处理这条批注，不是原来源会话。不要假设自己拥有完整历史讨论。
如果批注需要来源讨论上下文才能安全修改，请回复说明需要用户补充背景，或只做低风险修改。
```

## 12. Review Event API

### 12.1 查询事件

```text
GET /api/review-events?status=queued
GET /api/review-events?annotationId=ann_xxx
GET /api/review-events/:eventId
```

用途：

- Bridge 查询待投递事件。
- MCP 帮 Codex 分析异常。
- 自动监控调度读取队列。

普通前端批注列表不直接用这些 API 做状态筛选。

### 12.2 创建事件

```text
POST /api/review-events
```

输入：

```ts
type CreateReviewEventRequest = {
  annotationId: string;
  deliveryMode: "manual" | "auto";
};
```

Server 补齐：

- `id`
- `documentPath`
- `sourceThreadId`
- `targetThreadId`
- `targetType`
- `deliveryStatus="queued"`
- `attemptCount=0`
- `createdAt`
- `updatedAt`

### 12.3 更新事件

```text
PATCH /api/review-events/:eventId
```

输入：

```ts
type UpdateReviewEventRequest = {
  deliveryStatus?: ReviewEvent["deliveryStatus"];
  lastError?: string;
  delivery?: ReviewEvent["delivery"];
};
```

写入规则：

- 只允许合法状态流转。
- `attemptCount` 由 server 在投递尝试时递增。
- `lastError` 仅作为内部诊断字段，不直接展示给普通用户。

### 12.4 重试

```text
POST /api/bridge/events/:eventId/retry
```

行为：

- 只允许重试 `failed` 事件。
- 清理 `lastError`。
- 将事件重新置为 `queued`。
- 触发 Bridge 调度。

UI 只展示一个轻量重试 icon，放在异常状态旁。

## 13. MCP 工具扩展

### 13.1 保留工具

```text
reviewer_get_document
reviewer_list_annotations
reviewer_get_annotation_context
reviewer_add_annotation_reply
reviewer_update_annotation_body
reviewer_delete_annotation
reviewer_update_annotation_reply
reviewer_apply_document_edit
reviewer_update_annotation_status
```

### 13.2 新增工具

```text
reviewer_get_codex_link
reviewer_update_codex_link
reviewer_bind_current_codex_thread
reviewer_create_review_event
reviewer_list_review_events
reviewer_get_review_event
reviewer_update_review_event
reviewer_mark_review_event_handled
reviewer_get_session
reviewer_list_open_documents
```

### 13.3 工具职责

`reviewer_bind_current_codex_thread`

- 由 Codex 调用。
- 把当前 Codex 会话绑定为指定文档的来源会话或接续对话。
- 不要求用户手动提供 thread id。

`reviewer_list_review_events`

- 给 Bridge、监控线程或 Codex 查询 queued / failed / processing 事件。
- 支持 `documentPath`、`status`、`annotationId` 过滤。

`reviewer_mark_review_event_handled`

- Codex 完成处理后调用。
- 只表示该投递事件已经处理完，不等于强制把批注标记为 `resolved`。

### 13.4 MCP instructions

MCP 工具说明承担建议性协作规则：

- 先读批注上下文。
- 提问型批注优先回复，不修改正文。
- 明确修改型批注可以直接修改正文。
- 修改目标或意图不明确时只回复讨论，不擅自改正文。
- 修改正文后重新锚定批注到修改后的文本。
- 完成后回复批注。
- 确实解决后再标记 `resolved`。
- 需要继续讨论时保持 `open`。

产品不在 UI 层做硬性判断，Codex 根据 MCP 工具说明和会话上下文自行判断。

## 14. 前端 UI 合约

### 14.1 连接状态

右上角功能区或批注面板顶部展示：

- 已关联来源会话。
- 已配置接续对话。
- 未关联来源会话。
- 来源会话不可用。
- Codex 自动监控已开启。

状态信息保持轻量，不占正文阅读空间。

### 14.2 批注列表

筛选项固定为：

- 全部。
- 已解决。
- 未解决。

不展示投递状态分类。

### 14.3 批注卡片操作

批注卡片操作行：

- 回复。
- 编辑。
- `@codex`。
- 删除。
- resolved / reopen 图标。

`@codex` 是手动投递入口。关闭自动监控时，用户通过它主动发送给 Codex；开启自动监控后，它可以作为失败后的补发入口。

### 14.4 异常表达

来源会话不可用：

- 连接状态卡片展示“来源会话不可用”。
- 提供“复制接续指令”按钮。
- 点击后复制指令，并展示 toast：`指令复制成功，粘贴到目标会话发送给 Codex 即可重连`。

投递失败：

- 批注卡片状态旁显示重试 icon。
- 不展示“查看投递详情”。
- 不展示 prompt、event id、MCP 调用链或详细错误。
- 详细信息保存在本地事件中，由 Codex 通过 MCP 读取。

### 14.5 关闭自动监控

关闭自动监控时：

- 新批注只保存本地，不自动创建投递任务。
- 批注卡片操作行展示 `@codex`。
- 用户点击 `@codex` 才创建 manual event。

### 14.6 开启自动监控

开启自动监控时：

- 新批注自动创建 queued event。
- UI 仍只按批注业务状态展示列表。
- 自动监控只作用于开启后新增的批注，不批量处理历史批注。

## 15. HTTP API 汇总

### 15.1 Session

```text
GET /api/session
POST /api/session/document
```

### 15.2 Codex Link

```text
GET /api/codex-link
PUT /api/codex-link
POST /api/codex-link/successor-instruction
```

### 15.3 Review Events

```text
GET /api/review-events
GET /api/review-events/:eventId
POST /api/review-events
PATCH /api/review-events/:eventId
```

### 15.4 Bridge

```text
POST /api/bridge/annotations/:annotationId/send
POST /api/bridge/events/:eventId/retry
POST /api/bridge/dispatch
GET /api/bridge/status
```

`POST /api/bridge/dispatch` 用于触发一次队列调度。自动监控开启时，Server 可以在创建事件后内部调用；调试和 MCP 场景也可以显式触发。

## 16. 文件一致性

### 16.1 写入顺序

批注创建：

```text
写 annotation
→ 写 review file
→ 如需投递，写 event
→ 触发 Bridge
```

正文修改：

```text
Codex 通过 MCP 修改 Markdown
→ Server 保存 Markdown
→ Server 修复批注锚点
→ Server 保存 review file
→ Codex 回复批注
→ Codex 按需更新 annotation status
→ Codex 标记 event handled
```

### 16.2 锁粒度

- `.review.json` 写入使用文档级锁。
- `.codex.json` 写入使用文档级锁。
- Bridge 调度使用 `documentPath + targetThreadId` 锁。

### 16.3 原子写入

所有 JSON 旁文件写入采用：

```text
write temp file
→ fsync if available
→ rename temp to target
```

避免 App 退出、电脑休眠或进程异常导致 JSON 半写入。

## 17. 安全设计

### 17.1 本地 API

- `/api/*` 保持 `desktopToken` 校验。
- token 不写入 `.review.json` 或 `.codex.json`。
- Tauri WebView 和 sidecar 之间通过本地 token 通信。

### 17.2 文件访问边界

- 普通 API 默认只访问 active document。
- Router MCP 只访问用户通过 App 打开过的文档。
- `.review.json` 和 `.codex.json` 路径必须由 server 根据 Markdown 路径计算。
- 前端传入的文件路径不能直接拼成读写路径。

### 17.3 Codex 投递边界

- Bridge prompt 不内嵌完整 Markdown。
- Codex 必须通过 MCP 读取最新上下文。
- 接续对话不被包装成来源会话。

## 18. 测试计划

### 18.1 Codex Link

- 无 `.codex.json` 时文档可正常打开。
- 有 `.codex.json` 时 API 返回来源和当前 target。
- `PUT /api/codex-link` 能更新 source、target、bridge。
- 写入时不会覆盖未提交字段。
- 接续指令 API 返回正确 instruction。

### 18.2 批注事件

- 自动监控关闭时创建批注不创建 auto event。
- 点击 `@codex` 创建 manual event。
- 自动监控开启时新批注创建 queued event。
- 删除批注会把未投递事件标记为 ignored。
- 标记 resolved 会把未投递事件标记为 ignored。
- 重试 failed event 会回到 queued。

### 18.3 Bridge

- 无 target 时返回 needs_binding。
- target=source 时通过 `thread/resume` 发送到来源会话。
- target=source 时不会创建新 thread。
- source 不可用且 successor 可用时发送到接续对话。
- 成功投递后记录 App Server 返回的 `threadId` 和 `turnId`。
- adapter 失败时事件进入 failed。
- 成功投递后事件进入 sent。
- Codex 调用 MCP 后事件可进入 processing / handled。

### 18.4 自动监控

- 同一文档同一目标只允许一个 active event。
- 多个 queued 事件按创建时间串行投递。
- active event failed 后队列继续下一条，失败事件等待用户通过重试 icon 重新入队。
- 自动监控只处理开启后新增批注。
- 关闭自动监控后新批注不再自动投递。

### 18.5 UI

- 批注筛选只显示全部、已解决、未解决。
- `@codex` 与回复、编辑在同一操作行。
- 来源不可用时有复制接续指令按钮。
- 点击复制接续指令后 toast 文案正确。
- 投递失败只展示轻量重试 icon，不展示详情面板。

### 18.6 MCP

- Codex 可以读取 codex link。
- Codex 可以绑定当前会话为 source / successor。
- Codex 可以查询 queued / failed events。
- Codex 可以读取事件详情和 lastError。
- Codex 完成处理后可以标记 event handled。
- Codex 修改正文后批注锚点重新定位到修改后的文本。

## 19. 实施顺序

### Step 1：Codex Link 写入和接续指令

- 实现 `GET /api/codex-link`。
- 实现 `PUT /api/codex-link`。
- 实现 `POST /api/codex-link/successor-instruction`。
- 实现 MCP `reviewer_get_codex_link`。
- 实现 MCP `reviewer_bind_current_codex_thread`。
- UI 展示来源、接续和自动监控状态。

### Step 2：Review Event Store

- 扩展 `.review.json` 的 `events`。
- 实现 event schema。
- 实现创建、查询、更新和重试 API。
- 实现合法状态流转。

### Step 3：手动 `@codex`

- 批注卡片增加 `@codex` 操作。
- 实现 `POST /api/bridge/annotations/:annotationId/send`。
- 无目标时引导复制接续指令。
- 投递失败时展示轻量重试 icon。

### Step 4：Bridge Adapter

- 实现 adapter interface。
- 实现 Codex App Server Adapter。
- App Server Adapter 使用 `thread/resume` 恢复 `.codex.json.target.threadId`。
- App Server Adapter 使用 `turn/start` 把最小投递 prompt 追加到同一个 thread。
- 投递成功后记录 `delivery.threadId`、`delivery.turnId` 和 `delivery.deliveryId`。
- 生成最小投递 prompt。
- 写入 sent / failed 状态。

### Step 5：自动监控和串行队列

- 实现文档级自动监控开关。
- 新批注创建 queued event。
- 实现 `documentPath + targetThreadId` 串行调度锁。
- 实现 active event 检测。

### Step 6：MCP 事件工具

- 实现 `reviewer_list_review_events`。
- 实现 `reviewer_get_review_event`。
- 实现 `reviewer_update_review_event`。
- 实现 `reviewer_mark_review_event_handled`。
- 更新 MCP instructions。

### Step 7：UI 收口

- 批注列表只保留业务筛选。
- 连接卡片加入复制接续指令。
- 自动监控开关和状态文案落位。
- 移除投递详情入口。
- 调整异常重试 icon。

## 20. 成功标准

P0：

- 用户可以双击或从 App 内打开 Markdown。
- 用户不需要手动输入端口或执行 CLI。
- App 能读取 `.review.json` 和 `.codex.json`。
- Codex 产出的文档可以记录来源 thread。
- App 能明确展示文档是否有关联来源会话。

P1：

- 用户新增批注后，可以通过 `@codex` 手动发送给当前目标 Codex 会话。
- 当目标是来源会话时，Bridge 通过 `thread/resume` 把任务追加到来源 thread，而不是新建 thread。
- Codex 在来源 thread 中处理批注时，可以使用来源会话已有上下文。
- 自动监控开启后，新批注可以进入内部投递状态流：`queued / delivering / sent / processing / handled / failed`。
- 用户界面仍以 `全部 / 已解决 / 未解决` 管理批注，不暴露投递状态分类。
- Codex 可以通过 MCP 读取新批注并处理。
- 明确修改型批注可以完成正文修改、批注回复和状态更新。
- 来源会话不可用时，产品不会误导用户以为仍在原上下文中处理。
- 来源会话不可用时，用户可以通过复制接续指令配置接续对话，不需要手动查找 thread id。

P2：

- 新批注可以近实时进入来源 Codex 会话，并在 Codex Desktop 前端对应 thread 中可见。
- 用户能在 App 中看到轻量连接状态和最终处理结果。
- 系统能稳定处理多个文档和多个来源会话。

## 21. 风险与判断

### 21.1 Codex 外部投递能力

风险：Codex 对外 thread 投递能力可能随 App Server、SDK 或 CLI 形态变化。

判断：

- 使用 Bridge Adapter 封装投递能力。
- P0 采用已验证的 App Server `thread/resume → turn/start`。
- 对用户只暴露 `@codex`、自动监控开关和复制接续指令。
- 不把某个底层接口的 schema 泄漏到 UI 或文档旁文件。

### 21.2 当前会话标识获取

风险：Codex MCP 工具未必能稳定知道“当前会话 thread id”。

判断：

- `reviewer_bind_current_codex_thread` 需要把“获取当前会话标识”设计成 adapter 能力。
- 如果 adapter 暂时拿不到 thread id，工具返回明确错误。
- 不把“让用户手动填写 thread id”作为主路径。

### 21.3 接续对话缺少历史上下文

风险：接续对话不是原来源会话，天然缺少原始讨论细节。

判断：

- UI 明确标识接续对话。
- 投递 prompt 明确提醒 Codex 不要假设拥有完整历史讨论。
- 产品不额外维护上下文摘要或上下文包。

### 21.4 来源 thread 前端可见性

风险：App Server 续写可以写入来源 thread，但 Desktop 前端对不同来源创建的 thread 可见性可能存在差异。

判断：

- 主路径不依赖前端强制打开 thread，只依赖 `thread/resume` 和 `turn/start` 成功。
- `threadSource: "user"` 已验证可让新建 fallback thread 被 Desktop 前端索引。
- 来源会话本身由 Codex 用户会话创建，通常天然可见。
- “打开来源会话”作为辅助入口，不作为批注处理成功的必要条件。

### 21.5 自动监控误解

风险：用户可能把自动监控理解为“批注创建后产品一定自动改正文”。

判断：

- 自动监控默认关闭。
- 文案表达为“自动监控批注”，不是“自动修改文档”。
- Codex 仍通过 MCP instructions 判断回复、修改或保持 open。

## 22. 待定问题

- `.codex.json` 是否长期保持独立文件，还是未来合并进 `.review.json` 的连接字段。
- Codex App Server 协议未来是否会稳定保留 `thread/resume` 和 `turn/start`。
- Codex 是否能稳定向 MCP 或 Adapter 暴露当前会话标识和 `cwd`。
- 是否要显示来源会话标题。
- 是否要提供“从 App 打开来源 Codex 会话”的 deep link。
- 自动监控开关未来是否需要全局默认值。
- 是否要支持从最近 Codex threads 中选择，作为复制接续指令之外的增强入口。
