# Margent Agent Provider 接入标准

## 1. 文档目的

这份文档用于统一梳理 Margent 接入不同 Agent 产品时需要评估和改造的能力项。

适用对象包括：

- Codex
- Claude Code
- Gemini CLI
- Cursor / Windsurf 一类 IDE Agent
- 自定义 CLI Agent
- 未来新的本地或半本地 Agent 产品

核心目标不是为每个 Agent 单独设计一套流程，而是定义一套可复用的接入标准：

```text
先判断 Agent 能提供哪些通道
再决定 Margent 能做到哪个支持等级
最后按同一张能力清单补代码和验收
```

## 2. 基本判断

不同 Agent 的架构差异很大，不能假设它们都像 Codex 一样提供 app-server、thread resume 或完整的会话事件流。

Margent 接入新 Agent 时，先回答四个问题：

1. Agent 能不能使用 Margent MCP？
2. Margent 能不能从外部启动或唤起这个 Agent？
3. Agent 能不能接收一段 prompt 并在指定会话里继续执行？
4. Margent 能不能知道这次任务什么时候开始、什么时候完成、有没有失败？

这四个问题决定了支持等级。

## 3. 支持等级

### L0：MCP 手动协作

Agent 可以连接 Margent MCP，并由用户在 Agent 会话里手动要求它处理批注。

能力：

- Agent 能读取文档和批注。
- Agent 能回复批注。
- Agent 能修改 Markdown。
- Agent 能标记 annotation resolved 或 event handled。

不要求：

- Margent 自动投递批注。
- Margent 知道 Agent 当前会话 id。
- Margent 知道 Agent 任务何时完成。

适用：

- 大多数支持 MCP 的 Agent。
- 第一次验证新 Agent 是否可用。

### L1：MCP 绑定协作

Agent 可以通过 `reviewer_bind_current_agent_session` 把当前会话绑定到文档。

能力：

- Margent 能保存当前 Agent provider、sessionId、cwd、displayName。
- Margent UI 能显示当前绑定的 Agent。
- 用户可以明确知道“这份文档现在连接到哪个 Agent”。

不要求：

- Margent 自动把批注送进该会话。

适用：

- 支持 MCP，但不一定支持 headless prompt 注入的 Agent。

### L2：手动投递

用户在 Margent 里点击 `@ Agent`，Margent 可以把批注任务送进目标 Agent。

能力：

- Margent 有对应 provider adapter。
- Adapter 能启动或调用 Agent。
- Adapter 能把 bridge prompt 送给 Agent。
- Agent 能通过 MCP 回读上下文并写回结果。
- Margent 能记录 delivery status。

不要求：

- 自动监控新批注。
- 完整会话发现。
- 精确 token/cost 统计。

适用：

- Claude Code 第一阶段。
- Custom CLI 第一阶段。

### L3：自动投递

用户开启自动协作后，新批注会自动投递给当前 Agent。

能力：

- L2 全部能力。
- Review event 队列可以稳定重试和恢复。
- Adapter 能避免重复投递。
- Agent 处理完成后能把 event 标记 handled。

适用：

- 需要接近 Codex 现有体验的 provider。

### L4：会话发现与接续

Margent 可以自动发现 Agent 来源会话，或稳定接续到已有会话。

能力：

- 自动发现 source session。
- 自动生成 successor binding instruction。
- Adapter 能 resume 指定 session。
- Delivery 记录能关联 provider sessionId / turnId。

适用：

- 有本地 session 日志或明确 resume API 的 Agent。

### L5：完整产品化

该 Agent 可以作为 Margent 的正式可选 provider 出现在设置页。

能力：

- UI 可选择 provider。
- 安装和可用性检测完整。
- 错误提示可理解。
- i18n 完整。
- 文档和测试完整。
- 打包分发链路验证通过。

适用：

- 准备公开发布的 provider。

## 4. 能力清单

### 4.1 Provider 身份

目标：

让 Margent 能用统一方式识别 Agent。

Agent 侧要求：

- 有稳定名称。
- 有可检测的本地命令、应用、MCP client 或 API。

Margent 改造：

- 在 `AgentProvider` 中增加 provider 值。
- 增加 display name 映射。
- 增加 provider availability check。
- 更新 UI provider badge。

验收：

- 新 provider 可以被保存到 `Document.margent-agent.json`。
- UI 可以显示 provider 名称。
- 不影响 Codex provider。

### 4.2 MCP 接入

目标：

让 Agent 能读取和修改 Margent 文档上下文。

Agent 侧要求：

- 支持 MCP server 配置。
- 能启动 `margent-mcp`。
- 能调用 Margent MCP tools。

Margent 改造：

- 保持 `reviewer_get_annotation_context`、`reviewer_add_annotation_reply`、`reviewer_apply_document_edit`、`reviewer_update_annotation_status`、`reviewer_mark_review_event_handled` 等工具 provider 中性。
- 新 Agent 优先使用 `reviewer_bind_current_agent_session`。
- 旧 Codex 工具作为 compatibility alias 保留。

验收：

- Agent 可以读取指定文档的批注上下文。
- Agent 可以回复批注。
- Agent 可以编辑 Markdown。
- Agent 可以把 event 标记 handled。

### 4.3 会话绑定

目标：

让 Margent 知道哪一个 Agent 会话正在处理这份文档。

多 Agent 绑定语义：

```text
source = 文档来源会话
target = 当前协作目标
event.targetAgent = 单次投递目标快照
```

`source` 和 `target` 必须分开处理。一个文档可以来源于 Codex，但当前批注投给 Claude Code；也可以来源于 Claude Code，但当前批注投给 custom CLI。

绑定优先级：

```text
用户手动选择 / MCP 显式绑定
> 成功投递后同 provider、同绑定身份 sessionId 回写
> 本地日志自动发现
```

Agent 侧要求：

- 如果 provider 有长期上下文会话，必须能提供可 resume 的 sessionId / conversation id。
- 如果 provider 不支持长期上下文，必须在 adapter capability 中明确声明不支持 resume，且不能伪装成 L4。
- 如果没有 sessionId，最多只能保存 provider、cwd、displayName 作为诊断信息，不能视为可投递 target。

Margent 改造：

- 使用 `reviewer_bind_current_agent_session` 绑定 source 或 successor。
- 写入 `source` / `target` 到 `Document.margent-agent.json`。
- 对没有 sessionId 的 sessionful provider，允许 L1 诊断性记录，但不允许 L2/L3 投递。
- 自动发现不能覆盖已有可投递 target；缺少 sessionId 的 sessionful target 只是诊断信息，不应阻止高置信自动发现修复连接。
- 只有当文档没有可投递 target，且统一 Discovery 产出高置信胜出候选时，自动发现才可以写入 target。
- 自动发现默认只写当前 `target`；只有候选明确是 `source` 会话，且文档还没有 source 时，才可以同时补写 `source`。
- 如果候选明确是 `successor`，只能写 `target.role = "successor"`，不能把它写成文档来源 `source`。
- 多 provider 候选必须放进统一 Discovery 判断，不能按 provider 顺序 fallback。
- event 创建时必须冻结当前 target 到 `event.targetAgent`；dispatch 时优先使用该快照。
- event 快照需要保留 target 的 sessionId / cwd / configuredAt 等身份信息。
- sessionId 回写只能更新同 provider 且仍是同一个绑定身份的 target，不能覆盖用户后来手动切换的当前连接。

验收：

- 绑定后 Margent UI 能显示当前 Agent。
- 关闭并重新打开文档后绑定仍存在。
- 旧 `.codex.json` 迁移读取仍正常。
- 打开历史文档时，来源自动发现不会把当前 target 从 Claude Code 切回 Codex。
- 投递过程中切换当前连接时，旧投递结果不会把 target 写回旧连接。
- 如果多个 provider 都有候选但证据没有清晰胜出者，Margent 不自动绑定，提示用户手动连接。

### 4.4 批注上下文协议

目标：

保证所有 Agent 拿到同一份任务上下文。

Agent 侧要求：

- 能理解 bridge prompt。
- 能按要求调用 MCP 读取 annotation context，而不是只依赖 prompt 里的摘要。

Margent 改造：

- `createBridgePrompt` 使用 provider 中性文案。
- prompt 中明确要求：
  - 读取 annotation context。
  - 根据批注回复或修改文档。
  - 完成后标记 handled。
  - 信息不足时回复说明。
- 允许 provider adapter 附加少量 provider-specific instruction。

验收：

- 同一条批注投给 Codex / Claude Code / custom CLI 时，Agent 都能知道文档路径、annotationId、eventId。
- Agent 不需要猜测 Margent 侧车文件结构。

### 4.5 回复批注

目标：

Agent 可以把处理结果写回批注线程。

Agent 侧要求：

- 能调用 MCP tool。

Margent 改造：

- `reviewer_add_annotation_reply` 保持 provider 中性。
- reply author 根据 provider 显示为 `Codex`、`Claude Code` 或自定义 displayName。
- 避免在 review 文件里写死 Codex author。

验收：

- 批注线程出现 Agent 回复。
- author 名称正确。
- 回复后文档不被意外修改。

### 4.6 修改文档

目标：

Agent 可以在明确需要时修改 Markdown 正文。

Agent 侧要求：

- 能读取完整 Markdown。
- 能提交完整编辑后的 Markdown 或明确 patch。

Margent 改造：

- `reviewer_apply_document_edit` 继续作为主写入工具。
- 编辑成功时可以同时 re-anchor annotation。
- 编辑成功时可以同时标记 event handled。
- 冲突检测沿用现有文档保存逻辑。

验收：

- Markdown 文件内容被正确修改。
- `.review.json` 中批注锚点仍尽量可用。
- 外部变更冲突不会被静默覆盖。

### 4.7 resolved 与 handled 状态同步

目标：

统一用户状态和投递事件状态。

概念：

- `resolved` 是批注对用户是否已解决。
- `handled` 是某次投递事件对系统是否已处理。

Margent 改造：

- 当 Agent 明确把 annotation 标记为 resolved 且传入 eventId 时，同步把 event 标记 handled。
- 当 Agent 只回复但保持 annotation open 时，只能标记 event handled，不能强行 resolved。
- 当用户手动 resolved 时，可以同步处理当前打开的 event，前提是该 event 对应同一个 annotation 且仍处于待处理状态。

验收：

- Agent 完成处理后不会继续显示“未处理”。
- 用户只想保留讨论时，annotation 可以 open 但 event handled。
- 不同 annotation 的 event 不会被误标。

### 4.8 手动投递

目标：

用户点击 `@ Agent` 后，Margent 把批注任务送入目标 Agent。

Agent 侧要求：

- 有可调用入口。
- 入口能接收 prompt。
- 最好能指定 cwd。
- 最好能指定或恢复 session。

Margent 改造：

- 为 provider 增加 `AgentBridgeAdapter`。
- 实现 `isAvailable()`。
- 实现 `send(input)`。
- 在 `bridgeAdapters` 注册 provider adapter。
- 记录 delivery adapter、provider、sessionId、turnId、deliveryId。
- 对需要上下文的 provider，adapter 必须 resume 指定 session，不能在缺少 sessionId 时创建新会话。

验收：

- 点击 `@ Agent` 后 delivery status 从 queued 进入 delivering / sent / handled。
- Agent 实际收到任务。
- Agent 能通过 MCP 写回结果。
- adapter 不可用时给出清楚错误。

### 4.9 自动投递

目标：

自动监控新批注并投递给当前 Agent。

Agent 侧要求：

- L2 能力稳定。
- Agent 处理速度和失败模式可接受。

Margent 改造：

- 自动监控读取 Agent link，而不是 Codex link。
- event queue 使用 provider 中性字段。
- stale delivery recovery 适用于所有 provider。
- 对 provider 不可用时停止自动投递并显示错误。

验收：

- 开启自动协作后，新批注自动投递。
- 同一事件不会重复投递。
- App 重启后未完成事件可以恢复或明确失败。

### 4.10 Session resume

目标：

让 Agent 在同一个会话里延续上下文。

Agent 侧要求：

- 提供 sessionId 或 conversation id。
- 提供 resume 命令、API 或本地协议。

Margent 改造：

- `AgentSessionReference.sessionId` 保存 provider 原生 session id。
- adapter 在 `send()` 中恢复目标 session。
- 如果 provider 不支持 resume，明确标记支持等级不能超过 L2；不能把“每次新会话投递”包装成 L3/L4 自动协作。
- 如果 resume 失败，事件应 failed needsBinding 或提示重新绑定，不能静默开新 session。

验收：

- 多次批注投递进入同一个目标会话。
- Agent 能看到上一轮协作上下文。
- delivery 记录里 sessionId 一致。

### 4.11 任务完成追踪

目标：

Margent 能判断投递任务完成、失败或超时。

Agent 侧要求：

- 最好有事件流或命令退出码。
- 至少能通过 MCP handled 状态回写完成。

Margent 改造：

- adapter 尽量等待 Agent turn completion。
- 没有 completion API 时，以 MCP handled 写入作为最终完成信号。
- 完成证据优先级必须 provider 中性：
  - Agent 显式调用 `reviewer_mark_review_event_handled` 或 `reviewer_update_annotation_status(..., eventId)`。
  - Agent 调用 `reviewer_apply_document_edit(..., eventId)` 并在编辑成功时同步处理 event。
  - event 创建后出现 Agent 回复，或批注在 event 创建后变成 resolved，可以作为修复历史状态的完成证据。
  - CLI / app-server 进程退出只能说明投递进程结束，不能比 MCP 写回证据更强。
- 如果进程退出但 review 文件已经出现完成证据，Margent 应以 review 状态为准，把 event 修复为 handled。
- 如果进程退出且没有任何完成证据，才把 event 标记为 failed。
- 保持临时 debug monitor 脚本用于调试耗时。

验收：

- delivery status 最终进入 handled 或 failed。
- Agent 已经回复或解决批注时，重启 Margent 后不会继续显示“未投递/处理中”。
- 超时错误可解释。
- 调试时能拆出 queue、delivery、agent processing、handled 写入耗时。

### 4.12 错误处理

目标：

用户能理解为什么协作没有发生。

Agent 侧常见错误：

- 未安装 Agent。
- 未登录或 API key 不可用。
- MCP 未配置。
- sessionId 无效。
- provider 不支持 resume。
- 模型调用失败或预算不足。

Margent 改造：

- adapter 返回 provider-specific error。
- UI 显示用户可行动的错误。
- 不做过多自动兜底，除非会造成数据丢失或重复投递。

验收：

- 失败事件保留在 `.review.json`。
- 用户可以重试。
- 不会因为失败丢失批注。

### 4.13 可观测性

目标：

调试 Agent 协作体验时能看到真实耗时。

Margent 改造：

- 保留 delivery timestamps。
- 临时脚本读取 `.review.json` 监控 event 状态。
- 后续如产品化，只暴露轻量状态，不把调试日志塞进主 UI。

验收：

- 能看到 queued、delivering、sent、processing、handled 的时间变化。
- 能区分 Margent 工程耗时和 Agent 模型处理耗时。

### 4.14 UI 与 i18n

目标：

让用户理解 Margent 是 Agent 协作工具，而不是只属于某个 Agent。

Margent 改造：

- 主能力叫 `Agent 协作`。
- provider badge 显示当前执行端。
- 按钮可以根据 provider 显示 `发送给 Codex`、`发送给 Claude Code`。
- 设置页提供 provider 状态和启用入口。
- 中英文文案都要覆盖。

验收：

- Codex 用户体验不退化。
- 新 provider 不需要复制一套 Codex UI。
- 未配置 provider 时，提示清楚。

### 4.15 文件权限与安全

目标：

Agent 能处理用户授权的文档，但 Margent 不扩大不必要权限。

Agent 侧要求：

- 能访问 MCP 暴露的文档内容。
- 如需直接读写本地文件，应由用户明确授权或由 Margent MCP 代写。

Margent 改造：

- Agent 默认通过 MCP 读写文档。
- 不要求 Agent 直接读取 `.review.json` 或 `.margent-agent.json`。
- GitHub 版可以允许更完整的本地 Agent 集成。
- Store Edition 需要单独评估 sandbox、security-scoped bookmarks 和外部进程权限。

验收：

- Agent 不需要知道侧车文件路径也能协作。
- 用户文档不会被未绑定 Agent 随意修改。

## 5. 新 Provider 标准接入流程

### Step 1：能力调研

需要确认：

- 是否支持 MCP。
- 是否支持 CLI / headless 调用。
- 是否支持指定 cwd。
- 是否支持 session resume。
- 是否支持事件流或完成状态。
- 鉴权方式是什么。
- 模型和成本配置在哪里。

输出：

- provider 支持等级初判。
- 需要 Margent 改造的能力项。

### Step 2：L0 MCP 验证

先不改 bridge。

验证：

- 注册 Margent MCP。
- Agent 手动读取 annotation context。
- Agent 回复批注。
- Agent 修改文档。
- Agent 标记 handled / resolved。

通过后，说明这个 Agent 能作为 Margent 协作者。

### Step 3：L1 绑定验证

实现或测试：

- `reviewer_bind_current_agent_session`
- provider 写入 `Document.margent-agent.json`
- UI 显示 provider

通过后，说明 Margent 可以记住这个 Agent。

### Step 4：L2 手动投递 adapter

实现：

- `create{Provider}Adapter()`
- `isAvailable()`
- `send(input)`
- 注册到 `bridgeAdapters`
- provider-specific prompt 附加说明

通过后，用户可以从 Margent 主动把批注送给 Agent。

### Step 5：L3 自动投递

只有 L2 稳定后再做。

验证：

- 自动监控新批注。
- event 不重复。
- App 重启恢复合理。
- 失败可重试。

### Step 6：L4/L5 产品化

按风险逐步补：

- session discovery
- provider 设置页
- 安装检测
- i18n
- README / Quickstart
- release smoke test
- MAS 风险评估

## 6. External Adapter Protocol

External Adapter Protocol 用于支持第三方 Agent 或高级用户在不修改 Margent 主代码的情况下接入 Margent。

它不是替代官方内置 adapter。它的定位是：

```text
内置 adapter：Margent 官方维护，体验最好
Custom CLI：用户配置命令模板，适合简单接入
External Adapter：第三方实现标准协议，适合严肃集成
```

### 6.1 设计目标

External Adapter 应该做到：

- 让第三方 Agent 声明自己支持哪些 Margent 能力。
- 让 Margent 用统一方式检测 adapter 是否可用。
- 让 Margent 用统一 JSON 输入投递批注任务。
- 让 adapter 用统一 JSON 输出返回 session、turn、delivery 和错误信息。
- 让 Agent 通过 Margent MCP 完成真正的读取、回复、编辑和状态写回。

External Adapter 不应该做到：

- 不要求 Margent 理解第三方 Agent 的内部会话文件。
- 不要求第三方 Agent 直接读写 `.review.json`。
- 不要求第三方 Agent 绕过 Margent MCP 修改 Markdown。
- 不把 API key、模型配置或私密凭据写进 Margent 文档侧车文件。

### 6.2 Adapter Manifest

第三方 adapter 通过 manifest 声明身份、命令和能力。

建议文件名：

```text
margent-adapter.json
```

示例：

```json
{
  "schemaVersion": 1,
  "id": "my-agent",
  "displayName": "My Agent",
  "description": "My Agent Margent adapter",
  "command": "my-agent-margent-adapter",
  "args": [],
  "env": {},
  "homepage": "https://example.com",
  "supports": {
    "mcp": true,
    "bind": true,
    "manualSend": true,
    "autoSend": false,
    "sessionResume": false,
    "completionTracking": true,
    "cwd": true
  }
}
```

字段说明：

- `schemaVersion`：协议版本，第一版为 `1`。
- `id`：provider id，建议使用小写字母、数字和短横线。
- `displayName`：展示给用户看的名称。
- `command`：Margent 调用的 adapter 可执行命令。
- `args`：固定参数。
- `env`：非私密环境变量。私钥、API key 不应写在这里。
- `supports`：能力声明，用于 UI、验收和安全限制。

### 6.3 Adapter 命令接口

External Adapter 至少需要支持三个子命令：

```text
my-agent-margent-adapter capabilities
my-agent-margent-adapter health
my-agent-margent-adapter send
```

可选支持：

```text
my-agent-margent-adapter bind
my-agent-margent-adapter resume
```

命令约定：

- 输入优先从 stdin 读取 JSON。
- 输出只向 stdout 写 JSON。
- 诊断日志写 stderr。
- 成功退出码为 `0`。
- 失败退出码非 `0`，同时 stdout 返回结构化错误。

### 6.4 `capabilities`

用途：

让 Margent 在不读取 manifest 的情况下，也能询问 adapter 当前能力。

输出示例：

```json
{
  "ok": true,
  "provider": {
    "id": "my-agent",
    "displayName": "My Agent"
  },
  "supports": {
    "mcp": true,
    "bind": true,
    "manualSend": true,
    "autoSend": false,
    "sessionResume": false,
    "completionTracking": true,
    "cwd": true
  }
}
```

验收：

- Margent 能解析输出。
- 输出能力与 manifest 不矛盾。

### 6.5 `health`

用途：

检测 adapter 和底层 Agent 是否可用。

输入示例：

```json
{
  "schemaVersion": 1,
  "cwd": "/Users/example/project",
  "mcp": {
    "serverName": "margent",
    "configured": true
  }
}
```

输出示例：

```json
{
  "ok": true,
  "status": "ready",
  "agentVersion": "1.2.3",
  "warnings": []
}
```

失败示例：

```json
{
  "ok": false,
  "status": "not-ready",
  "error": {
    "code": "mcp_not_configured",
    "message": "My Agent cannot find the Margent MCP server."
  }
}
```

常见错误码：

- `command_not_found`
- `not_authenticated`
- `mcp_not_configured`
- `invalid_cwd`
- `provider_unavailable`
- `unknown`

### 6.6 `bind`

用途：

让 adapter 返回当前 Agent 会话信息。不是所有 Agent 都能做到。

输入示例：

```json
{
  "schemaVersion": 1,
  "documentPath": "/Users/example/Documents/Test.md",
  "role": "successor",
  "cwd": "/Users/example/project"
}
```

输出示例：

```json
{
  "ok": true,
  "session": {
    "provider": "my-agent",
    "sessionId": "session_123",
    "cwd": "/Users/example/project",
    "displayName": "My Agent",
    "role": "successor"
  }
}
```

如果 Agent 没有可暴露的 sessionId，可以返回：

```json
{
  "ok": true,
  "session": {
    "provider": "my-agent",
    "cwd": "/Users/example/project",
    "displayName": "My Agent",
    "role": "successor"
  },
  "warnings": [
    "This agent does not expose a stable session id. Margent can bind the provider, but cannot resume a specific conversation."
  ]
}
```

### 6.7 `send`

用途：

Margent 把某条批注事件投递给目标 Agent。

输入示例：

```json
{
  "schemaVersion": 1,
  "provider": "my-agent",
  "documentPath": "/Users/example/Documents/Test.md",
  "annotationId": "ann_123",
  "eventId": "evt_456",
  "target": {
    "role": "successor",
    "sessionId": "session_123",
    "cwd": "/Users/example/project",
    "displayName": "My Agent"
  },
  "mcp": {
    "serverName": "margent",
    "requiredTools": [
      "reviewer_get_annotation_context",
      "reviewer_add_annotation_reply",
      "reviewer_apply_document_edit",
      "reviewer_update_annotation_status",
      "reviewer_mark_review_event_handled"
    ]
  },
  "prompt": "Margent generated bridge prompt..."
}
```

输出示例：

```json
{
  "ok": true,
  "provider": "my-agent",
  "sessionId": "session_123",
  "turnId": "turn_789",
  "deliveryId": "my-agent:turn_789",
  "status": "completed"
}
```

如果 adapter 只能确认任务已提交，但不能等待完成：

```json
{
  "ok": true,
  "provider": "my-agent",
  "sessionId": "session_123",
  "deliveryId": "my-agent:evt_456",
  "status": "submitted",
  "warnings": [
    "The adapter submitted the task but cannot track completion. Margent will rely on MCP handled status."
  ]
}
```

失败示例：

```json
{
  "ok": false,
  "provider": "my-agent",
  "status": "failed",
  "error": {
    "code": "not_authenticated",
    "message": "My Agent is not authenticated."
  }
}
```

### 6.8 `resume`

用途：

显式测试 adapter 是否能恢复指定 session。

输入示例：

```json
{
  "schemaVersion": 1,
  "sessionId": "session_123",
  "cwd": "/Users/example/project"
}
```

输出示例：

```json
{
  "ok": true,
  "provider": "my-agent",
  "sessionId": "session_123",
  "resumed": true
}
```

如果不支持：

```json
{
  "ok": false,
  "error": {
    "code": "unsupported",
    "message": "This adapter does not support session resume."
  }
}
```

### 6.9 Adapter 与 MCP 的边界

Adapter 只负责“把任务交给 Agent”。

Adapter 也是 provider-specific 的：

- Codex adapter 只处理 Codex app-server / thread resume。
- Claude Code adapter 只处理 Claude Code CLI / MCP config / session resume。
- External Adapter 只处理自身 manifest 声明的 provider。

Adapter 不负责扫描本地历史日志、选择当前文档应该绑定哪个 Agent，也不能在缺少 sessionId 时偷偷创建新会话。

Discovery 是 Margent-owned 的统一能力：

- 各 provider 可以提供候选来源，但不直接写当前连接。
- Margent 统一合并 Codex、Claude Code、WorkBuddy 和未来 provider 候选。
- 证据优先级是 `显式绑定 > 真实 Margent 操作 > 创建/编辑过文档 > 只提到路径 > 最近活跃时间`。
- 已有可投递 target 时不覆盖。
- 无可投递 target 时，只有高置信胜出候选才自动绑定；候选可以不止一个，但第一名必须在证据层级或分数上明显胜出。
- 多 provider 或多 session 候选没有清晰胜出者时不自动选择，交给用户手动连接。
- Discovery 写入时必须保持 source / target 分离：source 候选可以补 source 和 target；successor 候选只能补 target。

真正处理文档的动作必须走 MCP：

- 读取批注上下文：`reviewer_get_annotation_context`
- 回复批注：`reviewer_add_annotation_reply`
- 修改 Markdown：`reviewer_apply_document_edit`
- 标记批注状态：`reviewer_update_annotation_status`
- 标记事件已处理：`reviewer_mark_review_event_handled`

这样做的原因：

- Margent 可以统一处理文件读写、冲突和锚点。
- 第三方 Agent 不需要了解侧车文件格式。
- 未来 Store Edition 可以把权限集中收敛到 Margent 授权路径上。

### 6.10 安全约束

External Adapter 必须遵守：

- 不在 stdout 输出 API key、token 或私密凭据。
- 不把私钥写入 manifest。
- 不直接修改 `.review.json`、`.codex.json`、`.margent-agent.json`。
- 不静默读取用户未授权目录。
- 如果需要额外目录权限，应让用户在 Agent 或系统层显式授权。

Margent 侧应遵守：

- manifest 只保存非私密配置。
- 私密配置留在第三方 Agent 自己的 secret store、Keychain 或环境配置里。
- 失败信息展示给用户时不回显密钥。

### 6.11 Conformance Test

第三方 adapter 至少需要通过以下测试：

- `capabilities` 返回合法 JSON。
- `health` 能区分 ready / not-ready。
- `send` 能接收一条测试批注任务。
- Agent 能通过 MCP 读取 annotation context。
- Agent 能回复批注。
- Agent 能把 event 标记 handled。
- `send` 失败时返回结构化错误。
- adapter 不会直接修改 Margent 侧车文件。

如果声明支持 `sessionResume`，还需要通过：

- `resume` 能恢复指定 session。
- 连续两次 `send` 返回相同 sessionId。
- Agent 能看到上一轮上下文。

如果声明支持 `autoSend`，还需要通过：

- 新批注自动投递。
- 同一 event 不重复投递。
- App 重启后状态恢复合理。

### 6.12 Margent 实现建议

Margent 里可以新增一个通用 adapter：

```ts
createExternalCommandAdapter(manifest): AgentBridgeAdapter
```

它负责：

- 读取 manifest。
- 调用 `capabilities` 和 `health`。
- 把 `SendToAgentInput` 转成 External Adapter JSON。
- 调用 `send`。
- 把 stdout JSON 转成 `SendToAgentResult`。
- 把错误码映射成用户可读错误。

这样以后新增第三方 adapter 时，不需要每次改 `src/server/bridge.ts` 的核心逻辑。

第一版可以先不做自动扫描目录。更稳妥的方式是：

- 用户在设置页手动添加 manifest 路径。
- Margent 校验 manifest。
- 通过 health check 后允许启用。

## 7. Provider 接入记录模板

每接一个新 Agent，新增一段记录：

```md
## Provider: {name}

- Provider id:
- Display name:
- 接入类型: Built-in / Custom CLI / External Adapter
- 目标支持等级:
- 当前支持等级:
- 是否支持 MCP:
- 是否支持 CLI/headless:
- 是否支持 cwd:
- 是否支持 session resume:
- 是否支持 completion tracking:
- 鉴权方式:
- 主要风险:

### 需要改造

- [ ] AgentProvider 枚举
- [ ] provider display name
- [ ] MCP 配置说明
- [ ] bind 测试
- [ ] bridge adapter
- [ ] external adapter manifest
- [ ] adapter command protocol
- [ ] delivery status 映射
- [ ] UI 文案
- [ ] i18n
- [ ] debug monitor
- [ ] docs
- [ ] typecheck/build
- [ ] 端到端 smoke test

### 验收结果

- L0:
- L1:
- L2:
- L3:
- L4:
- L5:
```

## 8. 当前内置 Provider 状态

更新时间：2026-06-18。

| Provider | Provider id | 当前等级 | 当前状态 | 主要入口 |
| --- | --- | --- | --- | --- |
| Codex | `codex` | L4 | 已有完整体验，继续作为基线 provider | Codex app-server / MCP |
| Claude Code | `claude-code` | L4 | 已支持绑定、手动投递、自动投递、resume、统一 discovery | `claude -p --resume` / MCP |
| WorkBuddy | `workbuddy` | L4 | 已支持绑定、手动投递、自动投递、resume、统一 discovery | `codebuddy -p --session-id` / MCP |
| Custom CLI | `custom-cli` | 协议草案 | 只定义 External Adapter Protocol，暂未产品化 | 自定义 adapter manifest |

暂不放进当前轮：

- 设置页完整 provider 下拉选择。
- 第三方 adapter manifest 扫描目录。
- MAS Store Edition 权限设计。

## 9. Codex 当前支持等级

Codex 是 Margent 当前基线 provider。

当前状态：

- MCP：已支持。
- 绑定：已支持。
- 手动投递：已支持。
- 自动投递：已支持。
- session resume：通过 Codex app-server 支持。
- completion tracking：通过 Codex app-server turn completion 和 MCP handled 写回共同支持。
- Discovery：候选产出已迁移到 provider adapter，最终绑定决策归统一 discovery。

目标：

- 继续保持 L4。
- 后续如果做 provider 设置页，Codex 应进入 L5。

## 10. Claude Code 当前支持等级

Claude Code 使用 provider id `claude-code`，UI 显示名为 `Claude Code`。

当前状态：

- MCP：已支持，可加载 Margent MCP。
- 绑定：已支持 `reviewer_bind_current_agent_session`。
- CLI/headless：已支持 `claude -p`。
- cwd：投递时在文档目录或绑定 cwd 下运行。
- session resume：通过 `--resume <sessionId>` 接续指定会话。
- 手动投递：已支持点击 `@ Agent` 投递。
- 自动投递：已支持自动模式下新批注投递。
- Discovery：扫描 Claude Code 本地会话日志产出候选，由统一 discovery 决定是否绑定。
- completion tracking：以 MCP handled / review 文件完成证据为准，CLI 退出作为辅助信号。

实现边界：

- Claude Code 属于 sessionful provider。
- 缺少 sessionId 时不能偷偷创建新会话处理批注。
- Discovery 不能覆盖已有可投递 target。
- 多个候选没有清晰胜出时，要求用户手动绑定。

已验证：

- 在 `/Users/zoushangting/MCP_Skill_API_SDK_区别.md` 上，Claude Code 可以读取批注、回复、修改文档并完成状态流转。
- 已绑定 Claude Code 的文档不会被 WorkBuddy discovery 覆盖。

## 11. WorkBuddy 当前支持等级

WorkBuddy 使用 provider id `workbuddy`，UI 显示名为 `WorkBuddy`。底层调用 WorkBuddy 内置的 `codebuddy` CLI，但不把 `CodeBuddy` 暴露为用户可见 provider。

当前状态：

- MCP：`codebuddy` 支持 `--mcp-config`，可加载 Margent MCP。
- CLI/headless：`codebuddy -p` 支持非交互投递。
- cwd：投递时可以在指定 cwd 下运行。
- session resume：通过 `--session-id <sessionId>` 复用指定 session；实测 `--resume <sessionId>` 对 WorkBuddy App 产生的历史 session 会返回找不到会话。
- 本地日志：`~/.workbuddy/projects/**/*.jsonl` 可作为 discovery 候选来源。
- 手动投递：已支持点击 `@ Agent` 投递。
- 自动投递：已支持自动模式下新批注投递。
- Discovery：扫描 WorkBuddy 本地会话日志产出候选，由统一 discovery 决定是否绑定。
- completion tracking：以 MCP handled / review 文件完成证据为准，CLI 退出作为辅助信号。
- 非交互真实工具调用：`codebuddy -p` 需要 `-y` / `--dangerously-skip-permissions`，同时用 `--allowedTools` 和 settings permission allow list 收敛到 Margent MCP tools。

当前等级：

```text
WorkBuddy L4: MCP 协作、手动投递、自动投递、本地会话发现、resume 到指定 session
```

实现边界：

- WorkBuddy 属于 sessionful provider，没有 sessionId 时不能投递，也不能偷偷新建会话。
- WorkBuddy adapter 只负责把任务投递到指定 session。
- WorkBuddy discovery 只负责产出候选，不直接决定绑定。
- Margent 统一合并 Codex、Claude Code、WorkBuddy 候选并按同一套证据规则决定是否自动绑定。
- 第一版不做设置页 provider 下拉选择，继续使用当前连接、绑定和自动发现策略。

安全约束：

- 默认只允许 Margent MCP tools。
- 不开放 WorkBuddy 的 `Read` / `Write` / `Bash` 直接改文档。
- 文档修改必须通过 `reviewer_apply_document_edit`，让 Margent 继续统一处理保存、冲突、批注锚点和 event 状态。
- Prompt 必须禁止 `<tool_call>` 文本模拟；只有真实 MCP tool invocation 才算完成。
- CLI 不存在、sessionId 缺失、resume 失败或 MCP 不可用时，event 进入 failed，并给出可读错误。

命令检测顺序：

```text
WORKBUDDY_CLI_PATH / CODEBUDDY_CLI_PATH
→ /Applications/WorkBuddy.app/.../cli/bin/codebuddy
→ PATH codebuddy / cbc
```

Discovery 规则：

- 扫描 `~/.workbuddy/projects/**/*.jsonl` 的最近 session 文件。
- 从日志读取 `sessionId`、`cwd`、最新 timestamp / mtime。
- 识别 WorkBuddy 顶层 `function_call` 结构。
- 将 `Write` / `Edit` / `MultiEdit` 这类带文档路径的调用识别为真实文档编辑证据。
- 多个 WorkBuddy session 命中但没有明显胜出时，不自动绑定。
- 已绑定 Codex / Claude Code / WorkBuddy 的文档不被其他 discovery 候选覆盖。

已验证：

- WorkBuddy 生成过的文档删除 `.margent-agent.json` 后，可以被自动发现并绑定到 WorkBuddy。
- 点击 `@ Agent` 后，WorkBuddy 可以读取批注并回复。
- 自动模式下新批注可以投递到同一个 WorkBuddy session。
- 已绑定 Codex / Claude Code 的文档不会被 WorkBuddy discovery 覆盖。
- WorkBuddy CLI 不可用时，event 会进入 failed，并返回 WorkBuddy 相关的可读错误。

## 12. 本轮验收记录

验收日期：2026-06-18。

静态检查：

- `npm run typecheck`
- `npm run build`
- `npm run check:anchor-repair`
- `git diff --check`

功能验证：

- Claude Code 手动投递、自动投递、文档修改、状态流转已通过用户实测。
- WorkBuddy 手动投递、自动投递、自动发现已通过用户实测。
- WorkBuddy 连续批注使用同一个 session，未偷偷创建新会话。
- Codex / Claude Code 已有绑定文档不会被 WorkBuddy discovery 覆盖。
- WorkBuddy CLI 被禁用时，投递进入 failed，并提示 WorkBuddy CLI 不可用。
- event 已经有 Agent 回复或批注已解决时，Margent 可以把历史 failed / pending 状态修复为 handled。

## 13. 判断原则

接入新 Agent 时，优先保证纵向闭环，而不是一次性补齐所有周边能力。

推荐顺序：

```text
MCP 可用
→ 会话可绑定
→ 手动投递闭环
→ 自动投递
→ 会话发现和产品化
```

如果某个 Agent 不支持 resume，不要强行模拟 Codex 的体验。应该把它标成较低支持等级，并在 UI 和文档里明确说明。

如果某个 Agent 只能通过 MCP 手动协作，也仍然是有价值的接入方式，因为 Margent 的核心协议仍然成立：文档、批注、回复、编辑和状态都由 MCP 统一承载。
