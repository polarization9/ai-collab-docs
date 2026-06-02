# AI Markdown Reviewer 第一阶段技术方案

## 1. 技术目标

第一阶段实现一个可通过 CLI 启动的本地 Web App。用户传入 Markdown 文件路径后，系统读取文件并在浏览器中展示 Markdown / Mermaid 阅读页面。

当前实现已覆盖：

- CLI 启动本地服务
- 服务端读取 Markdown 文件并解析 heading
- 前端渲染 Markdown、目录、代码块、表格和 Mermaid
- Mermaid 大图阅读、缩放、平移、minimap、主题切换、复制和导出
- 表格横向滚动与拖拽列宽

## 2. 技术栈

- Runtime：Node.js 20+
- 语言：TypeScript
- CLI：Node.js executable script
- 本地服务：Express
- 前端框架：React
- 前端构建：Vite
- Markdown 渲染：react-markdown
- GFM 支持：remark-gfm
- Mermaid 渲染：mermaid
- Heading id：github-slugger
- 图标：lucide-react

已移除 PDF 导出相关依赖，当前不再引入 `jspdf`。

## 3. 工程结构

```text
src/
├── cli.ts
├── server/
│   ├── index.ts
│   ├── document.ts
│   └── paths.ts
├── shared/
│   └── types.ts
└── web/
    ├── main.tsx
    ├── App.tsx
    ├── api.ts
    ├── components/
    │   ├── DocumentViewer.tsx
    │   ├── ResizableTable.tsx
    │   ├── Toc.tsx
    │   └── mermaid/
    │       ├── MermaidBlock.tsx
    │       ├── MermaidToolbar.tsx
    │       ├── MermaidLightbox.tsx
    │       ├── MermaidMinimap.tsx
    │       ├── MermaidContextMenu.tsx
    │       ├── mermaidRenderCache.ts
    │       ├── exportUtils.ts
    │       ├── svgUtils.ts
    │       └── types.ts
    └── styles.css
```

## 4. 服务端接口

### GET `/health`

用于确认服务启动。

```json
{ "ok": true }
```

### GET `/api/document`

返回当前打开的文档数据。

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

## 5. Markdown 渲染

`DocumentViewer` 使用 `react-markdown` + `remark-gfm`。

自定义组件：

- heading：按服务端 headings 顺序挂载稳定 id。
- pre/code：识别 `language-mermaid`，交给 `MermaidBlock`。
- table：交给 `ResizableTable`，支持横向滚动和列宽拖拽。
- a：外链新窗口打开。

## 6. Mermaid 模块

### 6.1 MermaidBlock

职责：

- 接收 Mermaid 源码、documentId 和图表序号。
- 根据 `documentId + index + theme + code` 缓存 SVG。
- 控制主题状态、lightbox 状态、右键菜单和反馈 toast。
- 提供复制源码、复制 PNG、导出 PNG、切换主题等 action。

主题策略：

- 初始值跟随系统 `prefers-color-scheme`。
- 用户手动点击后只在 `light` / `dark` 间切换。
- 切换主题会重新初始化 Mermaid 并重新渲染 SVG，使节点、连线、文字颜色都变化。

### 6.2 MermaidLightbox

职责：

- 使用 portal 挂载遮罩和大图 dialog。
- 复制当前 SVG 字符串进入 lightbox，不重新解析 Markdown。
- 通过修改 SVG `viewBox` 实现缩放和平移。
- 支持 minimap、键盘操作、触控板捏合、拖拽平移。

缩放范围：

```ts
const MIN_ZOOM = 0.01; // 1%
const MAX_ZOOM = 9.99; // 999%
```

右下角缩放输入：

- inputMode 为 numeric。
- 只接受数字。
- 最大三位。
- 提交时 clamp 到 `1-999`。
- 以当前视图中心为锚点应用缩放。

### 6.3 Mermaid 缩放与触控板

- 捏合缩放在浏览器中通常表现为 `ctrl/meta + wheel`。
- lightbox 在遮罩层 capture 阶段注册原生 `wheel` listener，并使用 `passive: false`。
- 捏合事件被阻止冒泡，避免触发浏览器页面缩放。
- 普通双指滚动在已放大时用于平移。

### 6.4 Mermaid 导出与复制

`exportUtils.ts` 提供：

- `copyMermaidSource`
- `copyPng`
- `downloadPng`
- `rasterizeSvgToCanvas`

复制 PNG 使用 ClipboardItem promise 写法：

```ts
const pngBlob = rasterizeSvgToCanvas(...).then(...);
await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
```

这样可以更好地保留用户点击带来的剪贴板写入权限。

## 7. 表格模块

### 7.1 ResizableTable

职责：

- 包裹 Markdown 表格。
- 生成 `colgroup` 和每列 `col`。
- 默认列宽：`180px`。
- 最小列宽：`96px`。
- 通过 `table-layout: fixed` 让列宽可控。
- 表头每列右侧添加 `table-resize-handle`。

拖拽实现：

- `pointerdown` 记录列 index、起始 X 和起始宽度。
- 全局监听 `pointermove` 更新列宽。
- `pointerup` 清除拖拽状态。
- 拖拽时给 `body` 添加 `table-column-resizing`，禁用文本选择并显示 col-resize 光标。

键盘支持：

- 手柄可 focus。
- 左右方向键以 `24px` 为步长调整列宽。

### 7.2 表格滚动

表格外层 `.table-scroll` 保持 `overflow-x: auto`。

当列总宽度大于阅读区时，表格在容器内横向滚动，不导致整页横向滚动。

## 8. 样式要点

- 文档内容最大宽度保持阅读友好。
- 表格、代码块、Mermaid 图都有边界和背景。
- Mermaid 工具栏默认隐藏，hover 图表时显示。
- 工具栏 tooltip 使用 CSS `::after` + `data-tooltip` 自绘，不依赖原生 `title`。
- 复制/导出反馈 toast 固定在视口右上角，避免被 lightbox 遮挡。

## 9. 构建与验证

常用命令：

```bash
npm run typecheck
npm run build
```

当前验证项：

- TypeScript 类型检查通过。
- Vite Web 构建通过。
- Server 构建通过。
- `/health` 返回 `{ "ok": true }`。
- 浏览器检查到表格被渲染为 `resizable-table`，并生成列宽拖拽手柄。

## 10. 后续技术预留

- 批注面板与 `.review.json`。
- MCP server 暴露文档读取、批注读取和批注回复能力。
- 表格列宽 localStorage 持久化。
- 轻量 Markdown 编辑。
- 多文档管理。
