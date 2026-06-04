# AI Markdown Reviewer 第二阶段批注功能技术方案

## 1. 技术目标

第二阶段在第一阶段阅读器基础上增加批注协作能力：

- 本地 `.review.json` 读写。
- 前端创建批注、展示批注、回复批注和切换状态。
- 正文批注高亮、批注跳转和右侧批注面板。
- 批注锚点修复。
- MCP 暴露文档读取、批注读取、上下文读取、回复写入和状态更新能力。

本阶段优先完成批注闭环和 MCP 协作能力，不做完整 Markdown 编辑器、不做批注导出、不做云同步。

## 2. 技术原则

- 批注数据和 Markdown 文档并列保存在本地，不引入账号和云端状态。
- 产品只提供批注、回复、状态和文档上下文能力，不硬性规定 Agent 何时必须解决批注。
- MCP 工具描述中提供建议性使用指导，帮助 Agent 在合适时机标记 `resolved` 或重新打开为 `open`。
- 批注锚点尽量恢复原位置；恢复失败时挂到原上一级标题下。
- 正文高亮不直接改写 Markdown 渲染树，优先使用 overlay，避免破坏代码块、表格和 Mermaid 布局。

## 3. 工程结构调整

新增和调整后的结构：

```text
src/
├── server/
│   ├── review.ts
│   ├── reviewContext.ts
│   └── reviewAnchors.ts
├── shared/
│   ├── types.ts
│   └── reviewTypes.ts
├── mcp/
│   ├── server.ts
│   └── tools.ts
└── web/
    ├── api.ts
    ├── hooks/
    │   └── useReview.ts
    ├── components/
    │   ├── annotations/
    │   │   ├── AnnotationLayer.tsx
    │   │   ├── AnnotationSelectionToolbar.tsx
    │   │   ├── AnnotationComposer.tsx
    │   │   ├── AnnotationSidebar.tsx
    │   │   ├── AnnotationCard.tsx
    │   │   └── AnnotationThread.tsx
    │   └── DocumentViewer.tsx
    └── review/
        ├── anchorCapture.ts
        ├── anchorResolve.ts
        └── blockIndex.ts
```

说明：

- `server/review.ts` 负责 `.review.json` 读写和接口处理。
- `server/reviewContext.ts` 负责按批注生成 Agent 可读上下文。
- `server/reviewAnchors.ts` 负责服务端层面的锚点修复和 Markdown 块提取。
- `shared/reviewTypes.ts` 放前后端共用类型。
- `web/review/*` 放前端选区捕获、DOM Range 解析和 overlay 定位逻辑。
- `mcp/*` 在 HTTP API 稳定后接入，复用 server 层能力。

## 4. 数据模型

### 4.1 ReviewFile

```ts
type ReviewFile = {
  version: 1;
  documentPath: string;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  annotations: ReviewAnnotation[];
};
```

### 4.2 ReviewAnnotation

```ts
type AnnotationStatus = "open" | "resolved";

type ReviewAnnotation = {
  id: string;
  status: AnnotationStatus;
  author: ReviewAuthor;
  body: string;
  anchor: ReviewAnchor;
  replies: ReviewReply[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};
```

### 4.3 ReviewReply

```ts
type ReviewReply = {
  id: string;
  author: ReviewAuthor;
  body: string;
  createdAt: string;
};

type ReviewAuthor = {
  type: "user" | "agent";
  name: string;
};
```

### 4.4 ReviewAnchor

```ts
type ReviewAnchor =
  | TextReviewAnchor
  | BlockReviewAnchor
  | MermaidReviewAnchor;

type TextReviewAnchor = {
  kind: "text";
  headingId: string | null;
  headingText: string | null;
  blockId: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
};

type BlockReviewAnchor = {
  kind: "block";
  headingId: string | null;
  headingText: string | null;
  blockId: string;
  blockIndex: number;
  selectedText: string;
};

type MermaidReviewAnchor = {
  kind: "mermaid";
  headingId: string | null;
  headingText: string | null;
  mermaidIndex: number;
  selectedText: string;
};
```

设计说明：

- P0 创建批注时尽量使用 `text` anchor。
- 跨多个块的选区可以先退化成 `block` anchor，并保留完整 `selectedText`。
- Mermaid 第一版使用 `mermaid` anchor，定位到整张图。
- 不在数据结构中强制保存“提问/修改”类型，Agent 可根据 `body` 和上下文自行判断。

## 5. `.review.json` 读写

### 5.1 路径

沿用第一阶段已有 `reviewPath`：

```text
<markdown dir>/<markdown basename>.review.json
```

### 5.2 读取

规则：

- 文件不存在时返回空结构。
- 文件存在时解析 JSON。
- `version` 不匹配时保留原始数据并返回可读错误。

### 5.3 写入

写入采用临时文件 + rename：

```text
context-strategy.review.json.tmp
context-strategy.review.json
```

这样可以降低写入中断导致 review 文件损坏的概率。

### 5.4 并发

第二阶段是单用户本地工具，不做复杂并发控制。接口写入时以当前服务内存中的最新 review 为准，并更新 `updatedAt`。

## 6. HTTP API

### GET `/api/review`

返回当前文档 review 数据。

```ts
type GetReviewResponse = ReviewFile;
```

### PUT `/api/review`

保存完整 review 数据。主要用于前端批量更新。

### POST `/api/review/annotations`

创建批注。

```ts
type CreateAnnotationRequest = {
  body: string;
  anchor: ReviewAnchor;
};
```

### POST `/api/review/annotations/:id/replies`

追加回复。

```ts
type AddReplyRequest = {
  author: ReviewAuthor;
  body: string;
};
```

### PATCH `/api/review/annotations/:id`

编辑批注正文。

```ts
type UpdateAnnotationRequest = {
  body: string;
};
```

### PATCH `/api/review/annotations/:id/replies/:replyId`

编辑某条回复正文。

```ts
type UpdateReplyRequest = {
  body: string;
};
```

### PATCH `/api/review/annotations/:id/status`

更新状态。

```ts
type UpdateAnnotationStatusRequest = {
  status: AnnotationStatus;
};
```

### GET `/api/review/annotations/:id/context`

返回单条批注上下文，供前端和 MCP 复用。

```ts
type AnnotationContext = {
  annotation: ReviewAnnotation;
  selectedText: string;
  heading: Heading | null;
  beforeMarkdown: string;
  afterMarkdown: string;
  relatedMarkdown: string;
  replies: ReviewReply[];
};
```

## 7. 前端批注架构

### 7.1 useReview

`useReview` 负责：

- 拉取 `/api/review`。
- 创建批注。
- 追加回复。
- 更新状态。
- 维护当前选中批注。
- 触发批注锚点重新解析。

### 7.2 DocumentViewer 调整

`DocumentViewer` 需要在 Markdown 渲染区外包一层 review 容器：

```tsx
<ReviewProvider document={document}>
  <DocumentViewer />
  <AnnotationLayer />
  <AnnotationSelectionToolbar />
  <AnnotationSidebar />
</ReviewProvider>
```

### 7.3 Markdown block id

批注需要稳定块级定位。建议新增轻量 remark plugin，为块级节点加属性：

```html
data-review-block-id="block-12"
data-review-block-index="12"
data-review-heading-id="architecture"
```

需要覆盖：

- heading
- paragraph
- list item
- blockquote
- pre/code
- table
- Mermaid block wrapper

实现上可以自写一个 `remarkReviewBlocks` 插件，遍历 mdast block 节点并写入 `data.hProperties`。不需要为了这个引入大型依赖。

### 7.4 选区捕获

用户选中文本后：

1. 读取 `window.getSelection()`。
2. 判断选区是否位于文档正文容器内。
3. 找到 anchorNode 所属的 `data-review-block-id`。
4. 计算选区在该 block 的 textContent 中的 start/end offset。
5. 截取 prefix/suffix。
6. 显示 `AnnotationSelectionToolbar`。

跨 block 选区：

- P0 可以创建 `block` anchor。
- `selectedText` 保存完整选区文本。
- 定位时优先通过 selectedText 在当前 heading 范围内恢复。

### 7.5 批注高亮

正文高亮采用 overlay，不直接把 Markdown DOM 拆成 mark 节点。

流程：

1. 根据批注 anchor resolve 出 DOM Range。
2. 读取 `range.getClientRects()`。
3. 将 rect 转换成文档容器内的绝对位置。
4. `AnnotationLayer` 绘制半透明矩形。
5. 点击矩形时选中对应批注。

好处：

- 不破坏 React Markdown 输出。
- 不影响代码块、表格、Mermaid SVG 布局。
- 多条批注重叠时可以用不同 z-index 或边框表达。

### 7.6 右侧批注面板

`AnnotationSidebar` 组成：

- 顶部筛选：未解决 / 已解决 / 全部，默认全部。
- 批注列表。
- 每张卡片的状态图标操作：`解决` / `重新打开`。
- 每张卡片的轻量操作：回复、编辑。
- 选中卡片内联展开回复线程、回复输入框和编辑框。

状态展示：

- `open` 显示为待处理。
- `resolved` 显示为已解决。

编辑能力：

- 批注正文支持 textarea 内联编辑。
- 回复支持追加和 textarea 内联编辑。
- 编辑批注或回复时更新 annotation 的 `updatedAt`，回复自身可记录 `updatedAt`。

## 8. 批注锚点解析与修复

### 8.1 前端解析

前端用于显示高亮和跳转。

定位顺序：

1. 找 `data-review-block-id`。
2. 检查 block textContent 中 start/end offset 是否仍匹配 selectedText。
3. 若不匹配，在 block textContent 中查找 selectedText。
4. 若 block 内找不到，在同 heading 范围内查找 selectedText。
5. 若仍找不到，定位到 heading 元素。

### 8.2 服务端解析

服务端用于 MCP 上下文组装。

服务端不依赖 DOM，基于 Markdown 文本切分：

- heading ranges
- block ranges
- selectedText fuzzy search
- prefix/suffix search

服务端找不到原文时，返回上一级 heading 范围作为上下文。

### 8.3 修复写回

当系统成功通过 fuzzy search 找到更准确的位置，可以更新 anchor：

- `blockIndex`
- `startOffset`
- `endOffset`
- `prefix`
- `suffix`

是否自动写回：

- P0 可以只在内存中使用修复结果。
- P1.5 再将修复后的 anchor 写回 `.review.json`。

## 9. MCP 方案

### 9.1 MCP Server 形态

新增 `src/mcp/server.ts`，使用 MCP SDK 暴露 stdio server。

建议 CLI 形态：

```bash
ai-md-reviewer-mcp <markdown-file>
```

或：

```bash
ai-md-reviewer <markdown-file> --mcp
```

实现时优先做独立 MCP 入口，避免和 Web Server 生命周期耦合过深。

当前实现提供两个入口：

```bash
ai-md-reviewer-mcp <markdown-file>
```

以及：

```bash
ai-md-reviewer <markdown-file> --mcp
```

两者都会启动 stdio MCP server，不启动 Web 阅读器，也不会向 stdout 输出非 MCP 协议内容。

### 9.2 MCP 复用 server 层能力

MCP 不直接读写散落文件，而是复用：

- `server/document.ts`
- `server/review.ts`
- `server/reviewContext.ts`
- `server/reviewAnchors.ts`

这样 HTTP API 和 MCP 的行为保持一致。

### 9.3 MCP Tools

#### `reviewer_get_document`

返回当前文档内容、路径、headings 和 reviewPath。

#### `reviewer_list_annotations`

参数：

```ts
type ListAnnotationsInput = {
  status?: "open" | "resolved" | "all";
};
```

返回批注摘要列表。

#### `reviewer_get_annotation_context`

参数：

```ts
type GetAnnotationContextInput = {
  annotationId: string;
};
```

返回单条批注和上下文。

#### `reviewer_add_annotation_reply`

参数：

```ts
type AddAnnotationReplyInput = {
  annotationId: string;
  body: string;
};
```

author 默认为：

```ts
{ type: "agent", name: "Codex" }
```

#### `reviewer_update_annotation_body`

参数：

```ts
type UpdateAnnotationBodyInput = {
  annotationId: string;
  body: string;
};
```

用于修正批注文本本身，不用于修改 Markdown 正文。

#### `reviewer_update_annotation_reply`

参数：

```ts
type UpdateAnnotationReplyInput = {
  annotationId: string;
  replyId: string;
  body: string;
};
```

用于修正或润色已有回复。

#### `reviewer_update_annotation_status`

参数：

```ts
type UpdateAnnotationStatusInput = {
  annotationId: string;
  status: "open" | "resolved";
};
```

#### `reviewer_apply_document_edit`

根据明确修改建议更新 Markdown 文档。该工具依赖轻量文档写入能力，可以在批注读取和回复稳定后实现。

### 9.4 MCP 工具说明

工具描述里加入指导：

- 如果已经完整回答提问型批注，可以追加回复，并视情况标记 `resolved`。
- 如果已经按明确修改建议改完正文，可以追加处理说明，并视情况标记 `resolved`。
- 如果仍需用户判断或信息不足，不建议自动标记 `resolved`。
- 如果用户要求重新讨论，可以将批注重新打开为 `open`。

这些指导不作为产品硬规则，只影响 Agent 的工具使用倾向。

### 9.5 MCP 客户端配置示例

以本地构建产物为例：

```json
{
  "mcpServers": {
    "ai-md-reviewer": {
      "command": "node",
      "args": [
        "/Users/zoushangting/Documents/AI协作文档/dist/mcpCli.js",
        "/path/to/document.md"
      ]
    }
  }
}
```

如果项目已经通过 npm link 或全局安装暴露 bin，也可以配置为：

```json
{
  "mcpServers": {
    "ai-md-reviewer": {
      "command": "ai-md-reviewer-mcp",
      "args": ["/path/to/document.md"]
    }
  }
}
```

## 10. 批注驱动修改

本阶段不做完整编辑器，但为修改型批注保留技术路径：

1. Agent 读取批注和上下文。
2. Agent 判断批注是明确修改建议。
3. Agent 调用 `reviewer_apply_document_edit` 或后续轻量编辑工具。
4. 文档写入后，追加回复说明修改结果。
5. Agent 视情况调用 `reviewer_update_annotation_status` 标记 `resolved`。

文档写入建议采用 patch 方式，而不是整文件覆盖：

```ts
type DocumentEditPatch = {
  annotationId?: string;
  description: string;
  before: string;
  after: string;
};
```

第一版可以只支持单段替换，后续再扩展多段 patch。

## 11. 状态同步

P0 可以使用简单轮询或操作后重新拉取：

- 创建批注后更新本地 state。
- 回复后更新本地 state。
- 状态更新后更新本地 state。
- MCP 修改 `.review.json` 后，前端可通过刷新或轮询看到变化。

P1 再考虑轻量轮询：

```text
GET /api/review every 3-5s when window is focused
```

不引入 WebSocket。

## 12. 错误处理

- `.review.json` 不存在：返回空 review。
- JSON 解析失败：前端提示 review 文件损坏，不覆盖原文件。
- 批注 id 不存在：接口返回 404。
- anchor 无法恢复到原文：挂到 heading，并在面板显示“位置可能已变化”。
- MCP 写入失败：返回明确错误，Agent 在回复中说明未能完成。

## 13. 验证方案

### 13.1 本地命令

```bash
npm run typecheck
npm run build
```

### 13.2 手动验收

- 创建一条正文批注。
- 刷新页面后批注仍存在。
- 点击批注跳转到正文。
- 追加一条用户回复。
- 标记为 resolved。
- 重新打开为 open。
- 编辑 Markdown 中被批注段落的前后文本，确认批注仍能定位或挂到 heading。
- 通过 MCP 读取 open 批注。
- 通过 MCP 追加 Agent 回复。
- 通过 MCP 标记 resolved。

### 13.3 建议补充的纯函数测试

批注锚点修复是高风险逻辑，建议对纯函数加测试：

- offset 仍有效。
- offset 失效但 selectedText 可找到。
- selectedText 找不到但 heading 可找到。
- heading 也找不到。
- 跨 block 选区退化。

当前项目还没有测试框架，若进入实现阶段，可以引入 Vitest 专门覆盖 anchor resolve 和 review store。

## 14. 实现顺序

1. 新增 `shared/reviewTypes.ts`。
2. 新增 `server/review.ts`，完成 `.review.json` 读写。
3. 新增 HTTP API：读取 review、创建批注、回复、状态更新。
4. 前端 `useReview` 拉取和更新 review。
5. Markdown block id 插件和 DOM 选区捕获。
6. `AnnotationSelectionToolbar` 和 `AnnotationComposer`。
7. `AnnotationSidebar`、`AnnotationCard`、`AnnotationThread`。
8. `AnnotationLayer` overlay 高亮和点击联动。
9. 前端 anchor resolve 和 heading fallback。
10. 服务端 annotation context 生成。
11. MCP server 和 MCP tools。
12. 批注锚点修复写回。
13. 明确修改型批注的文档 patch 写入能力。
