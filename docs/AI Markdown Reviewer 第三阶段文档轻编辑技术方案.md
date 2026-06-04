# AI Markdown Reviewer 第三阶段文档轻编辑技术方案

## 1. 技术目标

第三阶段在第二阶段批注协作闭环之上，增加整篇 Markdown 轻编辑能力：

- 用户可以在阅读模式和编辑模式之间切换。
- 编辑模式下直接编辑当前 `.md` 文件全文。
- 编辑草稿支持预览、保存、取消和未保存保护。
- 保存后重新加载文档并修复批注锚点。
- MCP 增加正文修改工具，Agent 可以修改 Markdown 文件并重标记关联批注锚点。

本阶段不做块级编辑、不做富文本编辑、不做 diff 预览、不做版本历史。

## 2. 编辑器选型

### 2.1 需求判断

当前产品需要的是 Markdown 源码编辑器，而不是 WYSIWYG Markdown 编辑器。

关键要求：

- 能稳定编辑整篇 Markdown 文本。
- 能和 React / Vite 项目自然集成。
- 支持大文档基础性能。
- 支持键盘、搜索、撤销、选区和滚动。
- 不接管 Markdown 渲染和预览 UI。
- 不引入重型文档模型，避免和现有 `react-markdown` 阅读渲染、批注 overlay、Mermaid 增强冲突。

### 2.2 候选方案

| 方案 | 类型 | 优点 | 风险 / 不匹配点 | 结论 |
| --- | --- | --- | --- | --- |
| 原生 `textarea` | 自研轻量源码编辑 | 零依赖、实现最快、保存和 dirty 状态简单 | 大文档体验、搜索、快捷键、缩进、可访问性和后续扩展都要自己补 | 可作为临时 MVP，不建议作为主方案 |
| CodeMirror 6 | 浏览器源码编辑器 | MIT；专注源码编辑；有 Markdown language package；可按需组合扩展；适合 React 自封装 | 需要写 React lifecycle 包装；主题和样式要自己接入 | 推荐 |
| Monaco Editor | VS Code 同源编辑器 | 功能强，模型、撤销、搜索成熟 | 体积和 worker 更重；官方说明移动浏览器不支持；会把产品带向 IDE 感 | 不推荐 P0 |
| TOAST UI Editor | 成品 Markdown/WYSIWYG 编辑器 | Markdown / WYSIWYG 双模式、live preview、scroll sync 成熟 | 会接管预览和工具栏，和现有阅读器、Mermaid、批注体验重复 | 不推荐 |
| ByteMD | 成品 Markdown 编辑器 | 有 React 包、插件、预览能力 | v1 repo 指向 v2/HashMD 开发中；会接管编辑/预览结构 | 不推荐 |
| Milkdown | WYSIWYG Markdown framework | Typora 类体验，生态活跃 | 基于 ProseMirror 的富文本路线，和“源码编辑”目标相反 | 不推荐 |

### 2.3 推荐结论

第三阶段采用 **CodeMirror 6**。

原因：

- 产品目标是整篇 Markdown 源码编辑，CodeMirror 比 WYSIWYG 编辑器更贴合。
- CodeMirror 可以只负责输入体验，预览仍复用当前 `DocumentViewer`、Mermaid、表格和批注渲染链路。
- 后续如果需要搜索、语法高亮、快捷键、行号、折叠、lint，可以逐步加 CodeMirror extension，不需要重写编辑器。
- 比 Monaco 更轻，更符合当前本地审阅工具的产品调性。

第一版可安装：

```text
codemirror
@codemirror/lang-markdown
@codemirror/search
@codemirror/theme-one-dark
```

如果希望再克制一点，也可以先不引入 `@codemirror/theme-one-dark`，用自定义 light/dark theme extension。

## 3. 工程结构调整

新增和调整后的结构：

```text
src/
├── server/
│   ├── document.ts
│   ├── documentEdit.ts
│   ├── review.ts
│   └── reviewAnchorRepair.ts
├── shared/
│   ├── types.ts
│   ├── editTypes.ts
│   └── reviewTypes.ts
├── mcp/
│   ├── server.ts
│   └── tools.ts
└── web/
    ├── api.ts
    ├── hooks/
    │   ├── useDocument.ts
    │   ├── useDocumentEditor.ts
    │   └── useReview.ts
    ├── components/
    │   ├── DocumentWorkspace.tsx
    │   ├── DocumentViewer.tsx
    │   ├── editor/
    │   │   ├── MarkdownSourceEditor.tsx
    │   │   ├── EditorToolbar.tsx
    │   │   ├── EditorPreview.tsx
    │   │   └── UnsavedChangesDialog.tsx
    │   └── annotations/
    └── editor/
        ├── createMarkdownEditorExtensions.ts
        └── markdownEditorTheme.ts
```

说明：

- `server/documentEdit.ts` 负责 Markdown 文件写回、内容 hash、编辑结果返回。
- `server/reviewAnchorRepair.ts` 负责保存后的批注锚点修复。
- `shared/editTypes.ts` 放前后端共用编辑请求/响应类型。
- `DocumentWorkspace` 取代当前 `AnnotationWorkspace` 的顶层职责，统一管理阅读、编辑、预览和批注入口。
- `AnnotationWorkspace` 后续可缩小为阅读态批注能力，或被拆进 `DocumentWorkspace`。
- `MarkdownSourceEditor` 是 CodeMirror 的 React 包装组件，不直接依赖业务 API。

## 4. 数据模型

### 4.1 `ReviewDocument`

沿用现有结构：

```ts
type ReviewDocument = {
  id: string;
  absolutePath: string;
  relativePath: string;
  reviewPath: string;
  content: string;
  headings: Heading[];
};
```

第三阶段需要在响应中补充文档版本信息：

```ts
type ReviewDocument = {
  id: string;
  absolutePath: string;
  relativePath: string;
  reviewPath: string;
  content: string;
  contentHash: string;
  loadedAt: string;
  headings: Heading[];
};
```

`contentHash` 用于保存时做最小并发保护。第三阶段不做复杂三方 merge，但可以识别“文件已经不是你打开时的内容”。

### 4.2 编辑请求

```ts
type SaveDocumentRequest = {
  content: string;
  baseContentHash: string;
};
```

### 4.3 编辑响应

```ts
type SaveDocumentResponse = {
  document: ReviewDocument;
  review: ReviewFile;
  repairedAnnotations: AnchorRepairSummary;
};
```

### 4.4 批注锚点修复摘要

```ts
type AnchorRepairSummary = {
  total: number;
  exact: number;
  fuzzy: number;
  headingFallback: number;
  unresolved: number;
  items: Array<{
    annotationId: string;
    result: "exact" | "fuzzy" | "headingFallback" | "unresolved";
  }>;
};
```

第一版 UI 不需要展示完整摘要，但 API 返回它，方便调试和后续能力扩展。

## 5. 服务端设计

### 5.1 读取文档

现有 `loadReviewDocument` 已负责：

- 读取 Markdown 原文。
- 解析 headings。
- 返回路径、reviewPath 和 content。

第三阶段增加：

- `contentHash`：对当前 content 做 SHA-256。
- `loadedAt`：服务端读取时间。

### 5.2 保存文档

新增 `saveReviewDocument(markdownPath, request)`：

1. 读取磁盘当前内容。
2. 计算当前 `contentHash`。
3. 对比 `baseContentHash`。
4. 如果 hash 不一致，返回 `409 Conflict`。
5. 如果一致，使用临时文件 + rename 写回 Markdown：

```text
document.md.tmp
document.md
```

6. 重新调用 `loadReviewDocument`。
7. 修复 `.review.json` 中批注锚点。
8. 保存修复后的 `.review.json`。
9. 返回新的 document、review 和修复摘要。

### 5.3 写入失败处理

保存失败时：

- 不覆盖 Markdown 文件。
- 返回明确错误。
- 前端保留当前草稿和 dirty 状态。

### 5.4 外部文件变更

第三阶段不做 merge，只做检测：

- 如果保存时 `baseContentHash` 和磁盘内容 hash 不一致，返回 409。
- 前端提示：文件已被外部修改，请刷新后重新编辑。
- 不自动合并用户草稿和外部修改。

## 6. HTTP API

### GET `/api/document`

返回当前文档。第三阶段响应增加：

```ts
{
  contentHash: string;
  loadedAt: string;
}
```

### PUT `/api/document`

保存当前 Markdown 全文。

请求：

```ts
type SaveDocumentRequest = {
  content: string;
  baseContentHash: string;
};
```

响应：

```ts
type SaveDocumentResponse = {
  document: ReviewDocument;
  review: ReviewFile;
  repairedAnnotations: AnchorRepairSummary;
};
```

错误：

- `400`：content 缺失或格式不正确。
- `409`：文件已被外部修改。
- `500`：读写失败或解析失败。

### POST `/api/document/reload`

可选。重新读取磁盘上的 Markdown 和 review 数据。

如果不新增该接口，前端也可以直接重新调用：

- `GET /api/document`
- `GET /api/review`

第一版建议不新增 reload 接口，保持 API 简单。

## 7. 前端设计

### 7.1 顶层状态

新增 `DocumentWorkspace` 管理：

```ts
type WorkspaceMode = "read" | "edit";
type EditorViewMode = "source" | "preview";

type EditorState = {
  mode: WorkspaceMode;
  viewMode: EditorViewMode;
  draft: string;
  baseContent: string;
  baseContentHash: string;
  isDirty: boolean;
  isSaving: boolean;
  error?: string;
};
```

### 7.2 阅读模式

阅读模式沿用当前能力：

- `DocumentViewer`
- `AnnotationLayer`
- `AnnotationSelectionToolbar`
- `AnnotationSidebar`
- Mermaid 增强阅读
- 表格横向滚动和列宽调整

阅读模式下不显示源码编辑器。

### 7.3 编辑模式

编辑模式页面结构：

```text
EditorToolbar
├── 返回阅读
├── 源码 / 预览 segmented control
├── 未保存状态
├── 取消
└── 保存

source:
  MarkdownSourceEditor

preview:
  EditorPreview -> DocumentViewer(draft document)
```

设计原则：

- 编辑模式优先保证源码编辑区域宽敞。
- 批注侧栏入口可以保留，但默认不打开。
- 预览使用当前草稿构造临时 `ReviewDocument`，不写磁盘。

### 7.4 CodeMirror React 包装

`MarkdownSourceEditor` 负责：

- 创建 `EditorView`。
- 接收 `value` 和 `onChange`。
- 根据 light/dark 主题切换 extension。
- unmount 时 destroy editor。
- 外部 `value` 变化时同步到 editor，但避免每次输入都重建实例。

示意：

```tsx
type MarkdownSourceEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};
```

CodeMirror extensions：

```ts
[
  basicSetup,
  markdown(),
  search(),
  EditorView.lineWrapping,
  markdownEditorTheme
]
```

第一版不做复杂语法补全和 Markdown lint。

### 7.5 预览实现

编辑预览不走服务端。

前端用当前草稿构造：

```ts
const draftDocument: ReviewDocument = {
  ...document,
  content: draft,
  headings: parseHeadingsOnClient(draft)
};
```

为了避免重复实现 heading 解析，建议新增前后端共用的纯函数：

```text
src/shared/markdownHeadings.ts
```

服务端 `document.ts` 和前端预览都复用它。

### 7.6 未保存保护

触发条件：

- `draft !== baseContent`

保护点：

- 从编辑模式回阅读模式。
- 点击取消。
- 浏览器刷新或关闭。

实现：

- 应用内切换使用自定义确认弹窗。
- 浏览器刷新/关闭使用 `beforeunload`。

### 7.7 保存流程

前端保存步骤：

1. 调用 `PUT /api/document`。
2. 成功后更新 document state。
3. 更新 review state。
4. 设置 `baseContent = document.content`。
5. 设置 `baseContentHash = document.contentHash`。
6. 清除 dirty。
7. 切回阅读模式或停留编辑模式。

建议第一版保存后切回阅读模式，让用户明确看到最终渲染结果。

## 8. 批注锚点修复

### 8.1 修复触发时机

触发于：

- 用户保存 Markdown 后。
- Agent 通过 MCP 修改 Markdown 后。

### 8.2 修复输入

```ts
type RepairAnchorsInput = {
  previousMarkdown: string;
  nextMarkdown: string;
  review: ReviewFile;
  relatedAnnotationId?: string;
  preferredSelectedText?: string;
};
```

### 8.3 修复策略

对每条批注：

1. 如果是关联批注且传入 `preferredSelectedText`，优先在新 Markdown 中寻找该文本。
2. 使用原 `selectedText` 精确查找。
3. 使用 `prefix + selectedText + suffix` 附近上下文做模糊匹配。
4. 使用原 `headingText` 找新 heading。
5. 使用原 heading 下的相近块位置。
6. 找不到时标记为 `unresolved`，但不删除批注。

### 8.4 修复输出

修复后更新：

- `anchor.headingId`
- `anchor.headingText`
- `anchor.blockIndex`
- `anchor.blockId`
- `anchor.startOffset`
- `anchor.endOffset`
- `anchor.prefix`
- `anchor.suffix`
- `anchor.selectedText`

如果只能挂到 heading，则：

- `kind` 可保持原类型。
- `headingId` / `headingText` 更新为 fallback heading。
- `selectedText` 保留原值，便于后续人工判断。

### 8.5 第一版取舍

第一版可以先实现：

- 精确文本匹配。
- heading fallback。
- 关联批注 preferred text 匹配。

模糊上下文匹配可以作为同阶段第二步增强。

## 9. MCP 设计

### 9.1 新增工具：`reviewer_apply_document_edit`

用途：让 Agent 修改当前 Markdown 正文。

输入：

```ts
type ApplyDocumentEditInput = {
  content: string;
  annotationId?: string;
  preferredSelectedText?: string;
  replyBody?: string;
  resolveAnnotation?: boolean;
};
```

说明：

- `content` 是修改后的完整 Markdown。
- `annotationId` 表示这次修改关联哪条批注。
- `preferredSelectedText` 用于修改后重标记关联批注锚点。
- `replyBody` 可选；如果传入，工具在保存后自动追加回复。
- `resolveAnnotation` 可选；如果为 true，工具在保存后将关联批注标记为 `resolved`。

### 9.2 工具行为

执行步骤：

1. 读取当前 Markdown 和 review。
2. 保存新 Markdown。
3. 修复全部批注锚点。
4. 如果有 `annotationId`，优先将该批注锚点重标记到修改后的文本。
5. 如果传入 `replyBody`，追加 Agent 回复。
6. 如果 `resolveAnnotation = true`，更新该批注状态。
7. 返回新文档、关联批注和锚点修复摘要。

### 9.3 工具说明中的建议

MCP 工具描述中写入建议：

- 只有当用户批注或指令的修改目标足够明确时，才调用该工具。
- 修改完成后，应追加回复说明改了什么。
- 如果修改已完整满足批注，可以标记 `resolved`。
- 如果只是部分处理或需要用户判断，不建议自动标记 `resolved`。

这些建议不作为产品侧硬规则。

## 10. 测试方案

### 10.1 单元测试

覆盖：

- Markdown heading 解析。
- `contentHash` 计算。
- 保存时 hash 冲突。
- 临时文件写入失败。
- 批注锚点精确匹配。
- heading fallback。
- 关联批注 preferred text 匹配。

### 10.2 前端测试

覆盖：

- 进入编辑模式。
- 输入后 dirty 状态出现。
- 取消编辑恢复原文。
- 预览渲染当前草稿。
- 保存成功后回到阅读态。
- 保存失败保留草稿。
- `beforeunload` 在 dirty 时注册。

### 10.3 集成测试

覆盖：

- `PUT /api/document` 写回 Markdown。
- 保存后 `GET /api/document` 返回新内容。
- 保存后 `.review.json` 的批注仍存在。
- 修改被批注文本后，批注能重新定位或 fallback 到 heading。
- MCP `reviewer_apply_document_edit` 修改正文、追加回复并可标记 resolved。

### 10.4 手工验收

使用已有三份文档验证：

- `backend-agent-architecture.md`
- `context-strategy.md`
- `prd-current-scope-outline.md`

重点检查：

- 长文档编辑性能。
- Mermaid 源码修改后预览渲染。
- 表格源码修改后预览横向滚动。
- 批注面板在编辑/阅读切换后状态稳定。

## 11. 实施顺序

### Step 1：文档保存基础能力

- 增加 `contentHash`。
- 增加 `PUT /api/document`。
- 增加 `saveReviewDocument`。
- 保存后重新返回 document。

### Step 2：前端编辑模式

- 增加 `DocumentWorkspace`。
- 增加 `EditorToolbar`。
- 增加 `MarkdownSourceEditor`。
- 接入 CodeMirror 6。
- 支持 dirty、取消、保存。

### Step 3：编辑预览

- 抽出共享 heading 解析函数。
- 用草稿构造临时 `ReviewDocument`。
- 复用 `DocumentViewer` 做预览。

### Step 4：批注锚点修复

- 增加 `reviewAnchorRepair.ts`。
- 保存后修复 review。
- 返回修复摘要。

### Step 5：MCP 修改正文工具

- 增加 `reviewer_apply_document_edit`。
- 支持 `annotationId`、`preferredSelectedText`、`replyBody`、`resolveAnnotation`。
- 更新工具说明中的建议性行为指导。

## 12. 风险与取舍

### 12.1 CodeMirror 集成复杂度

CodeMirror 6 的 React 包装需要自己处理 lifecycle。为了降低复杂度：

- 不引入第三方 React wrapper。
- 自己封装一个薄组件。
- CodeMirror 只管理源码编辑，不参与业务状态流转。

### 12.2 全文保存风险

全文保存可能误覆盖外部修改。

第一版用 `contentHash` 检测冲突，不做 merge。

### 12.3 锚点修复准确率

大幅改写后无法保证精确定位。

第一版保证：

- 不删除批注。
- 能精确匹配则精确匹配。
- 不能匹配则 fallback 到 heading。

### 12.4 预览性能

长文档每次输入都实时渲染可能卡顿。

第一版采用“源码 / 预览”切换，不做输入时实时双栏预览。只有切换到预览时渲染当前草稿。

## 13. 外部资料

- CodeMirror 官网：`https://codemirror.com/`
- CodeMirror Markdown package：`https://github.com/codemirror/lang-markdown`
- Monaco Editor：`https://github.com/microsoft/monaco-editor`
- TOAST UI Editor：`https://github.com/nhn/tui.editor`
- ByteMD：`https://github.com/pd4d10/bytemd`
- Milkdown：`https://github.com/Milkdown/milkdown`
