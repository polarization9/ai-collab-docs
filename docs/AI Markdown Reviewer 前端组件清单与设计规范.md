# AI Markdown Reviewer 前端组件清单与设计规范

## 1. 设计定位

AI Markdown Reviewer 是一个本地 Markdown 审阅与 AI 协作工具，不是营销站，也不是重型编辑器。

核心调性：

- **文档优先**：正文永远是视觉主角，工具只在需要时出现。
- **安静专业**：像一款给长期阅读、反复审阅、和 Agent 协作使用的工作台。
- **轻量可信**：状态、批注、复制、导出等操作必须明确，但不喧宾夺主。
- **结构稳定**：批注侧栏、Mermaid 大图、表格列宽、代码块按钮都不能引起布局跳动。
- **适度精致**：保留高级感来自排版、间距、对齐和微交互，不依赖大面积装饰。

Taste skill 取舍：

- 采用 taste skill 的高标准排版、间距、组件一致性和交互反馈。
- 不采用营销页 AIDA、Hero、Bento、重 GSAP 动效，因为它们不符合本产品“文档工具”的使用场景。
- 动效只保留工具型 micro-interaction，时长控制在 120-180ms。

## 2. 当前前端组件清单

### 2.1 应用框架层

| 组件 | 路径 | 责任 | 当前状态 |
| --- | --- | --- | --- |
| `App` | `src/web/App.tsx` | 加载文档、维护 active heading、组织 TOC 与文档面板 | 已实现 |
| `Toc` | `src/web/components/Toc.tsx` | 左侧目录，按 heading 层级展示并支持跳转 | 已实现 |
| `AnnotationWorkspace` | `src/web/components/annotations/AnnotationWorkspace.tsx` | 批注功能总容器，管理选区、侧栏开关、批注 overlay | 已实现 |
| `DocumentViewer` | `src/web/components/DocumentViewer.tsx` | Markdown 渲染入口，给段落、标题、代码、表格、Mermaid 注入 review block metadata | 已实现 |

### 2.2 文档阅读组件

| 组件 | 路径 | 责任 | 当前状态 |
| --- | --- | --- | --- |
| `CodeBlock` | `src/web/components/CodeBlock.tsx` | fenced code 渲染、复制代码、代码工具条 | 已实现 |
| `ResizableTable` | `src/web/components/ResizableTable.tsx` | 表格横向滚动、列宽拖拽 | 已实现 |
| `DocumentViewer` 内部 heading component | `src/web/components/DocumentViewer.tsx` | 将 Markdown heading 转为带 id 与 review metadata 的 DOM | 已实现 |

### 2.3 批注组件

| 组件 | 路径 | 责任 | 当前状态 |
| --- | --- | --- | --- |
| `AnnotationLayer` | `src/web/components/annotations/AnnotationLayer.tsx` | 根据批注锚点在正文上绘制 overlay 高亮 | 已实现 |
| `AnnotationSelectionToolbar` | `src/web/components/annotations/AnnotationSelectionToolbar.tsx` | 选中文本后显示批注入口图标与批注输入弹窗 | 已实现 |
| `AnnotationSidebar` | `src/web/components/annotations/AnnotationSidebar.tsx` | 右侧批注列表、筛选、卡片状态操作 | 已实现 |

### 2.4 Mermaid 组件

| 组件 | 路径 | 责任 | 当前状态 |
| --- | --- | --- | --- |
| `MermaidBlock` | `src/web/components/mermaid/MermaidBlock.tsx` | Mermaid 渲染、图片/源码切换、主题、导出、复制、lightbox 入口 | 已实现 |
| `MermaidToolbar` | `src/web/components/mermaid/MermaidToolbar.tsx` | Mermaid 图内右上角工具栏 | 已实现 |
| `MermaidContextMenu` | `src/web/components/mermaid/MermaidContextMenu.tsx` | Mermaid 右键菜单 | 已实现 |
| `MermaidLightbox` | `src/web/components/mermaid/MermaidLightbox.tsx` | Mermaid 大图查看、缩放、拖拽、键盘操作、复制/导出 | 已实现 |
| `MermaidMinimap` | `src/web/components/mermaid/MermaidMinimap.tsx` | 大图模式缩略导航 | 已实现 |

### 2.5 非 UI 但影响前端体验的模块

| 模块 | 路径 | 责任 |
| --- | --- | --- |
| `useReview` | `src/web/hooks/useReview.ts` | 前端批注数据读取、创建、回复、状态更新 |
| `anchorCapture` | `src/web/review/anchorCapture.ts` | 捕获用户选区并生成 review anchor |
| `anchorResolve` | `src/web/review/anchorResolve.ts` | 将 review anchor 还原为 DOM range 或 block |
| `mermaidRenderCache` | `src/web/components/mermaid/mermaidRenderCache.ts` | Mermaid SVG 缓存 |
| `svgUtils` | `src/web/components/mermaid/svgUtils.ts` | SVG 清洗、导出适配、foreignObject 转换 |
| `exportUtils` | `src/web/components/mermaid/exportUtils.ts` | Mermaid PNG 复制与导出 |
| `clipboard` | `src/web/utils/clipboard.ts` | 通用文本复制 |

### 2.6 内部小组件

| 组件 | 所属文件 | 用途 |
| --- | --- | --- |
| `CodeBlockButton` | `CodeBlock.tsx` | 代码块图标按钮 |
| `FilterButton` | `AnnotationSidebar.tsx` | 批注筛选 segmented control |
| `ToolbarButton` | `MermaidToolbar.tsx` | Mermaid 图内工具按钮 |
| `MenuButton` | `MermaidContextMenu.tsx` | Mermaid 右键菜单项 |
| `IconButton` | `MermaidLightbox.tsx` | 大图模式工具按钮 |

## 3. 设计原则

### 3.1 文档为第一层，工具为第二层

正文内容区域优先级最高。所有工具控件遵循：

- 默认不打断阅读。
- 只在相关区域附近出现。
- 工具条和按钮不遮挡主要内容。
- 浮层必须能快速关闭，不能占据长期注意力。

### 3.2 控件不解释自己

界面中不放大段说明文字来解释功能。功能通过熟悉图标、tooltip、状态文案表达。

例外：

- 空状态可以有一句短提示。
- 错误状态可以直接展示可读错误。

### 3.3 状态必须比装饰更明显

批注 `open / resolved`、Mermaid `image / source`、主题 `light / dark`、缩放比例、复制成功，都属于状态信息。

状态表达优先级：

1. 位置稳定。
2. 文案短。
3. 图标辅助。
4. 颜色只作为第二信号。

## 4. 视觉 Tokens

### 4.1 字体

推荐目标字体：

```css
font-family: Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

说明：

- 后续如引入字体资产，优先使用 `Geist`，更适合工具型产品。
- 当前可继续使用系统 sans fallback，不为字体额外引入网络依赖。
- 正文不使用负 letter-spacing。

### 4.2 字号

| 场景 | 字号 | 行高 |
| --- | --- | --- |
| 正文 | 16px | 1.72 |
| H1 | 38px | 1.15 |
| H2 | 28px | 1.25 |
| H3 | 22px | 1.3 |
| 侧栏标题 | 18px | 1.2 |
| 卡片正文 | 13px | 1.45 |
| 元信息 | 12-13px | 1.4 |
| 图标按钮 tooltip | 12px | 1 |

### 4.3 色彩

| Token | 用途 | 颜色 |
| --- | --- | --- |
| `page-bg` | 页面背景 | `#f5f7f6` |
| `panel-bg` | 面板背景 | `#fbfdfc` |
| `surface-bg` | 卡片/正文表面 | `#ffffff` |
| `soft-bg` | 轻提示/分段控件底 | `#e8eeee` |
| `text-primary` | 主文本 | `#1f2926` |
| `text-secondary` | 次文本 | `#61716b` |
| `border` | 常规边框 | `#d5ddda` |
| `border-strong` | hover/focus 边框 | `#8fb6aa` |
| `accent` | 主要操作 | `#0d766e` |
| `accent-soft` | 主要操作浅底 | `#d8ebe6` |
| `open-bg` | 未解决状态 | `#fff2d7` |
| `open-text` | 未解决状态文字 | `#79531c` |
| `resolved-bg` | 已解决状态 | `#e3f1ec` |
| `resolved-text` | 已解决状态文字 | `#2e6b57` |
| `code-bg` | 代码块底 | `#202724` |

色彩约束：

- 页面不能大面积单一绿色。绿色只做操作和状态辅助。
- 批注 open 用暖黄色，resolved 用绿色，避免所有状态都落在同一色相。
- 深色只用于代码块、Mermaid 暗色、大图遮罩。

### 4.4 圆角

| 元素 | 圆角 |
| --- | --- |
| 主要卡片、表格、弹窗、侧栏 | 8px |
| 小按钮、输入框、菜单项 | 5-7px |
| 状态 badge、圆形入口 | 999px |

原则：卡片不超过 8px，避免 SaaS 工具被做成“软糖感”。

### 4.5 阴影

阴影只用于浮层：

- 批注弹窗：`0 18px 54px rgba(20, 30, 26, 0.2)`
- 图标入口：`0 10px 30px rgba(20, 30, 26, 0.14)`
- Mermaid / context menu / toast：同一阴影族

正文卡片默认不使用重阴影，只用边框表达层级。

## 5. 布局规范

### 5.1 主框架

```text
App
├── Toc: 268px sticky left rail
└── DocumentPane
    └── ReviewLayout
        ├── DocumentColumn: max 920px
        └── AnnotationSidebar: 340px
```

关键尺寸：

- TOC 宽度：268px。
- 文档列最大宽度：920px。
- 批注侧栏宽度：340px。
- 文档 + 侧栏最大宽度：1288px。
- 文档与侧栏间距：28px。

侧栏关闭时：

- 文档列居中。
- 顶部文件路径与正文同列居中。

侧栏打开时：

- 文档列与顶部文件路径一起向左移动。
- 侧栏出现在右侧，不覆盖正文。

### 5.2 移动端

断点：`860px`。

移动端规则：

- TOC 变为顶部块，不 sticky 全屏。
- 文档面板左右 padding 降为 18px。
- 批注侧栏变为正文下方块。
- 固定批注入口放右上角 14px。

## 6. 组件规范

### 6.1 `Toc`

用途：长文档导航，不承担品牌展示。

规范：

- 左侧浅灰绿色面板。
- 标题用小写或短词，不做大标题。
- active item 用浅强调色，不使用粗重背景。
- 多级 heading 通过 padding 表达层级。
- item 文本允许换行，避免横向滚动。

禁用：

- 不加图标。
- 不显示段落计数。
- 不做卡片化 TOC。

### 6.2 `DocumentViewer`

用途：Markdown 正文阅读。

规范：

- 正文保持 16px / 1.72。
- 标题间距清楚，但不要 hero 化。
- blockquote 是轻背景 + 左边线。
- inline code 用浅底，小圆角。
- fenced code 走 `CodeBlock`，不裸露原始 `<pre>`。

### 6.3 `CodeBlock`

用途：代码阅读和复制。

规范：

- 深色代码底，和文档浅色底形成稳定区分。
- 右上角固定工具条，按钮 30x30。
- 复制成功反馈短暂出现，1.4s 内消失。
- 工具条不能遮挡行尾，所以代码块右侧保留 82px padding。
- Mermaid 源码视图复用同一组件，额外加“切回图片”按钮。

### 6.4 `ResizableTable`

用途：阅读宽表和调整列宽。

规范：

- 表格外层必须有横向滚动容器。
- 默认列宽不追求压进屏幕，优先保证单元格可读。
- resize handle 宽度小，但 hover/focus 反馈要明显。
- 表头浅底，和正文行区分。
- 拖拽时 body 加 `table-column-resizing`，防止选中文字。

### 6.5 `AnnotationWorkspace`

用途：批注系统总控。

规范：

- 批注入口是右上角固定小图标。
- 侧栏默认关闭。
- 文档列和顶部路径在侧栏打开时一起移动。
- `review-document-surface` 是 overlay 定位基准，不额外加卡片壳。

### 6.6 `AnnotationSelectionToolbar`

用途：从选中文本创建批注。

规范：

- 第一步只出现圆形批注图标，不直接弹大输入框。
- 点击图标后，输入框出现在选区最后一个字符下方。
- 弹窗左侧与选区末尾右侧对齐；靠近视口边缘时收束。
- 输入框 placeholder 短句即可。

禁用：

- 不在选中文本上方遮挡内容。
- 不常驻大浮窗。

### 6.7 `AnnotationLayer`

用途：正文批注高亮。

规范：

- open 批注高亮使用暖黄色。
- resolved 批注高亮使用低饱和绿色。
- hover/selected 使用 outline，避免改变布局。
- overlay 不修改 Markdown DOM 结构。

### 6.8 `AnnotationSidebar`

用途：批注列表和状态管理。

规范：

- 默认筛选为 `全部`。
- 分段控件顺序：未解决 / 已解决 / 全部。
- 只展示卡片列表，不展示下方选中详情区。
- 每张卡片右上角有状态图标按钮：
  - open -> 标记已解决。
  - resolved -> 重新打开。
- 点击卡片主体用于定位正文批注。
- 卡片常态只展示：状态 badge、批注正文、回复数和更新时间。
- 卡片底部保留轻量操作：回复、编辑。
- 选中卡片时才展开回复线程、回复输入框和内联编辑框。
- 批注正文和回复内容都支持 textarea 轻量编辑。

禁用：

- 不在侧栏底部做详情镜像。
- 不在未选中卡片里展开长回复线程。
- 不在卡片内放文字型大按钮。

### 6.9 `MermaidBlock`

用途：Mermaid 图阅读、源码阅读、复制导出。

规范：

- 默认显示图，不默认源码。
- 右上角工具栏 hover 出现，focus 保持出现。
- 工具顺序建议：
  1. 打开大图
  2. 查看源码
  3. 复制源码
  4. 复制 PNG
  5. 导出 PNG
  6. 切换明暗
- 源码模式复用 `CodeBlock`：
  - 复制代码。
  - 切回图片。
  - 支持选中文字创建批注。
- 图块 hover 只加轻边框和轻 outline，不加重阴影。

### 6.10 `MermaidLightbox`

用途：大图阅读和局部查看。

规范：

- 全屏深遮罩。
- 顶部工具条固定，按钮统一 30x30。
- 右下角缩放比例可读可输入。
- minimap 放左下或右下固定区域，不能遮挡核心图。
- 支持双指 pinch 仅缩放图，不缩放页面。
- 平移、缩放、重置要稳定，不闪动。

### 6.11 `MermaidContextMenu`

用途：右键快速操作。

规范：

- 宽度约 220px。
- 菜单项左图标右文字。
- 只放 Mermaid 相关操作，不混入批注操作。
- Escape 和外部点击关闭。

## 7. 交互规范

### 7.1 图标按钮

所有工具型操作优先图标按钮：

- 复制：`ClipboardCopy`
- 大图：`Maximize2`
- 源码：`Code2`
- 图片：`Image`
- PNG：`FileImage`
- 状态 open/resolved：`CircleDot` / `CheckCircle2`
- 重新打开：`RotateCcw`

按钮规范：

- 小按钮 28-30px。
- 入口按钮 34-36px。
- 必须有 `aria-label`。
- 不熟悉的图标必须有 tooltip 或 title。

### 7.2 Tooltip

规范：

- 12px，深底浅字。
- hover 和 focus-visible 都出现。
- 不依赖点击后才出现。
- 不挡住按钮本体。

### 7.3 Toast / Feedback

规范：

- 只用于复制、导出等瞬时结果。
- 文案短：复制成功 / 导出成功。
- 1.4-1.6s 自动消失。
- 错误直接显示 error message。

### 7.4 Motion

工具型产品不做戏剧化动效。

允许：

- hover 背景 120ms。
- tooltip 轻微 translate + opacity。
- 弹窗出现无需复杂动画。
- 大图拖拽、缩放是功能运动，不是装饰动效。

不建议：

- GSAP scroll pinning。
- 大面积 parallax。
- 装饰性背景动效。
- 卡片堆叠动效。

## 8. 文案规范

### 8.1 语言

- 中文为主，英文只用于产品内部固定词或技术名词。
- 文案尽量短，像工具，不像宣传。

### 8.2 状态文案

| 状态 | 文案 |
| --- | --- |
| open | 未解决 |
| resolved | 已解决 |
| mark resolved | 标记已解决 |
| reopen | 重新打开 |
| copy success | 复制成功 |
| export success | 导出成功 |

### 8.3 禁用文案

- 不写“只需三步开始高效协作”这类营销句。
- 不写“智能赋能你的文档工作流”这类泛化口号。
- 不在界面里解释快捷键或功能列表。

## 9. 可访问性规范

- 所有 icon-only button 必须有 `aria-label`。
- 可交互控件必须有 `focus-visible` 状态。
- 颜色不能是唯一状态信息，状态 badge 必须有文字。
- 按钮最小点击区域 28px，主要浮动入口 34px 以上。
- 键盘可关闭的浮层必须支持 Escape。

## 10. 后续设计债务

优先级从高到低：

1. 把颜色、间距、圆角抽成 CSS custom properties。
2. 抽通用 `IconButton`，统一 Mermaid、代码块、批注侧栏按钮。
3. 抽通用 `SegmentedControl`，统一批注筛选。
4. 抽通用 `StatusBadge`，统一 open/resolved。
5. 为 `CodeBlock` 和 `MermaidToolbar` 建立统一 tooltip 组件。
6. 在真实宽表、长 Mermaid、长批注列表中做视觉回归截图。

## 11. 质量检查清单

每次改前端时检查：

- 正文列是否仍为视觉主角。
- 批注侧栏打开时顶部路径和正文是否一起移动。
- 所有 icon-only button 是否有 `aria-label`。
- 代码块按钮是否遮挡行尾。
- Mermaid 图片/源码切换是否保留批注能力。
- 表格列宽是否稳定，不因 hover 变化。
- 移动端是否无横向溢出。
- 页面是否没有多余营销式说明文案。
