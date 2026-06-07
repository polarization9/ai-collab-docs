# Margent 产品外壳与 Codex 连接 PRD

## 1. 文档信息

- 产品名称：Margent
- 模块名称：产品外壳与 Codex 连接
- 文档日期：2026-06-03
- 目标版本：v0.4.0 起逐步落地
- 当前状态：需求草案

## 2. 背景

Margent 当前已经具备本地 Markdown 阅读、Mermaid 增强、批注、MCP 协作和轻量编辑能力。下一步需要回答两个更基础的问题：

1. 用户如何自然地把一份 `.md` 文档交给这个产品打开，而不是记命令、找端口、复制路径。
2. 当文档来自 Codex 讨论时，产品如何把批注和修改任务送回正确的 Codex 上下文里。

这个模块不只是“把 Web App 包成桌面 App”。它的核心目标是让 Margent 从一个 localhost 工具升级为一个本地文档协作入口，并和 Codex 建立可恢复、可路由、可自动投递的连接。

## 3. 产品定位

Margent 的产品外壳优先采用本地桌面 App 形态。桌面 App 负责文件打开、系统集成、后台服务和本地权限；现有 Web UI 继续作为主要阅读和编辑界面。

推荐路线：

- 短期采用 Tauri 外壳承载现有 React UI。
- 继续保留 CLI / localhost 模式，便于开发、调试和 MCP 使用。
- 不优先重写为 Swift 原生 App，除非后续明确追求深度 macOS 原生体验。

Tauri 不是 Codex 连接能力的必要条件，但它适合作为产品外壳：

- 可以复用当前前端。
- 可以注册 `.md` / `.markdown` 默认打开方式。
- 可以访问本地文件并启动本地 sidecar 服务。
- 可以承载 MCP Server 和 Codex Bridge 的本地进程管理。
- 包体和性能成本低于 Electron。

## 4. 阶段目标

目标体验：

> 用户双击一份 Markdown 文档，或在 Codex 产出文档后选择“用 Margent 打开”。App 打开文档并识别它是否来自某个 Codex 会话。用户在文档中留下批注后，系统可以把新批注事件交给正确的 Codex 会话处理。Codex 在该会话已有上下文中读取批注、修改正文、回复批注并更新状态。

这个模块要解决的是“批注触发正确会话里的 Agent”，而不只是“批注触发某个 Agent”。

## 5. 核心原则

- 文档本地优先：Markdown、批注、来源连接信息和事件状态都保存在本机。
- 来源优先：只要能定位到来源 Codex 会话，就优先回来源会话处理修改任务。
- 桥梁边界：产品只负责连接 Markdown 批注与 Codex 会话，不压缩、不摘要、不维护 Codex 会话上下文。
- 自动不伪造上下文：可以用自动监控发现新批注，但不在来源会话不可用时伪装成仍有原始讨论上下文。
- 连接可接续：来源会话不可用时，用户可以手动配置新的 Codex 对话作为后续协作对象。
- 不绑定单一 Codex 内部接口：优先封装为 Bridge Adapter，底层可切换 SDK、App Server、CLI resume 或未来稳定 thread API。
- 不做复杂兜底：只保留对用户体验必要的降级路径，避免过早平台化。

## 6. 核心概念

### 6.1 产品外壳

产品外壳是桌面 App 层，负责：

- 注册文件类型。
- 接收系统打开文件事件。
- 启动或复用本地 Reviewer 服务。
- 管理本地权限、菜单栏、窗口和通知。
- 管理 MCP Server / Codex Bridge sidecar。

第一版产品外壳不承载复杂业务逻辑，业务仍尽量放在现有 Web / Server / MCP 层。

### 6.2 来源会话

来源会话是生成或主要修改该 Markdown 文档的 Codex thread。

文档来源信息至少包括：

- `sourceThreadId`
- `sourceTurnId`
- `sourceCwd`
- `documentPath`
- `createdAt`
- `updatedAt`

来源会话是处理高上下文修改任务的优先入口。

### 6.3 文档连接文件

文档连接文件记录 Markdown 文档和 Codex 会话之间的关系。

建议命名：

```text
<markdown basename>.codex.json
```

示例：

```json
{
  "version": 1,
  "documentPath": "/Users/me/docs/phase-2-prd.md",
  "source": {
    "type": "codex",
    "threadId": "019e825c-6f93-7f51-9b9b-beebb1317147",
    "turnId": "019e825d-xxxx",
    "cwd": "/Users/me/Documents/AI协作文档",
    "createdAt": "2026-06-03T10:00:00.000Z"
  },
  "target": {
    "type": "source",
    "threadId": "019e825c-6f93-7f51-9b9b-beebb1317147",
    "cwd": "/Users/me/Documents/AI协作文档"
  },
  "bridge": {
    "autoSendNewAnnotations": false
  }
}
```

### 6.4 Codex Bridge

Codex Bridge 是本地桥接层，负责把 Reviewer 的事件转换成 Codex 可处理的任务。

Bridge 不直接理解产品业务，只处理：

- 读取文档连接信息。
- 选择目标 Codex thread。
- 组装任务 prompt。
- 调用 Codex SDK / App Server / CLI resume / 未来 thread API。
- 记录投递结果。

### 6.5 批注事件

批注事件是 App 写入的本地事件，用于通知 Codex 有新工作。

事件类型包括：

- 新增批注。
- 批注回复。
- 批注重新打开。
- 批注状态变更。
- 文档保存后锚点修复。

第一版只需要支持新增批注事件。

### 6.6 接续对话

接续对话是在来源会话不可用时，由用户指定的新 Codex thread。

接续对话用于承接后续批注协作，但不等同于来源会话，也不自动继承来源会话上下文。

用户不需要手动查找或输入会话 ID。产品提供“复制接续指令”，用户把这段指令粘贴到目标 Codex 会话中；目标 Codex 会话通过 MCP 把自己绑定为当前文档的接续对话。

产品只保存接续对话绑定后的连接信息：

- `threadId`
- `cwd`
- `configuredAt`
- `configuredBy`
- `configuredVia`
- 是否将后续新增批注发送给该对话

产品不为接续对话生成上下文摘要，不把旧会话内容压缩后注入新会话。新对话需要的背景由用户和 Codex 在该对话中自行建立。

## 7. 功能范围

### 7.1 P0：桌面外壳与文件打开

#### 7.1.1 Tauri 桌面 App

- 使用 Tauri 包装现有 React UI。
- App 启动后默认展示最近文档或打开文档入口。
- 保留现有 localhost 开发模式。
- 桌面 App 内部复用现有 Markdown 渲染、批注和编辑能力。

#### 7.1.2 文件类型关联

- 支持注册 `.md` 和 `.markdown` 文件类型。
- 用户可以在系统中选择 Margent 打开 Markdown 文件。
- 支持双击文件、右键打开方式、拖入窗口打开。
- 后续可引导用户将 Margent 设置为默认 Markdown 打开方式。

#### 7.1.3 打开文件体验

- App 内提供打开文件入口。
- 支持最近打开文档列表。
- 打开新文档时自动加载同目录 `.review.json` 和 `.codex.json`。
- 如果文件没有批注文件，自动初始化空 review 状态。
- 如果文件没有来源连接信息，不强制创建。

#### 7.1.4 本地服务管理

- 桌面 App 启动时自动启动 Reviewer server。
- 如果本地服务已经运行，优先复用。
- 用户不需要记住端口或手动执行 CLI。
- 开发模式继续允许使用指定端口打开多个文档。

### 7.2 P0：来源会话绑定

#### 7.2.1 Codex 产出文档时写入来源信息

当 Codex 生成或显著修改 Markdown 文档时，可以写入 `.codex.json`：

- 读取当前 `CODEX_THREAD_ID`。
- 记录当前工作目录。
- 记录文档路径。
- 记录来源 turn 信息。
- 写入默认投递目标和自动监控设置。

这一步可以由 Codex 手动执行，也可以后续通过 MCP / skill / plugin 自动化。

#### 7.2.2 App 识别来源会话

App 打开文档时：

- 检查同目录 `.codex.json`。
- 展示“已关联 Codex 来源会话”的轻量提示。
- 在批注面板或文档信息区展示连接状态。
- 如果来源信息缺失，展示“未关联来源会话”，但不阻塞阅读和批注。

#### 7.2.3 手动关联来源会话

用户可以手动把当前文档关联到某个 Codex thread：

- 从 App 复制来源绑定指令，粘贴到目标 Codex 会话。
- 让当前 Codex 会话通过 MCP 写入来源信息。
- 从最近 Codex threads 中选择。

第一版优先支持“复制接续指令”，不要求用户输入 thread id，也不要求完整 thread 选择器。

#### 7.2.4 来源不可用时配置接续对话

当来源会话不可用时，用户可以把当前文档配置到一个新的 Codex 对话。

用户操作：

1. 在 App 中点击“复制接续指令”。
2. App 生成一段可复制指令。
3. 用户把指令粘贴到目标 Codex 会话。
4. 目标 Codex 会话按指令调用 Margent MCP。
5. MCP 写入接续对话连接信息。
6. App 刷新后展示“已配置接续对话”。

指令中包括：

- 当前 Markdown 文件路径。
- 文档连接文件路径。
- 绑定角色：`successor`。
- 是否将后续新增批注发送给该新对话。
- 给目标 Codex 的启动说明：调用 MCP 绑定当前会话，并读取本文档的未解决批注。

配置完成后，`.codex.json` 的当前投递目标从 `source` 切换为 `successor`。UI 必须明确展示这是“接续对话”，不是原来源会话。

### 7.3 P1：批注事件与自动监控

#### 7.3.1 事件记录

当用户新增批注时，系统写入批注事件。

事件字段包括：

```ts
type ReviewEvent = {
  id: string;
  type: "annotation_created" | "reply_followup";
  documentPath: string;
  annotationId: string;
  triggerReplyId?: string;
  replyToReplyId?: string;
  sourceThreadId?: string;
  targetThreadId?: string;
  targetType?: "source" | "successor";
  deliveryMode: "manual" | "auto";
  createdAt: string;
  deliveryStatus:
    | "ignored"
    | "queued"
    | "delivering"
    | "sent"
    | "processing"
    | "handled"
    | "failed";
  attemptCount: number;
  lastError?: string;
  updatedAt: string;
};
```

事件可保存在 `.review.json` 中，也可以单独保存在本地事件队列文件中。第一版优先复用 `.review.json`，避免引入额外状态文件。

`deliveryStatus`、`attemptCount` 和 `lastError` 是 Bridge / MCP 内部字段，不作为普通用户的批注筛选或详情面板展示。用户界面只展示批注业务状态和必要的轻量操作；Codex 可以通过 MCP 读取这些字段分析异常。

#### 7.3.2 Codex 自动监控批注开关

文档级提供“Codex 自动监控批注”开关。

这个开关控制的是：用户新增批注后，产品是否自动把这条批注任务投递给当前目标 Codex 会话。

开启自动监控不等于产品自己理解上下文，也不等于产品自动修改正文。Margent 只负责把批注事件送到正确会话；Codex 仍通过 MCP 读取文档和批注，并在目标会话上下文中决定回复、修改正文或更新状态。

用户回复 Agent / Codex 回复时，不受“新增批注自动监控”开关限制。这个动作已经表达了继续和 Codex 对话的意图，产品会自动创建 `reply_followup` 事件。普通用户回复、Agent 追加回复、用户回复用户回复不自动投递。

**关闭时：Reviewer 侧体验**

- 默认状态为关闭。
- 文档右上角或批注面板展示当前连接状态，例如“已关联来源会话 / 未开启自动监控”。
- 用户创建批注后，批注只保存在本地 `.review.json`。
- 批注卡片只展示批注业务状态：`open` 或 `resolved`。
- 产品不自动唤起 Codex，不创建排队事件，不修改正文。
- 批注卡片操作行仍保留 `回复`、`编辑`、`@codex`。
- 用户点击 `@codex` 时，产品将这条批注手动投递给当前目标会话。
- 用户可以先集中批注，之后逐条或批量交给 Codex 处理。

**关闭时：Codex 侧体验**

- Codex 会话不会收到任何自动消息。
- Codex 不会因为用户在 Reviewer 中批注而启动新 turn。
- 如果用户手动点击发送，Codex 才会收到一条明确的批注处理任务。

**开启时：Reviewer 侧体验**

- 开启前，产品需要存在可用目标会话：来源会话或已绑定接续对话。
- 如果没有可用目标，开关不能直接开启，并引导用户先绑定来源会话或复制接续对话绑定指令。
- 开启后，文档右上角或批注面板展示“Codex 自动监控已开启”，并展示当前目标：来源会话或接续对话。
- 用户像普通审阅一样继续阅读、选择文本、创建批注，不需要离开 Reviewer 页面。
- 新批注保存后，产品在后台创建投递事件。
- 批注列表仍按业务状态筛选：`全部`、`已解决`、`未解决`。
- 批注卡片不展示 `queued`、`delivering`、`sent`、`processing`、`handled` 这类投递状态。
- 批注面板顶部只展示轻量连接摘要，例如“自动监控中 / 2 条待处理”，不展示投递明细。
- 如果 Codex 修改了正文，Reviewer 刷新文档内容并保留批注锚点修复结果。
- 如果 Codex 只是回复问题，批注卡片展示新回复，正文不变化。
- 自动监控只作用于开启后新增的批注；已有批注仍由用户手动发送，避免开关开启瞬间触发大量历史任务。

**开启时：Codex 侧体验**

- 目标 Codex 会话会按批注事件或批注追问事件收到任务消息。
- 每条新批注或二级追问对应一个 Codex 处理任务，不把多个任务默认合并成一个大任务。
- 如果目标是来源会话，Codex 可以使用该会话已有上下文处理批注。
- 如果目标是接续对话，任务会明确提示“这是接续对话，不是原来源会话”；Codex 不应假设拥有历史讨论。
- Codex 收到任务后，第一步应调用 Margent MCP 读取批注上下文，而不是依赖 prompt 中的摘要。
- 如果事件包含 `triggerReplyId`，Codex 必须把 `context.triggerReply` 作为本轮任务焦点；父级批注、选中文本、文档上下文和历史回复只作为背景。
- Codex 处理完成后，通过 MCP 回复批注、修改 Markdown 正文、更新批注状态，并把事件标记为 `handled`。
- 如果处理异常，Codex 可以通过 MCP 读取事件、投递记录和内部错误信息进行分析；这些细节不作为普通用户界面的一部分展示。

**串行投递规则**

- 自动监控按文档维度串行投递，同一文档同一目标会话同一时间只允许一个 active 事件。
- 事件按 `createdAt` 从早到晚进入队列。
- 当前事件进入 `handled` 或 `failed` 后，队列才投递下一条事件。
- 如果当前事件处于 `delivering` / `sent` / `processing`，后续事件保持 `queued`。
- 如果用户在事件投递前编辑批注或追加回复，投递时读取最新批注上下文。
- 如果用户在事件投递前删除批注，该事件标记为 `ignored`。
- 如果用户在事件投递前手动标记批注为 `resolved`，事件不自动投递，除非用户再次手动发送。
- 串行投递用于避免多个 Codex turn 同时修改同一份 Markdown，导致正文冲突或批注锚点反复修复。

**可能异常与产品应对**

- 没有关联目标会话：不开启自动监控，提示用户绑定来源会话或复制接续对话绑定指令。
- 来源会话不可用：批注保持 `open`，连接状态展示“来源会话不可用”，并提供“复制接续指令”按钮。
- 点击“复制接续指令”后，产品复制接续指令，并提示“指令复制成功，粘贴到目标会话发送给 Codex 即可重连”。
- Bridge 投递失败：批注保持 `open`，状态旁展示一个轻量重试图标；详细失败原因保存在本地事件中，供 Codex 通过 MCP 分析。
- 目标会话未安装或未连接 MCP：产品不伪装为已处理；用户可以点击 `@codex` 或重试图标，让 Codex 在目标会话中读取原因。
- Codex 已收到任务但未完成回写：队列内部暂停下一条投递；用户界面不展示详细调用链。
- Codex 修改正文失败：批注保持 `open`，用户可以让 Codex 通过 MCP 检查失败原因。
- 用户关闭自动监控：后续新增批注不再自动投递；已经发送或正在处理的事件不撤销，尚未投递的 queued 事件保留内部状态。

#### 7.3.3 投递 Prompt 模板

无论是手动发送还是自动监控投递，Bridge 都只发送最小任务信息，不把完整 Markdown 正文塞进 prompt。

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
{{targetType}} // source 或 successor

请按以下步骤处理：

1. 调用 Margent MCP 读取这条批注：
   get_annotation_context({ documentPath: "{{documentPath}}", annotationId: "{{annotationId}}" })

2. 根据批注内容判断处理方式：
   - 如果是提问型批注：直接回复批注。
   - 如果是明确修改型批注：修改 Markdown 正文，并回复处理说明。
   - 如果修改目标或意图不明确：只回复讨论或澄清问题，不擅自改正文。

3. 如果修改了正文，请调用文档修改工具保存，并让 Reviewer 修复批注锚点。

4. 如果这条批注已经处理完成，可以按需要标记为 resolved。

5. 完成后，调用事件工具把 {{eventId}} 标记为 handled。

注意：
- 不要要求用户把整份 Markdown 粘贴到对话里。
- 需要正文或更多上下文时，通过 MCP 读取本地文档。
- 如果 MCP 不可用，请回复说明无法处理，并不要假装已经完成。
```

二级追问模板在基础模板上增加触发回复：

```text
Margent 有一条新的批注追问需要处理。

触发回复 ID：
{{triggerReplyId}}

1. 调用 Margent MCP 读取这条批注：
   reviewer_get_annotation_context({
     documentPath: "{{documentPath}}",
     annotationId: "{{annotationId}}",
     triggerReplyId: "{{triggerReplyId}}"
   })

2. 这是用户对 Codex 回复发起的继续回复：
   - context.triggerReply 是本轮任务的主要用户意图。
   - 父级批注、原始选中文本、文档局部上下文和全部历史回复用于理解背景。
   - 不要把父级批注当成一条新的待处理问题重复处理，除非 triggerReply 明确要求重新处理。
```

来源会话补充说明：

```text
你正在来源 Codex 会话中处理这条批注。可以使用本会话已有讨论上下文判断产品意图和修改边界。
```

接续对话补充说明：

```text
你正在接续对话中处理这条批注，不是原来源会话。不要假设自己拥有完整历史讨论。
如果批注需要来源讨论上下文才能安全修改，请回复说明需要用户补充背景，或只做低风险修改。
```

Bridge 生成 prompt 后，将事件状态从 `queued` 更新为 `delivering`。目标 Codex 会话确认收到任务后，事件进入 `sent`；Codex 开始调用 MCP 后，事件进入 `processing`；Codex 调用事件工具完成回写后，事件进入 `handled`。

#### 7.3.4 监控线程路由

如果不能直接投递到来源会话，允许使用监控线程发现 queued 事件，但监控线程不直接接管正文修改。

- 监控线程只负责发现新批注和路由任务。
- 当前目标是来源会话时，优先交回来源会话。
- 来源会话不可用且未配置接续对话时，事件进入 failed 状态，并提示用户复制接续指令。
- 用户已配置接续对话后，后续事件可以发送给接续对话。

### 7.4 P1：Codex Bridge Adapter

Codex Bridge 按能力分层实现，避免产品绑定单一接口。

优先级：

1. Codex SDK：用于服务端/sidecar 稳定集成。
2. Codex App Server：用于深度本地集成、读取 thread、resume thread、start turn。
3. `codex exec resume`：用于早期验证和低集成度 fallback。
4. 未来稳定 thread message API：如果 Codex 官方开放，则作为长期最佳路径。

Bridge 对上层暴露统一接口：

```ts
type CodexBridge = {
  sendToThread(input: {
    threadId: string;
    prompt: string;
    cwd?: string;
    documentPath: string;
    annotationId?: string;
  }): Promise<{
    ok: boolean;
    deliveryId?: string;
    error?: string;
  }>;
};
```

### 7.5 P1：会话路由策略

#### 7.5.1 处理优先级

批注处理优先级：

1. 来源会话处理。
2. 监控线程发现 queued 事件，再路由给来源会话。
3. 用户通过绑定指令配置的接续对话处理。
4. 用户通过 `@codex` 手动发送给当前目标会话。

产品不自动创建“带上下文包的新线程”。如果要换新对话，必须由用户显式配置。

#### 7.5.2 来源会话不可用

来源会话不可用时，系统展示原因和操作入口：

- 复制接续指令。
- 暂不处理。

“复制接续指令”是主入口。点击后不是让用户填写 thread id，而是生成一段绑定指令。用户把指令粘贴到目标 Codex 会话后，由目标 Codex 调用 MCP 完成绑定。

绑定完成后，该新对话成为当前文档的接续对话，后续手动发送或自动监控投递都发送到接续对话。

#### 7.5.3 投递任务内容

Bridge 投递任务时只发送必要路由信息：

- Markdown 文件路径。
- 批注 ID。
- MCP 工具使用说明。
- 当前目标会话类型：来源会话或接续对话。

Bridge 不默认发送完整 Markdown 正文，不发送聊天摘要，也不维护上下文包。Codex 需要正文和批注时，通过 MCP 读取最新本地状态。

### 7.6 P2：更深系统集成

P2 视 Codex 能力成熟度再做：

- 真正 push 到已打开 Codex Desktop 会话。
- App 内展示来源会话状态、接续状态和最终处理结果。
- 从 App 直接打开来源 Codex 会话。
- 从 App 创建新 Codex 对话并自动完成接续绑定。
- 多文档关联同一个来源项目。
- 后台常驻菜单栏服务。
- 系统通知：批注已处理、正文已修改、需要用户确认。
- Codex plugin / skill 一键安装 Reviewer MCP 和文档连接规则。

## 8. 不支持范围

本模块暂不做：

- 云同步。
- 多人实时协作。
- 账号体系。
- 全文聊天记录复制到文档旁边。
- 自动生成或维护 Codex 会话上下文摘要。
- 来源会话不可用时自动构造上下文包处理复杂修改。
- 强制所有 Markdown 都必须关联 Codex 会话。
- 把 App 做成通用 Markdown 知识库。
- 对 Codex 内部未稳定 API 的强依赖。
- 自动接管所有批注，不区分上下文风险。
- 复杂权限策略和团队管理。

## 9. 核心流程

### 9.1 Codex 产出文档并打开

1. 用户在 Codex 中讨论并要求生成 Markdown 文档。
2. Codex 写入 `.md`。
3. Codex 同步写入 `.codex.json`，记录来源 thread 和默认投递目标。
4. 用户选择用 Margent 打开。
5. App 打开文档并加载 `.review.json` 和 `.codex.json`。
6. 页面展示文档内容、批注入口和来源连接状态。

### 9.2 用户双击本地 Markdown

1. 用户双击 `.md` 文件。
2. 系统用 Margent 打开。
3. App 启动本地服务并加载文档。
4. 如果存在 `.codex.json`，显示来源连接。
5. 如果不存在 `.codex.json`，作为普通本地 Markdown 打开。

### 9.3 用户批注后手动发送

1. 用户选中文档内容并创建批注。
2. 批注保存到 `.review.json`。
3. 批注卡片操作行展示 `回复`、`编辑`、`@codex`。
4. 用户点击 `@codex`。
5. Codex Bridge 读取当前目标会话。
6. Bridge 将任务发送给来源会话或已配置的接续对话。
7. Codex 通过 MCP 读取批注上下文并处理。
8. Codex 回复批注、修改正文，并按需要标记 `resolved`。

### 9.4 用户开启自动监控后创建批注

1. 用户为当前文档开启 Codex 自动监控批注。
2. App 校验当前目标会话是否可用。
3. 用户创建批注。
4. 批注保存到 `.review.json`，批注卡片保持 `open`。
5. 批注列表仍通过 `全部 / 已解决 / 未解决` 筛选。
6. Codex Bridge 检测到 queued 事件。
7. 如果当前没有 active 事件，Bridge 取出队首事件并生成投递 prompt。
8. 事件状态进入 `delivering`。
9. 如果存在可用来源会话，Bridge 发送到来源会话。
10. 如果来源会话不可用且已配置接续对话，Bridge 发送到接续对话。
11. 如果没有可用目标，事件标记为 `failed`，并提示用户复制接续指令或暂不处理。
12. 目标 Codex 会话收到任务后，事件进入 `sent`。
13. Codex 开始调用 MCP 读取批注上下文后，事件进入 `processing`。
14. Codex 回复批注、修改正文或更新状态后，调用事件工具标记 `handled`。
15. Reviewer 刷新批注卡片、回复和 Markdown 正文。
16. Bridge 继续投递下一条 queued 事件。

### 9.5 来源会话不可用

1. App 检测到 `sourceThreadId` 不可读或发送失败。
2. 系统展示“来源会话不可用”。
3. 用户可以选择：
   - 复制接续指令。
   - 只保留批注，不触发 Agent。
4. 用户点击“复制接续指令”。
5. App 生成并复制接续指令，同时展示 toast：`指令复制成功，粘贴到目标会话发送给 Codex 即可重连`。
6. 用户把指令粘贴到目标 Codex 会话。
7. 目标 Codex 会话调用 MCP，把自己绑定为接续对话。
8. App 刷新连接状态。
9. 后续批注可以手动发送，也可以由自动监控投递给接续对话。
10. UI 必须持续标明当前使用的是接续对话，而不是原来源会话。

## 10. 数据关系

```text
document.md
├── document.review.json
│   ├── annotations
│   ├── replies
│   ├── status
│   └── events
└── document.codex.json
    ├── source.threadId
    ├── source.turnId
    ├── source.cwd
    ├── target.type
    ├── target.threadId
    ├── target.cwd
    └── bridge.autoSendNewAnnotations
```

## 11. UI 要求

### 11.1 文档连接状态

在右上角功能区或批注面板顶部展示轻量状态：

- 已关联来源会话。
- 已配置接续对话。
- 未关联来源会话。
- 来源会话不可用。
- Codex 自动监控已开启。

状态信息不应占据正文阅读空间。

### 11.2 批注卡片操作

批注卡片支持：

- 回复。
- 编辑。
- `@codex`：手动把这条批注发送给当前目标 Codex 会话。
- 删除。
- `resolved` / `reopen` 状态操作。

`@codex` 与回复、编辑放在同一操作行，不做突出主按钮。自动监控开启后，新批注会自动进入后台投递；`@codex` 仍可作为手动补发入口。

投递异常时：

- 不展示“投递详情”入口。
- 不展示 prompt、event id、MCP 调用链或详细错误原因。
- 只在状态旁提供一个轻量重试图标。
- 详细失败原因保存在本地事件中，供 Codex 通过 MCP 读取和分析。

### 11.3 批注列表筛选

批注列表顶部只展示业务状态筛选：

- 全部。
- 已解决。
- 未解决。

这里不展示 `queued`、`sent`、`processing`、`handled` 等投递状态分类，避免把批注列表变成任务调度面板。

### 11.4 接续对话入口

来源会话不可用时，连接状态卡片中提供“复制接续指令”按钮。

点击后：

- 复制一段让目标 Codex 会话调用 MCP 绑定自己的指令。
- 展示 toast：`指令复制成功，粘贴到目标会话发送给 Codex 即可重连`。
- 不要求用户输入或查找 thread id。
- 不在用户界面展示上下文摘要或投递详情。

### 11.5 设置入口

文档级设置包括：

- 是否开启 Codex 自动监控批注。
- 当前来源 thread id。
- 当前目标会话：来源会话或接续对话。
- 复制接续对话绑定指令。
- Codex Bridge 状态。

第一版设置入口可以放在右上角功能区，不做独立设置页。

## 12. MCP 与 Codex 连接要求

已有 MCP 能力继续作为 Agent 处理文档的主要工具层：

- 读取文档。
- 读取批注列表。
- 读取单条批注上下文。
- 回复批注。
- 更新批注状态。
- 修改 Markdown 正文。

新增或扩展 MCP 能力：

- 读取文档连接信息。
- 写入或更新来源会话信息。
- 写入或更新接续对话信息。
- 将当前 Codex 会话绑定为指定文档的来源会话或接续对话。
- 读取 queued 批注事件。
- 标记批注事件已发送或已处理。

Codex Bridge 只负责唤起或路由 Codex，不替代 MCP 的文档操作能力。

## 13. 成功标准

P0 成功标准：

- 用户可以双击或从 App 内打开 Markdown 文件。
- 用户不需要手动输入端口或执行 CLI。
- App 能读取 `.review.json` 和 `.codex.json`。
- Codex 产出的文档可以记录来源 thread id。
- App 能明确展示文档是否有关联来源会话。

P1 成功标准：

- 用户新增批注后，可以通过 `@codex` 手动发送给当前目标 Codex 会话。
- 自动监控开启后，新批注可以进入内部投递状态流：queued / delivering / sent / processing / handled / failed。
- 用户界面仍以 `全部 / 已解决 / 未解决` 管理批注，不暴露投递状态分类。
- Codex 可以通过 MCP 读取新批注并处理。
- 明确修改型批注可以完成正文修改、批注回复和状态更新。
- 来源会话不可用时，产品不会误导用户以为仍在原上下文中处理。
- 来源会话不可用时，用户可以通过复制接续指令配置接续对话，不需要手动查找 thread id。

P2 成功标准：

- 新批注可以近实时进入来源 Codex 会话。
- 用户能在 App 中看到轻量连接状态和最终处理结果。
- 系统能稳定处理多个文档和多个来源会话。

## 14. 风险与判断

### 14.1 Codex 外部投递能力稳定性

当前技术上可以通过 Codex SDK / App Server / CLI resume 实现投递到 thread，但不应把某个实验性接口写死为唯一通道。

产品判断：

- P0/P1 使用 Bridge Adapter 封装。
- 对用户只暴露 `@codex`、自动监控开关和复制接续指令。
- 底层实现可替换。

### 14.2 来源会话不可用

如果来源会话不可用，新对话天然缺少原始讨论细节。

产品判断：

- 默认回来源会话处理。
- 不自动生成上下文摘要或上下文包。
- 用户可以通过绑定指令配置接续对话。
- UI 持续标明接续对话不是原来源会话。

### 14.3 自动监控的不可预期性

用户可能把自动监控误解为“批注一创建就自动修改正文”，从而产生超出预期的体验。

产品判断：

- 自动监控默认关闭。
- 自动监控针对“投递任务”，不等于强制自动改正文。
- Codex 仍通过 MCP 工具说明判断是否回复、修改或标记 resolved。

## 15. 待定问题

- `.codex.json` 是否独立文件，还是合并到 `.review.json` 的 `documentConnection` 字段中。
- Codex Bridge 第一版采用 SDK、App Server 还是 CLI resume。
- 是否需要为每个文档显示来源会话标题。
- 是否要提供“从 App 打开来源 Codex 会话”的 deep link。
- 自动监控的默认粒度是全局、项目级还是文档级。
- Codex 是否能稳定向 MCP 暴露“当前会话标识”和 `cwd`，用于自动写入接续对话绑定。
- 是否需要支持从最近 Codex threads 中选择，作为复制接续指令之外的增强入口。
