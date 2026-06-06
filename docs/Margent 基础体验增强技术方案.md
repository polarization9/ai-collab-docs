# Margent 基础体验增强技术方案

## 1. 技术目标

本技术方案对应 `Margent 基础体验增强 PRD.md`，目标是在现有阅读、批注、编辑、MCP / Codex 协作闭环之上，补齐 Margent 作为本机 Markdown App 的基础体验。

P0 技术目标：

- 将批注锚点恢复从 `blockId-first` 改为 `text-first + context scoring + block mapping`。
- 支持外部文件变化自动刷新，并避免打断用户当前选择、批注、回复或编辑。
- 支持多文档打开、切换和关闭，每份文档拥有独立阅读、编辑、批注、刷新和 Codex 状态。
- 支持空态启动页、最近文件、macOS 菜单栏入口和统一设置面板。
- 支持中文 / 英文与默认、蓝白、灰白三套配色 token。
- 保持本地优先，不引入云端账户、多人协作、复杂三方合并或语义向量匹配。

## 2. 当前架构基础

当前工程已经具备以下基础能力：

```text
src/
├── server/
│   ├── document.ts
│   ├── documentEdit.ts
│   ├── review.ts
│   ├── reviewAnchorRepair.ts
│   ├── bridge.ts
│   └── index.ts
├── mcp/
│   ├── server.ts
│   └── tools.ts
├── shared/
│   ├── types.ts
│   ├── editTypes.ts
│   └── reviewTypes.ts
└── web/
    ├── App.tsx
    ├── desktop.ts
    ├── hooks/
    └── components/
        ├── DocumentViewer.tsx
        └── annotations/
```

现有实现特点：

- `DocumentViewer` 渲染 Markdown，并按渲染顺序生成 `data-review-block-id="block-N"`。
- `anchorCapture.ts` 在用户创建批注时保存 `blockId`、`selectedText`、`prefix`、`suffix` 和 offset。
- `anchorResolve.ts` 在前端恢复批注高亮，目前仍较依赖 `blockId`。
- `reviewAnchorRepair.ts` 在保存文档后修复批注锚点，但当前策略偏 `selectedText indexOf + heading fallback`。
- `documentEdit.ts` 是通过 Margent 保存正文和 MCP 写回正文的统一入口。
- `bridge.ts` 负责 Codex 自动投递队列。

本阶段优先复用这些模块，不重写阅读器和编辑器。

## 3. 模块拆分

建议新增和调整模块：

```text
src/
├── server/
│   ├── markdownBlocks.ts
│   ├── reviewAnchorCandidates.ts
│   ├── reviewAnchorRepair.ts
│   ├── documentWatcher.ts
│   ├── appSettings.ts
│   └── recentDocuments.ts
├── shared/
│   ├── reviewTypes.ts
│   ├── anchorTypes.ts
│   ├── appSettingsTypes.ts
│   └── workspaceTypes.ts
└── web/
    ├── i18n/
    │   ├── index.ts
    │   ├── zh-CN.ts
    │   └── en-US.ts
    ├── theme/
    │   ├── themeTokens.ts
    │   └── applyTheme.ts
    ├── hooks/
    │   ├── useWorkspaceDocuments.ts
    │   ├── useExternalDocumentRefresh.ts
    │   └── useAppSettings.ts
    └── components/
        ├── EmptyState.tsx
        ├── DocumentTabs.tsx
        ├── AppSettingsPanel.tsx
        └── annotations/
```

职责边界：

- `markdownBlocks.ts` 统一解析 Markdown block，服务端修复和前端锚点逻辑共享同一套概念。
- `reviewAnchorCandidates.ts` 负责文本候选生成、上下文评分和置信度判断。
- `reviewAnchorRepair.ts` 只负责把候选结果写回 `.review.json`。
- `documentWatcher.ts` 负责监听 `.md`、`.review.json`、`.codex.json` 变化并生成刷新事件。
- `useWorkspaceDocuments` 管理多文档状态隔离。
- `useExternalDocumentRefresh` 管理延迟刷新和冲突状态。
- `appSettings.ts` / `useAppSettings` 管理语言、配色、启动行为、最近文件和来源自动发现开关。

## 4. 批注锚点稳定性

### 4.1 数据模型

扩展 `ReviewAnchor`，兼容旧 `.review.json`。

```ts
type AnchorPrecision = "exact" | "text" | "block" | "heading" | "unknown";

type BlockFingerprint = {
  kind: string;
  textHash: string;
  normalizedText: string;
  headingId: string | null;
  headingText: string | null;
  previousTextHash?: string;
  nextTextHash?: string;
};

type AnchorRepairMeta = {
  originalSelectedText?: string;
  markdownOffset?: number;
  blockFingerprint?: BlockFingerprint;
  anchorPrecision?: AnchorPrecision;
  repairConfidence?: number;
  repairReason?: string;
  lastRepairedAt?: string;
};
```

迁移规则：

- 旧批注没有 `originalSelectedText` 时，用现有 `selectedText` 初始化。
- 旧批注没有 `anchorPrecision` 时，按 anchor kind 推断：`text -> exact`，`block -> block`，`mermaid -> block`，`document -> heading`。
- 新建批注时同时写入 `selectedText` 和 `originalSelectedText`。

### 4.2 Markdown Block 解析

新增 `server/markdownBlocks.ts`：

```ts
type MarkdownBlock = {
  id: string;
  index: number;
  kind: "heading" | "paragraph" | "list-item" | "blockquote" | "code" | "mermaid" | "table";
  start: number;
  end: number;
  text: string;
  normalizedText: string;
  headingId: string | null;
  headingText: string | null;
  fingerprint: BlockFingerprint;
};
```

注意：

- `id` 仍可沿用 `block-N`，但只表示当前文档的渲染顺序位置。
- `fingerprint` 才是 block 映射使用的弱稳定特征。
- block 解析逻辑需要和 `DocumentViewer` 的 block 生成规则保持一致，避免服务端和前端 block 数量错位。

### 4.3 文本候选生成

新增 `reviewAnchorCandidates.ts`：

```ts
type AnchorCandidate = {
  block: MarkdownBlock;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  absoluteStart: number;
  score: number;
  reasons: string[];
};
```

候选生成顺序：

1. 在原 heading 范围内查找 `selectedText`。
2. 在原 heading 范围内查找 `originalSelectedText`。
3. 在全文查找 `selectedText`。
4. 在全文查找 `originalSelectedText`。
5. 使用 `prefix` / `suffix` 做上下文窗口匹配。
6. 如果仍无候选，使用 block mapping 给出低置信候选。

文本匹配需要同时支持：

- exact match
- whitespace-normalized match
- Markdown syntax-stripped match，例如链接、行内代码、加粗符号

P0 不做 embedding / LLM 语义匹配。

### 4.4 候选评分

建议使用简单可解释的加权评分，先不引入复杂模型。

```text
selectedText exact match                 +40
selectedText normalized match            +32
originalSelectedText exact match         +30
originalSelectedText normalized match    +24
heading id match                         +18
heading text match                       +14
prefix match                             +16
suffix match                             +16
block kind match                         +8
near old blockIndex                      +6
near old markdownOffset                  +6
block mapping supports candidate         +10
```

判定规则：

- `score >= 70` 且第一名领先第二名至少 `12` 分：高置信，自动写回锚点。
- `score >= 55` 但领先不足：中置信，降级到标题，标记 `anchorPrecision = "heading"`。
- `score < 55`：低置信，不使用该候选，降级到标题或 unknown。

这些阈值放在常量中，方便通过测试样例调整。

### 4.5 Block Mapping

block mapping 保留，但只作为候选排序信号和写回新 `blockId` 的辅助。

```ts
type BlockMapping = {
  oldBlockId: string;
  newBlockId: string;
  confidence: number;
  reason: "same-text" | "same-heading-similar-text" | "diff-range" | "neighbor-fingerprint";
};
```

映射顺序：

1. `normalizedText` 完全一致。
2. 同 heading、同 kind、文本相似度高。
3. diff 字符区间映射。
4. previous / next block fingerprint 辅助。

P0 可先实现 1 和 2。diff 区间映射作为后续增强，但接口和类型先预留。

### 4.6 修复流程

`repairReviewAnchors(review, oldMarkdown, newMarkdown, options)`：

1. 解析 old blocks 和 new blocks。
2. 建立 block mapping。
3. 为每条批注生成文本候选。
4. 对候选评分。
5. 高置信时写回：
   - `blockId`
   - `blockIndex`
   - `headingId`
   - `headingText`
   - `startOffset`
   - `endOffset`
   - `selectedText`
   - `prefix`
   - `suffix`
   - `markdownOffset`
   - `blockFingerprint`
   - `anchorPrecision`
   - `repairConfidence`
   - `repairReason`
   - `lastRepairedAt`
6. 无高置信候选时，写回最可信 heading，`anchorPrecision = "heading"`。
7. 返回 `AnchorRepairSummary`。

`preferredSelectedText` 处理：

- 当 MCP 调用 `reviewer_apply_document_edit` 并传入 `preferredSelectedText` 时，把它作为当前 annotation 的最高优先级候选文本。
- 如果定位成功，更新该 annotation 的 `selectedText`。
- 不覆盖 `originalSelectedText`。

### 4.7 前端定位保护

调整 `anchorResolve.ts`：

- 不再先信任 `blockId`。
- 优先在当前 DOM 中按 `selectedText` / `originalSelectedText` 生成候选。
- 候选评分可以复用前端简化版：
  - heading match
  - prefix / suffix
  - block kind
  - blockId weak hint
- 如果无法高置信定位，返回 heading element，不返回旧 `blockId` 指向的可疑 block。

前端定位只用于显示，不直接写 `.review.json`。高置信修复统一由服务端写回，避免前后端结果分裂。

## 5. 外部文件变更自动刷新

### 5.1 文件监听

新增 `server/documentWatcher.ts`，监听当前 workspace 中打开文档对应的：

- `.md`
- `.review.json`
- `.codex.json`

实现建议：

- Node `fs.watch` + debounce，不额外引入 chokidar。
- 每个 documentPath 一个 watcher group。
- debounce 默认 250-500ms，避免保存时多次触发。
- 监听失败时降级为前端低频轮询，不做复杂兜底。

### 5.2 服务端接口

新增或扩展接口：

```text
GET /api/workspace/changes
POST /api/documents/:id/reload
```

`GET /api/workspace/changes` 返回每份打开文档的外部变化状态：

```ts
type DocumentChangeState = {
  documentPath: string;
  markdownChanged: boolean;
  reviewChanged: boolean;
  codexLinkChanged: boolean;
  changedAt: string;
};
```

`POST /api/documents/:id/reload`：

- 读取最新 Markdown、review、codexLink。
- 如果 Markdown 变化且有旧正文，执行 text-first anchor repair。
- 返回新的 document、review、codexLink 和 repair summary。

### 5.3 前端刷新策略

新增 `useExternalDocumentRefresh`：

- 窗口 focus 时启动短轮询或订阅变化状态。
- 只要用户正在选择文字、写批注、回复、编辑或操作 Mermaid lightbox，就把刷新标记为 pending。
- 用户结束操作后应用 pending refresh。
- `.review.json` 和 `.codex.json` 可以局部刷新；`.md` 变化才重载正文。

需要由 `AnnotationWorkspace` 暴露以下 busy 状态：

- `isEditing`
- `isDirty`
- `hasSelection`
- `isAnnotationComposerOpen`
- `isReplyComposerOpen`
- `isLightboxOpen`

### 5.4 编辑冲突

沿用现有 `contentHash` 机制：

- 用户进入编辑态时记录 `editorBaseHash`。
- 外部 Markdown 变化时，如果没有 dirty 草稿，可直接刷新。
- 如果有 dirty 草稿，进入 `externalUpdatePending`。
- 用户保存时，如果磁盘 hash 已变化，返回 conflict。

P0 冲突 UI：

- 保留当前草稿，继续编辑。
- 放弃草稿，载入外部最新版本。
- 取消当前操作。

不做三方 merge 和 diff 预览。

## 6. 多文档工作区

### 6.1 数据模型

新增 `WorkspaceDocumentState`：

```ts
type WorkspaceDocumentState = {
  documentPath: string;
  documentId: string;
  document: ReviewDocument;
  review: ReviewFile;
  codexLink: CodexLinkResponse;
  isActive: boolean;
  isEditing: boolean;
  editorDraft?: string;
  editorBaseHash?: string;
  isDirty: boolean;
  scrollAnchor?: SwitchAnchor;
  tocCollapsed: boolean;
  annotationSidebarOpen: boolean;
  annotationFilter: "all" | "open" | "resolved";
  externalRefresh: "idle" | "pending" | "conflict";
};
```

状态隔离键使用 `documentPath`，不要使用全局单例 `currentDocument`。

### 6.2 服务端多文档

当前 server 以启动时传入的 markdownPath 为默认文档。P0 多文档需要增加 documents registry：

```ts
type OpenDocumentRegistry = {
  activeDocumentPath: string | null;
  documents: Map<string, OpenDocumentServerState>;
};
```

接口建议：

```text
GET /api/documents
POST /api/documents/open
POST /api/documents/activate
POST /api/documents/close
GET /api/document?documentPath=
GET /api/review?documentPath=
GET /api/codex-link?documentPath=
```

兼容策略：

- 旧接口不传 `documentPath` 时使用 active document。
- MCP 工具已经支持 `documentPath`，可以继续沿用。

### 6.3 前端多文档

新增 `DocumentTabs`：

- 顶部轻量文档条。
- 展示文件名和关闭入口。
- 支持打开、切换、关闭。
- 未保存状态、外部更新状态先保留在文档状态区或后续迭代，不作为 P0 tab 强展示。

`App.tsx` 从单文档状态升级为 workspace 状态：

- 空态：没有 open documents。
- 阅读态：有 active document。
- 多文档切换不卸载其他文档的草稿状态。

第一版不做：

- 项目树
- 多窗口
- 跨文档搜索
- 批注聚合面板

## 7. 空态启动页和最近文件

### 7.1 最近文件

新增 `recentDocuments.ts`：

```ts
type RecentDocument = {
  path: string;
  name: string;
  lastOpenedAt: string;
  exists: boolean;
};
```

存储位置：

- 优先使用 Tauri app data 目录。
- CLI 和桌面 App 共享同一份 JSON。
- 文件不存在时保留记录，但 UI 显示轻量状态。

### 7.2 空态 UI

新增 `EmptyState.tsx`：

- 主操作：打开 Markdown 文件。
- 辅助入口：最近文件。
- 错误状态：打开失败、文件不存在。
- 不展示“打开示例文档”。

Finder 打开速度：

- Tauri 桌面端优先调用 native dialog。
- Web fallback 使用已有输入或 API。
- 避免先等待 server 全量初始化后才响应打开文件按钮。

## 8. macOS 菜单栏与设置面板

### 8.1 Tauri 菜单

在 `src-tauri/src/lib.rs` 增加原生菜单：

- Margent
  - Settings...
  - Quit Margent
- File
  - Open Markdown File...
  - Recent Documents

菜单事件通过 Tauri event 传给 web：

```text
margent://menu/open-file
margent://menu/open-settings
margent://menu/open-recent
```

### 8.2 设置持久化

新增 `appSettings.ts`：

```ts
type AppSettings = {
  language: "system" | "zh-CN" | "en-US";
  colorScheme: "default" | "blue-white" | "gray-white";
  startupBehavior: "empty" | "restore-last-documents";
  codexSourceDiscoveryEnabled: boolean;
  externalRefreshEnabled: boolean;
};
```

P0 设置面板只放 App 级设置和当前文档 Codex 协作状态，不放阅读偏好和展示偏好。

## 9. 多语言

### 9.1 i18n key 与文案结构

P0 需要建立统一 i18n key，不允许新增界面文案继续散落在组件里。

技术选择是：**使用自有轻量 i18n key + dictionary，不引入 i18next / FormatJS 等完整框架**。

原因：

- 当前只支持中文 / 英文，文案范围集中在 App UI。
- P0 不涉及复杂复数、性别、时区、本地化格式和远程文案加载。
- 多文档、设置面板、空态和批注侧栏仍在迭代，轻量 key 更容易随组件结构调整。
- 先建立 key 规范，后续如果语言规模扩大，可以迁移到成熟 i18n 框架。

新增 `src/web/i18n`：

```ts
type LocaleKey =
  | "empty.openMarkdown"
  | "annotation.reply"
  | "annotation.edit"
  | "annotation.delete"
  | "document.save"
  | "document.exitEdit"
  | "settings.title";
```

实现方式：

- 所有用户可见 UI 文案必须通过 i18n key 读取。
- `zh-CN.ts` 和 `en-US.ts` 导出同一组 key。
- `useI18n()` 返回 `t(key, params)`。
- `t()` 支持最小参数替换，例如 `{fileName}`、`{count}`。
- TypeScript 通过 `LocaleKey` 约束 key，避免运行时拼错。
- macOS 菜单文案由 server/desktop 读取同一份语言配置，或用最小映射生成。

示例：

```ts
export const zhCN: Record<LocaleKey, string> = {
  "empty.openMarkdown": "打开 Markdown 文件",
  "annotation.reply": "回复",
  "document.save": "保存"
};

export const enUS: Record<LocaleKey, string> = {
  "empty.openMarkdown": "Open Markdown File",
  "annotation.reply": "Reply",
  "document.save": "Save"
};
```

P0 不引入：

- namespace 动态加载。
- ICU message format。
- 复杂 plural rules。
- 运行时远程文案。
- 自动机器翻译。

这些能力等第三语言、复杂日期数量格式或团队分发需求出现后再评估。

### 9.2 语言选择

默认规则：

- 用户未设置时读取系统语言。
- `zh-*` 使用中文。
- 其他使用英文。

切换语言后：

- 立即更新 Web UI。
- 持久化到 app settings。
- macOS 菜单可以在下次窗口刷新或设置保存后重建。

## 10. 配色方案

### 10.1 Token 结构

新增 `src/web/theme/themeTokens.ts`：

```ts
type ThemeName = "default" | "blue-white" | "gray-white";

type ThemeTokens = {
  colorBg: string;
  colorSurface: string;
  colorText: string;
  colorMuted: string;
  colorBorder: string;
  colorAccent: string;
  colorAccentSoft: string;
  colorDanger: string;
  colorCodeBg: string;
  colorAnnotationOpen: string;
  colorAnnotationResolved: string;
};
```

主题通过 CSS variables 注入：

```css
:root {
  --color-bg: ...;
  --color-surface: ...;
}
```

### 10.2 覆盖范围

需要把当前 `styles.css` 中硬编码颜色逐步替换为 token：

- 页面背景
- 文档正文
- 目录栏
- 批注列表
- 按钮、输入框、分段控件
- toast
- 表格
- 代码块
- Mermaid 容器和工具栏
- 批注高亮

P0 不做用户自定义色值。

## 11. Codex 来源自动发现

### 11.1 扫描范围

新增 `server/codexSessionDiscovery.ts`：

- 扫描最近 Codex session 日志。
- 限制当前 workspace 相关路径。
- 优先匹配完整 Markdown 绝对路径。
- 不上传日志，不把日志正文写入 `.codex.json`。

### 11.2 置信度

高置信自动绑定：

- 唯一 session 出现完整文档路径。
- 可以提取 thread id。
- session 更新时间接近文件创建或修改时间。

低置信不绑定：

- 多个候选。
- 只有文件名。
- 无 thread id。

写入 `.codex.json`：

```json
{
  "source": { "threadId": "..." },
  "target": { "type": "source", "threadId": "..." },
  "configuredVia": "local-log-discovery",
  "discoveredAt": "..."
}
```

## 12. MCP 与后台投递

现有 MCP 已支持 `documentPath`。多文档阶段需要保持：

- 所有 document-specific 工具都支持 `documentPath`。
- 自动投递 prompt 必须带 documentPath、annotationId、eventId。
- 多个文档同时开启自动监控时，按 documentPath 串行投递。
- 同一文档不能并发投递多个会修改正文的 Codex turn。

事件状态刷新：

- 前端只刷新 review / codex 状态，不重建整个正文。
- 正文刷新只在事件完成且文档内容 hash 变化时触发。
- 用户 busy 时进入 pending refresh。

## 13. 测试策略

优先补 Vitest 或 Node 内置测试，覆盖纯函数。

### 13.1 锚点修复测试

必须覆盖：

- 文档前部新增 section，旧 blockId 漂移。
- `selectedText` 全文唯一命中。
- `selectedText` 多处命中，靠 heading 消歧。
- `selectedText` 多处命中，靠 prefix / suffix 消歧。
- 标题重命名但段落连续。
- block 拆分。
- block 合并。
- Agent 传入 `preferredSelectedText` 后更新 `selectedText`。
- 找不到可靠候选时降级 heading。

### 13.2 外部刷新测试

- `.review.json` 外部变化只刷新批注。
- `.codex.json` 外部变化只刷新连接状态。
- `.md` 外部变化触发正文 reload 和 anchor repair。
- 用户有 dirty 草稿时进入 conflict，不覆盖草稿。

### 13.3 前端手测

- 打开多个文档并切换。
- 每个文档保留独立批注列表状态。
- 在文档 A 编辑未保存，切到文档 B，再切回 A，草稿仍在。
- 外部修改后台文档，不打断当前文档。
- 主题和语言切换后主要 UI 无明显漏项。

## 14. 开发顺序

建议按以下顺序实现：

1. 抽出 `markdownBlocks.ts`，统一 block 解析和 fingerprint。
2. 扩展 `ReviewAnchor` 数据模型，兼容旧 `.review.json`。
3. 实现 text-first candidate generation 和 scoring。
4. 改造 `reviewAnchorRepair.ts`，保存后回扫全部历史批注。
5. 改造前端 `anchorResolve.ts`，不再优先信任旧 `blockId`。
6. 接入外部文件 watcher 和 pending refresh。
7. 抽象 workspace documents，多文档打开 / 切换 / 关闭。
8. 增加空态启动页和最近文件共享存储。
9. 增加 macOS 菜单栏和统一设置面板。
10. 增加 i18n dictionary。
11. 增加 theme token 和三套配色。
12. 增加 Codex source discovery。

优先级说明：

- 锚点稳定性先做，因为它直接影响批注可信度。
- 外部刷新依赖同一套锚点修复能力，排在锚点之后。
- 多文档会改变状态组织方式，需要在 UI 大改前完成。
- 语言和配色最后做，避免在组件结构未稳定时重复抽文案和 token。

## 15. 风险与处理

### 15.1 文本匹配多候选

风险：相同短句在文档中多次出现，系统误选。

处理：

- 多候选必须评分。
- 第一名领先不足时降级 heading。
- 不为了看起来精确而强行高亮可疑文本。

### 15.2 文本被大幅改写

风险：`selectedText` 和 prefix / suffix 都找不到。

处理：

- 不做语义恢复。
- 使用 block mapping 作为弱提示。
- 不可信时挂到标题。

### 15.3 外部刷新打断用户操作

风险：刷新导致选区、批注弹窗或编辑草稿丢失。

处理：

- 引入 busy 状态。
- 正文刷新延迟到用户操作结束。
- review / codex 状态尽量局部刷新。

### 15.4 多文档状态串线

风险：文档 A 的批注状态、草稿或 Codex 连接出现在文档 B。

处理：

- 所有状态以 `documentPath` 隔离。
- API 层所有 document-specific 请求带 `documentPath`。
- MCP 工具继续要求明确 documentPath。

### 15.5 macOS 能力与 Web 开发环境差异

风险：localhost 可用，但打包 App 的菜单、权限、默认打开方式不一致。

处理：

- 涉及 Finder、菜单栏、默认打开方式和文件 watcher 的功能必须在 `/Applications/Margent.app` 验证。
- Web 环境只作为 UI 调试，不作为最终验收依据。
