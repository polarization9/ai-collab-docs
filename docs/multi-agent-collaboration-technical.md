# Margent 多 Agent 协作适配技术方案

## 1. 文档信息

- 产品名称：Margent
- 技术模块：多 Agent 协作适配
- 关联 PRD：`docs/multi-agent-collaboration.md`
- 目标分支：`codex/multi-agent-adapter`
- 目标版本：v0.2.0 preview
- 当前状态：技术方案草案

## 2. 设计边界

本阶段目标是把当前 Codex 专用协作链路改造成 Agent 中性的协作链路，同时保持 Codex 作为第一优先、完整可用的 provider。

产品负责：

- 保存文档与 Agent 会话之间的连接关系。
- 在用户手动发送或开启自动协作后，把批注任务投递给当前目标 Agent。
- 提供 Agent 中性的 MCP 工具，让 Agent 读取文档、读取批注、回复批注、修改正文和标记事件 handled。
- 继续兼容旧的 Codex link 文件、旧 MCP 工具名和旧 API。
- 为 Claude Code 和 custom CLI provider 预留稳定的数据结构和 adapter 接口。

产品不负责：

- 不在第一阶段实现 Claude Code 的完整自动续写闭环。
- 不在第一阶段实现复杂的插件市场或 provider 安装流程。
- 不把 Codex 历史会话、Claude Code 历史会话或其他 agent 聊天记录复制进 Margent。
- 不在第一阶段处理 Mac App Store sandbox、security-scoped bookmarks 或 MAS Store Edition。
- 不引入云端账号、远程同步或服务端中转。

核心原则：

```text
Margent 定义批注协作协议
Agent provider 负责具体执行通道
Codex 是第一个完整 provider
```

## 3. 当前实现基础

当前代码的 Codex 耦合点主要集中在：

- `src/shared/codexTypes.ts`：Codex link 类型。
- `src/server/codexLink.ts`：`.codex.json` 读写、绑定、接续指令。
- `src/server/bridge.ts`：Codex app-server 投递、事件队列调度。
- `src/mcp/tools.ts`：Codex link MCP 工具。
- `src/mcp/server.ts`：MCP server instructions 中的 Codex 绑定说明。
- `src/server/index.ts`：`/api/codex-link`、`/api/bridge/annotations/:id/send`。
- `src/web/api.ts`、`AnnotationWorkspace`、`AnnotationSidebar`：前端 Codex link 状态和发送入口。
- `src/shared/reviewTypes.ts`：`ReviewEvent` 中的 `sourceThreadId`、`targetThreadId`、`targetType`、`delivery.adapter` 等 Codex 语义字段。
- `README.md`、初始化指南和内置 Quickstart 文案。

本阶段不做“全量重写”。改造方式是新增 Agent 中性层，再把现有 Codex 实现迁移成第一个 adapter。

## 4. 总体架构

目标架构：

```text
Margent.app
├── Tauri Shell
│   ├── 文件关联
│   ├── sidecar 生命周期
│   └── WebView 容器
├── Reviewer Server
│   ├── Document API
│   ├── Review API
│   ├── Agent Link API
│   ├── Review Event API
│   └── Agent Bridge API
├── Reviewer MCP
│   ├── 文档读取
│   ├── 批注上下文读取
│   ├── 批注回复和状态更新
│   ├── Markdown 正文修改
│   ├── Agent Link 绑定
│   └── Review Event 读取和状态更新
└── Agent Bridge
    ├── Codex App Server Adapter
    ├── Claude Code Adapter 预留
    └── Custom CLI Adapter 预留
```

关键变化：

- 上层只依赖 Agent link 和 Agent bridge。
- Codex thread、Codex app-server、Codex command discovery 只存在于 Codex adapter 内部。
- UI 展示“Agent 协作”，但 provider badge 仍显示 `Codex`。
- 旧 Codex API 和 MCP 工具作为兼容别名保留。

## 5. 数据模型设计

### 5.1 新增 Agent 类型

新增 `src/shared/agentTypes.ts`。

```ts
export type AgentProvider = "codex" | "claude-code" | "custom-cli";

export type AgentSessionRole = "source" | "successor";

export type AgentConfiguredBy = "agent" | "user";

export type AgentConfiguredVia =
  | "source"
  | "mcp-bind-instruction"
  | "manual"
  | "local-discovery";

export type AgentSessionReference = {
  provider: AgentProvider;
  role?: AgentSessionRole;
  sessionId?: string;
  cwd?: string;
  displayName?: string;
  configuredAt?: string;
  configuredBy?: AgentConfiguredBy;
  configuredVia?: AgentConfiguredVia;
};

export type AgentDocumentLink = {
  version: 1;
  documentPath: string;
  source?: AgentSessionReference;
  target?: AgentSessionReference;
  bridge?: {
    autoSendNewAnnotations?: boolean;
    lastDeliveredEventId?: string;
    lastDeliveryAt?: string;
  };
};

export type AgentLinkConnection = {
  hasSource: boolean;
  hasTarget: boolean;
  provider: AgentProvider | null;
  targetRole: AgentSessionRole | null;
  autoSendNewAnnotations: boolean;
  sourceAvailable: boolean | null;
};

export type AgentLinkResponse = {
  documentPath: string;
  agentLinkPath: string;
  legacyCodexLinkPath?: string;
  link: AgentDocumentLink | null;
  connection: AgentLinkConnection;
};
```

字段约定：

- `sessionId` 是 provider 内部会话 id。Codex 中对应原 `threadId`。
- `role` 只表达 Margent 视角的 source / successor，不再叫 `targetType`。
- `provider` 决定 bridge adapter 选择。
- 第一阶段 `claude-code` 和 `custom-cli` 只需要能被保存和显示，不要求完整自动投递。

### 5.2 Agent link 文件路径

在 `src/server/paths.ts` 新增：

```ts
export function getAgentLinkPath(absolutePath: string): string {
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}.margent-agent.json`);
}
```

保留：

```ts
getCodexLinkPath(absolutePath)
```

用于读取旧文件和兼容旧 API。

### 5.3 旧 Codex link 映射规则

新增 `src/server/agentLink.ts`，负责：

- 读取 `Document.margent-agent.json`。
- 如果新文件不存在，读取旧 `Document.codex.json`。
- 把旧 `CodexDocumentLink` 映射为新的 `AgentDocumentLink`。
- 所有写入统一写到 `Document.margent-agent.json`。
- 不删除旧 `Document.codex.json`。

映射规则：

```text
CodexDocumentLink.source.threadId
→ AgentDocumentLink.source.sessionId

CodexDocumentLink.source.cwd
→ AgentDocumentLink.source.cwd

CodexDocumentLink.target.threadId
→ AgentDocumentLink.target.sessionId

CodexDocumentLink.target.type
→ AgentDocumentLink.target.role

configuredBy: "codex"
→ configuredBy: "agent"

provider
→ "codex"
```

如果旧 link 只有 source、没有 target，继续沿用当前逻辑：source 自动作为 target。

### 5.4 ReviewEvent 兼容扩展

`ReviewEvent` 当前包含 Codex 语义字段。第一阶段采用“新增字段 + 兼容旧字段”的方式，避免破坏旧 `.review.json`。

新增字段：

```ts
export type ReviewEventAgentRef = {
  provider: AgentProvider;
  role?: AgentSessionRole;
  sessionId?: string;
  cwd?: string;
};

export type ReviewEventDeliveryAdapter =
  | "codex-app-server"
  | "claude-code-cli"
  | "custom-cli";
```

`ReviewEvent` 增加：

```ts
sourceAgent?: ReviewEventAgentRef;
targetAgent?: ReviewEventAgentRef;
delivery?: {
  adapter?: ReviewEventDeliveryAdapter;
  provider?: AgentProvider;
  sessionId?: string;
  turnId?: string;
  deliveryId?: string;
  lastAttemptAt?: string;
};
```

旧字段保留读取：

```ts
sourceThreadId?: string;
sourceCwd?: string;
targetThreadId?: string;
targetCwd?: string;
targetType?: CodexTargetType;
```

写入策略：

- 新代码优先写 `sourceAgent`、`targetAgent`。
- 为兼容旧 UI 和旧工具，Codex provider 第一阶段可以继续同步写旧字段。
- 后续版本再考虑清理旧字段。

## 6. Server 模块设计

### 6.1 `agentLink.ts`

新增主模块：

```ts
loadAgentDocumentLink(markdownPath): Promise<AgentDocumentLink | null>
saveAgentDocumentLink(markdownPath, link): Promise<AgentDocumentLink>
updateAgentDocumentLink(markdownPath, request): Promise<AgentDocumentLink>
getAgentLinkResponse(markdownPath): Promise<AgentLinkResponse>
resolveAgentTarget(link): AgentSessionReference | null
bindAgentSession(markdownPath, input): Promise<AgentDocumentLink>
createAgentSuccessorInstruction(markdownPath, provider): SuccessorInstructionResponse
```

并保留 mutation queue，粒度仍按 Markdown 文档路径串行。

### 6.2 `codexLink.ts` 兼容层

`src/server/codexLink.ts` 不再作为主逻辑模块，而是变成兼容层：

- `getCodexLinkResponse` 调用 `getAgentLinkResponse` 后映射回旧 response。
- `updateCodexDocumentLink` 调用 `updateAgentDocumentLink`。
- `bindCodexThread` 调用 `bindAgentSession`，provider 固定为 `codex`。
- `createSuccessorInstruction` 生成旧 Codex 工具名版本的接续指令，保证旧流程能继续工作。

这样旧 UI 或旧 MCP 工具不会立刻断掉。

### 6.3 HTTP API

新增主 API：

```text
GET /api/agent-link
PUT /api/agent-link
POST /api/agent-link/successor-instruction
POST /api/agent-link/successor-instruction/copy
POST /api/bridge/annotations/:id/send-to-agent
```

保留旧 API：

```text
GET /api/codex-link
PUT /api/codex-link
POST /api/codex-link/successor-instruction
POST /api/codex-link/successor-instruction/copy
POST /api/bridge/annotations/:id/send
```

旧 API 行为：

- provider 固定视为 `codex`。
- response 保持旧 shape。
- 内部读写走 Agent link。

新建批注自动投递逻辑改为读取 `AgentLinkResponse.connection`，不再读取 `CodexLinkResponse.connection`。

## 7. Agent Bridge 设计

### 7.1 Adapter 接口

`src/server/bridge.ts` 改为 Agent bridge 主模块。

```ts
type SendToAgentInput = {
  provider: AgentProvider;
  sessionId: string;
  cwd?: string;
  documentPath: string;
  annotationId: string;
  eventId: string;
  targetRole?: AgentSessionRole;
  prompt: string;
  onTurnStarted?: (delivery: {
    provider: AgentProvider;
    sessionId: string;
    turnId?: string;
    deliveryId: string;
  }) => Promise<void>;
};

type SendToAgentResult = {
  ok: boolean;
  provider: AgentProvider;
  sessionId?: string;
  turnId?: string;
  deliveryId?: string;
  error?: string;
};

type AgentBridgeAdapter = {
  provider: AgentProvider;
  name: ReviewEventDeliveryAdapter;
  isAvailable(): Promise<boolean>;
  send(input: SendToAgentInput): Promise<SendToAgentResult>;
};
```

### 7.2 Codex adapter

把当前 `createCodexAppServerAdapter` 保留为：

```ts
createCodexAppServerAdapter(): AgentBridgeAdapter
```

映射：

```text
input.sessionId → Codex threadId
input.cwd → Codex cwd
input.targetRole → source / successor prompt 文案
```

adapter name 改为：

```text
codex-app-server
```

旧的 delivery adapter 名：

```text
app-server
```

读取时兼容，写入时优先写新名。

### 7.3 Adapter 选择

选择规则：

```text
resolveAgentTarget(link)
→ target.provider
→ 查找 provider 匹配的 adapter
→ adapter.isAvailable()
→ send()
```

如果没有 target：

```text
No Agent target session is bound for this document.
```

如果 provider 没有可用 adapter：

```text
No available Agent Bridge adapter is configured for provider: {provider}.
```

第一阶段只要求 Codex adapter 可完整可用。

### 7.4 Prompt 生成

`createBridgePrompt` 改为 provider 中性文案。

保留核心要求：

- 先调用 MCP 读取 annotation context。
- 明确回复批注或修改文档。
- 如果完成处理，标记 review event handled。
- 信息不足时回复说明，不假装完成。

Codex provider 可以附加 Codex 专用提示：

```text
你正在 Codex 会话中处理这条 Margent 批注。
```

通用版本不再把能力描述成 Codex-only。

## 8. MCP 工具设计

### 8.1 新工具

新增：

```text
reviewer_get_agent_link
reviewer_update_agent_link
reviewer_bind_current_agent_session
```

`reviewer_update_agent_link` 输入：

```ts
{
  documentPath?: string;
  provider?: "codex" | "claude-code" | "custom-cli";
  sourceSessionId?: string;
  targetSessionId?: string;
  targetRole?: "source" | "successor";
  cwd?: string;
  displayName?: string;
  autoSendNewAnnotations?: boolean;
}
```

`reviewer_bind_current_agent_session` 输入：

```ts
{
  documentPath?: string;
  provider: "codex" | "claude-code" | "custom-cli";
  role: "source" | "successor";
  sessionId?: string;
  cwd?: string;
  displayName?: string;
  autoSendNewAnnotations?: boolean;
}
```

### 8.2 旧工具兼容

保留旧工具：

```text
reviewer_get_codex_link
reviewer_update_codex_link
reviewer_bind_current_codex_thread
```

旧工具内部调用新工具逻辑：

```text
provider = "codex"
threadId → sessionId
targetType → targetRole
```

旧工具说明中标记为 compatibility alias，但不从当前 MCP server 移除。

### 8.3 MCP instructions

`src/mcp/server.ts` instructions 改为：

- 默认说 “Agent session”。
- 当 provider 是 Codex 时，可以使用 Codex 兼容工具。
- 新 agent 应优先使用 `reviewer_bind_current_agent_session`。

## 9. 前端改造设计

### 9.1 API client

`src/web/api.ts` 新增：

```ts
fetchAgentLink()
updateAgentLink()
createAgentSuccessorInstruction()
copyAgentSuccessorInstruction()
sendAnnotationToAgent()
```

旧函数保留或薄封装：

```ts
fetchCodexLink()
updateCodexLink()
sendAnnotationToCodex()
```

新 UI 优先使用 Agent API。

### 9.2 React 状态

`AnnotationWorkspace` 中：

```text
codexLink → agentLink
codexLinkError → agentLinkError
reloadCodexLink → reloadAgentLink
sendAnnotationToCodex → sendAnnotationToAgent
```

`AnnotationSidebar` 中：

```text
AnnotationCodexStatus → AnnotationAgentStatus
getCodexRouteView → getAgentRouteView
```

### 9.3 UI 文案

主模块文案改为：

```text
Agent 协作
当前 Agent
发送给 Agent
自动协作
连接 Agent
```

provider 显示：

```text
Codex
Claude Code
Custom CLI
```

当 provider 为 Codex 且目标已绑定时，按钮可以显示：

```text
发送给 Codex
```

这样用户既能理解产品能力是 Agent 协作，又能知道当前执行端是谁。

### 9.4 i18n

新增 `agent.*` key，逐步替换 `codex.*` key。

第一阶段保留旧 key，避免遗漏导致 UI 空文案。

中文和英文 locale 都要覆盖：

- 状态标题。
- 自动协作开关。
- 发送按钮。
- toast。
- failed / needs binding 错误。
- 接续指令复制成功提示。

## 10. 迁移与兼容策略

### 10.1 侧车文件

读取顺序：

```text
Document.margent-agent.json
Document.codex.json
```

写入规则：

```text
永远写 Document.margent-agent.json
不删除 Document.codex.json
```

理由：

- 避免破坏用户已有文件。
- 避免旧版本 Margent 无法读取原连接。
- 给 preview 测试留出回退空间。

### 10.2 Review event

读取旧 `.review.json` 时：

- 如果存在 `targetAgent`，使用新字段。
- 否则从 `targetThreadId`、`targetType`、`targetCwd` 生成临时 Codex target。

写入新事件时：

- 写 `targetAgent`。
- 如果 provider 是 Codex，同步写旧字段，保证旧 UI 和旧工具短期可读。

### 10.3 API

新前端使用 `/api/agent-link`。

旧 API 继续可用，直到至少一个正式版本之后再评估是否移除。

### 10.4 MCP

新 agent 使用 `reviewer_*_agent_*` 工具。

Codex 可以继续使用旧工具名，避免用户现有初始化文档和旧会话突然失效。

## 11. 实施顺序

### Step 1：类型和存储层

- 新增 `agentTypes.ts`。
- 新增 `getAgentLinkPath`。
- 新增 `agentLink.ts`。
- 实现旧 Codex link 到 Agent link 的 normalize / migration。
- 让 `codexLink.ts` 变成兼容层。

验收：

- 能读取旧 `.codex.json`。
- 能写入新 `.margent-agent.json`。
- `getCodexLinkResponse` 仍返回旧 shape。

### Step 2：ReviewEvent 和 Bridge

- 扩展 `ReviewEvent` agent 字段。
- 把 `sendAnnotationToCodex` 主逻辑迁移为 `sendAnnotationToAgent`。
- 把 Codex app-server 实现封装为 `codex-app-server` adapter。
- adapter 选择改为按 provider 分发。
- 自动投递改为读取 Agent target。

验收：

- Codex 手动发送批注成功。
- Codex 自动协作继续串行投递。
- 旧 failed event retry 不退化。

### Step 3：HTTP API

- 新增 `/api/agent-link` 系列。
- 新增 `/api/bridge/annotations/:id/send-to-agent`。
- 旧 `/api/codex-link` 和 `/api/bridge/annotations/:id/send` 映射到新逻辑。

验收：

- 新旧 API 都能返回合理结果。
- 旧 API 在 Codex provider 下不破坏现有前端。

### Step 4：MCP 工具

- 新增 Agent link MCP 工具。
- 旧 Codex MCP 工具改成 alias。
- 更新 MCP server instructions。
- 默认 agent reply author 从硬编码 `Codex` 改为 provider display name，兼容未传时仍使用当前 provider。

验收：

- Codex 旧工具名能绑定当前会话。
- 新 Agent 工具名能绑定 provider=`codex` 的会话。
- 批注读取、回复、编辑正文、标记 handled 不受影响。

### Step 5：前端 UI

- 前端数据流切到 Agent API。
- 组件命名和状态改为 Agent。
- i18n 文案改为 Agent 协作叙事。
- provider badge 显示当前执行端。

验收：

- 用户看到的是 Agent 协作。
- Codex provider 下按钮仍可显示“发送给 Codex”。
- 自动协作开关行为不变。

### Step 6：文档和 Preview 包准备

- 更新 README 中的产品定位。
- 更新 Quickstart 文案。
- 新增或更新初始化指南，把 Codex 描述为第一个完整 provider。
- 配置 preview 包名和 identifier 的实施方案，准备后续单独打包测试。

验收：

- 文档不再把 Margent 描述成 Codex-only。
- preview 包可以和正式版并存的打包方案明确。

## 12. 测试计划

### 12.1 自动检查

至少执行：

```bash
npm run typecheck
npm run check:i18n-copy
npm run check:release
```

如果 Rust/Tauri 环境可用：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

### 12.2 存储兼容测试

准备一个已有：

```text
Document.md
Document.review.json
Document.codex.json
```

验证：

- 打开文档后能读取旧 Codex 连接。
- 更新 Agent link 后生成 `Document.margent-agent.json`。
- 旧 `.codex.json` 没被删除。
- 重新打开文档后优先读取 `.margent-agent.json`。

### 12.3 Codex 协作回归测试

验证：

- 绑定当前 Codex 会话为 source。
- 复制接续指令并绑定 successor。
- 手动发送一条批注。
- 开启自动协作后创建新批注。
- Codex 通过 MCP 回复批注。
- Codex 修改正文并回复说明。
- Codex 标记 event handled。
- failed event 可以 retry。

### 12.4 API 兼容测试

验证：

- `GET /api/agent-link` 可用。
- `PUT /api/agent-link` 可用。
- `GET /api/codex-link` 仍可用。
- `PUT /api/codex-link` 仍可用。
- `POST /api/bridge/annotations/:id/send-to-agent` 可用。
- `POST /api/bridge/annotations/:id/send` 仍可用。

### 12.5 MCP 兼容测试

验证：

- `reviewer_get_agent_link`
- `reviewer_update_agent_link`
- `reviewer_bind_current_agent_session`
- `reviewer_get_codex_link`
- `reviewer_update_codex_link`
- `reviewer_bind_current_codex_thread`

其中新旧绑定工具都需要能把当前 Codex 会话绑定到同一个文档。

### 12.6 UI 回归测试

验证：

- Annotation sidebar 状态展示正确。
- 自动协作开关状态正确。
- 发送按钮 loading / error / success 状态正确。
- 未绑定 Agent 时提示用户先连接 Agent。
- provider 是 Codex 时，用户仍能看出当前执行端是 Codex。

## 13. 风险与处理原则

### 风险 1：只改文案，没有解耦架构

本质问题：

当前耦合不只是 UI 文案，而是 link schema、event schema、bridge adapter、MCP 工具名和 API 都以 Codex 为中心。

处理原则：

- 先建立 Agent link 和 Agent bridge。
- 再把 Codex 实现迁移进去。
- 不做单纯字符串替换。

### 风险 2：迁移破坏旧用户文件

本质问题：

用户的 `.codex.json` 和 `.review.json` 是本地协作状态，不是缓存。损坏或覆盖会直接影响真实文档协作。

处理原则：

- 旧文件只读兼容。
- 新写入走 `.margent-agent.json`。
- 不删除旧文件。
- Codex provider 第一阶段同步写旧 ReviewEvent 字段。

### 风险 3：过早把 Claude Code 做深

本质问题：

不同 agent 的会话恢复、完成状态、外部进程模型不一样。第一阶段如果为了 Claude Code 强行抽象过多，会拖慢 Codex 稳定迁移。

处理原则：

- 第一阶段只把 provider、session、adapter 接口打稳。
- Codex 完整闭环优先。
- Claude Code 深度 adapter 放到下一阶段验证。

### 风险 4：自动投递重复或卡队列

本质问题：

自动协作依赖 ReviewEvent 状态机和串行调度。一旦新旧字段混用不当，可能出现重复投递、事件一直 delivering、或 failed 后无法 retry。

处理原则：

- ReviewEvent 状态机不重做。
- 只替换 target resolution 和 adapter dispatch。
- 保留现有 stale delivering recovery。
- 手动测试 queued / delivering / sent / handled / failed / retry 全链路。

## 14. 完成标准

本技术方案对应的第一阶段完成标准：

- Codex 协作全流程不退化。
- 新 Agent link 数据模型落地。
- 新 `.margent-agent.json` 能读写。
- 旧 `.codex.json` 能读取兼容。
- 新旧 HTTP API 都能工作。
- 新旧 MCP 工具都能工作。
- UI 主叙事升级为 Agent 协作。
- README 和初始化文档说明 Codex 是第一个完整支持的 provider。
- 自动检查通过。
- 可以开始准备 `Margent Preview` 独立包测试。
