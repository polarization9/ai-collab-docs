# Margent 多 Agent 协作适配 PRD

## 1. 背景

Margent 当前的核心价值是：用户在本地 Markdown 文档上批注，AI agent 可以读取批注、理解上下文、回复、修改文档，并把处理状态写回 Margent。

目前这套能力深度绑定 Codex。短期内这能保证体验完整，但长期会带来三个问题：

1. 产品叙事过窄：Margent 看起来像 Codex 附属工具，而不是独立的 Markdown Agent 协作工作台。
2. 扩展成本高：适配 Claude Code、Custom CLI 或其他 agent 时，需要改动大量 Codex 专用模型。
3. 上架和签名风险更难拆解：当前外部 agent、sidecar、本地文件授权混在一起，不利于之后设计 GitHub 版 / Store Edition。

因此，需要把 Margent 改造成通用 Agent 协作架构，同时保持 Codex 作为第一优先、完整可用的 provider。

## 2. 产品目标

第一阶段目标：

把 Margent 从 “Codex-specific collaboration” 改造成 “Agent-based collaboration”。

完成后用户应该感受到：

- 我仍然可以像现在一样用 Codex 协作。
- Margent 的 UI 和文档不再把能力限制为 Codex。
- 将来可以接入 Claude Code、Custom CLI 或其他 agent。
- 批注、投递、回复、文档编辑、handled 状态这些核心流程不变。

一句话定位：

> Margent 是一个本地优先的 Markdown 阅读、批注、轻编辑与 Agent 协作桌面 App。

## 3. 非目标

第一阶段不做这些事：

- 不处理 Mac App Store sandbox。
- 不重做 Tauri 打包链路。
- 不移除 Codex。
- 不要求 Claude Code 在第一阶段达到 Codex 同等自动化能力。
- 不做复杂插件市场。
- 不引入云端账号或远程同步。

## 4. 用户场景

### 场景 A：继续使用 Codex

用户打开 Markdown 文档，写下一条批注，点击“发送给 Codex”。Codex 读取批注上下文，回复或修改文档，并把事件标记为 handled。

验收标准：

- 旧 Codex 流程不退化。
- 旧 `.codex.json` 配置仍可读取。
- 自动投递功能仍可用。

### 场景 B：用户理解 Margent 支持 Agent，而不只是 Codex

用户进入设置或批注侧栏时，看到的是 Agent 协作能力。Codex 是当前连接的 Agent provider。

验收标准：

- 主 UI 使用 “Agent 协作” 作为能力名称。
- provider 层显示 “Codex”。
- 用户能区分“这个功能是 Margent 的协作协议”和“当前执行端是 Codex”。

### 场景 C：为 Claude Code 做准备

用户未来可以选择 Claude Code 作为 provider。第一阶段不要求完整自动投递，但数据模型、API、UI 不能再阻碍 Claude Code 接入。

验收标准：

- provider 枚举支持 `claude-code`。
- Agent link 结构能保存 Claude Code session / cwd / displayName。
- MCP 工具命名不再 Codex-only。

### 场景 D：自定义 CLI Agent

高级用户可以配置一个自定义 CLI agent，让 Margent 把批注上下文投递给外部命令。

第一阶段只要求结构预留，不要求完整配置 UI 做到最终形态。

## 5. 功能需求

### FR1：新增 Agent Link 模型

新增通用 Agent 文档连接模型：

```ts
type AgentProvider = "codex" | "claude-code" | "custom-cli";
type AgentSessionRole = "source" | "successor";
```

每个文档可以有：

- source agent：创建或绑定当前文档的 agent。
- target agent：接收批注任务的 agent。
- auto-send 状态。
- 最近一次投递事件记录。

新的侧车文件：

```text
Document.margent-agent.json
```

旧文件继续兼容读取：

```text
Document.codex.json
```

### FR2：Codex 作为 Agent Provider

Codex adapter 必须保留当前能力：

- 绑定当前 Codex thread。
- 自动发现或手动配置目标 thread。
- 手动发送批注。
- 自动发送新批注。
- 通过 MCP 读取批注、回复、编辑文档、标记 handled。
- 记录 delivery 状态。

Codex 相关实现应被封装在 Codex provider 内部，上层只理解 Agent。

### FR3：新增 Agent API

新增主 API：

```text
GET /api/agent-link
PUT /api/agent-link
POST /api/bridge/annotations/:id/send-to-agent
```

保留旧 API 作为兼容别名：

```text
GET /api/codex-link
PUT /api/codex-link
POST /api/bridge/annotations/:id/send
```

旧 API 不作为新代码主路径。

### FR4：新增 Agent MCP 工具

新增：

```text
reviewer_get_agent_link
reviewer_update_agent_link
reviewer_bind_current_agent_session
```

保留：

```text
reviewer_get_codex_link
reviewer_update_codex_link
reviewer_bind_current_codex_thread
```

旧 Codex 工具内部映射为：

```text
provider = "codex"
```

### FR5：UI 文案升级

界面主文案从 Codex 协作改为 Agent 协作。

示例：

- “Agent 协作”
- “发送给 Agent”
- “发送给 Codex”
- “自动协作”
- “当前 Agent”
- “连接 Agent”

当 provider 是 Codex 时，按钮可以显示：

```text
发送给 Codex
```

但模块标题不应再叫：

```text
Codex Bridge
```

### FR6：Claude Code / Custom CLI 预留

第一阶段只做架构准备：

- provider 类型支持。
- link 文件支持。
- UI provider slot 支持。
- bridge adapter interface 支持。

不要求 Claude Code 自动协作闭环在第一阶段完成。

## 6. 兼容性要求

必须兼容：

- 现有 `.review.json`。
- 现有 `.codex.json`。
- 现有 Codex MCP 工具名。
- 现有 Codex 自动投递。
- 现有 GitHub Release 分发方式。

不允许因为 Agent 化导致已有用户文档无法继续协作。

## 7. 验收标准

第一阶段完成标准：

- Codex 协作全流程可用。
- UI 已经从 Codex-only 叙事升级为 Agent 协作叙事。
- 新的 `Document.margent-agent.json` 能正常读写。
- 旧 `.codex.json` 能自动迁移读取。
- MCP 新旧工具都能工作。
- `npm run typecheck` 通过。
- `npm run check:i18n-copy` 通过。
- `npm run check:release` 通过。
- 文档说明 Codex 是第一个完整支持的 Agent provider。

## 8. 后续阶段

### 阶段 2：Claude Code 适配

目标：

- 支持 Claude Code MCP 方式协作。
- 评估 CLI headless 投递。
- 判断是否能实现 session resume / completion tracking。

### 阶段 3：Custom CLI

目标：

- 用户配置命令模板。
- Margent 生成批注上下文 prompt。
- 外部 CLI 执行后，把结果回写到批注线程。

### 阶段 4：Apple 签名

目标：

- Developer ID Application 签名。
- sidecar server 完整签名。
- hardened runtime。
- notarized DMG。

### 阶段 5：Mac App Store 评估

目标：

- sandbox 版本可行性。
- security-scoped bookmarks。
- 一次性授权文档目录和 Agent 工作区。
- 判断 GitHub 版 / Store Edition 是否分轨维护。
