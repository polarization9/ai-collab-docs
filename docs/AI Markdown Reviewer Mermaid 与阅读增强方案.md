# AI Markdown Reviewer Mermaid 与阅读增强方案

## 1. 背景

第一阶段在基础 Markdown 阅读能力之上，补强了 Mermaid 图表和表格阅读体验。目标不是做完整编辑器，而是先把 AI 生成长文档中最常见的阅读痛点处理掉：

- Mermaid 图太大、太小、颜色不适配、缩放不顺手。
- 工具栏按钮含义不清晰。
- 复制图片和复制源码缺少反馈。
- 表格列宽被浏览器自动算法压窄，中文列容易一字一行。

## 2. 当前已实现 Feature List

### 2.1 Mermaid 稳定渲染

- Mermaid 代码块由 `MermaidBlock` 接管。
- 渲染结果按 `documentId + index + theme + code` 缓存。
- 滚动和目录高亮不会重复触发 Mermaid 渲染。
- 图表区域设置 `overflow-anchor: none`，减少浏览器滚动锚点导致的跳动。
- 渲染失败只在局部显示错误，不影响整页。

### 2.2 正文 Auto Fit

- 自动确保 SVG 有 `viewBox`。
- 移除固定 `width` / `height` 对布局的干扰。
- 设置 `preserveAspectRatio="xMidYMid meet"`。
- 正文内宽图可以在图表容器里横向滚动。

### 2.3 Hover Toolbar

正文图表右上角提供工具栏：

- 打开大图
- 复制源码
- 复制 PNG
- 导出 PNG
- 切换亮色/暗色主题

交互：

- 工具栏默认隐藏，hover 图表时出现。
- 按钮 hover 时显示自绘 tooltip。
- 点击工具栏按钮不触发大图打开。

### 2.4 复制与导出反馈

- 复制源码成功后显示“复制成功”toast。
- 复制 PNG 成功后显示“复制成功”toast。
- 导出 PNG 成功后显示“导出成功”toast。
- toast 固定在视口右上角，lightbox 中也可见。

### 2.5 复制 PNG

- 复制 PNG 替代早期的复制 SVG。
- 复制时从当前 Mermaid SVG rasterize 到 canvas。
- 使用 ClipboardItem promise 写法，降低浏览器因异步处理导致剪贴板写入失败的概率。
- 复制 PNG 背景跟随当前主题：亮色为白底，暗色为深色底。

### 2.6 导出 PNG

- 支持导出当前图表 PNG。
- 导出背景跟随当前主题。
- 对超大图做 canvas 像素保护，避免创建过大 canvas。
- 当前不提供透明 PNG 和 PDF 导出，避免工具栏过重和依赖过重。

### 2.7 主题切换

- 初始主题跟随系统。
- 用户手动点击后只在 `light` / `dark` 间切换。
- 切换主题会重新渲染 Mermaid，实际改变节点、连线、文字颜色。
- 不再提供显式 `auto` 状态。

### 2.8 Lightbox 大图模式

- 点击图表或放大按钮进入大图。
- 大图为 `92vw x 92vh` 左右的阅读弹层。
- 支持遮罩、关闭按钮、`Esc` 关闭。
- 打开/关闭不改变正文滚动位置。

### 2.9 Lightbox 缩放和平移

- 通过修改 SVG `viewBox` 实现缩放和平移。
- 支持：
  - 放大 / 缩小按钮
  - 触控板捏合缩放
  - 普通双指滚动平移
  - 鼠标拖拽平移
  - 双击重置
  - `+` / `-` 缩放
  - 方向键平移
  - `R` / `0` 重置
- 缩放和平移会被限制在图表边界内。

### 2.10 自定义缩放比例

- 大图右下角的缩放比例支持手输。
- 支持范围：`1-999%`。
- 回车或失焦后应用。
- 输入非法值时回退或夹到合法范围。
- 手输缩放以当前视图中心为锚点。

### 2.11 Minimap

- 放大后显示 minimap。
- minimap 显示完整图表缩略图。
- 当前视口以矩形框表示。
- 点击 minimap 可以跳转到对应区域。

### 2.12 右键菜单

图表右键菜单保留常用动作：

- 打开大图
- 复制源码
- 复制 PNG
- 导出 PNG
- 切换主题

### 2.13 表格阅读增强

- Markdown 表格使用 `ResizableTable` 渲染。
- 表格外层支持横向滚动。
- 每列表头右侧提供拖拽手柄。
- 用户可以拖拽调整列宽。
- 默认列宽为 `180px`，最小列宽为 `96px`。
- 支持键盘左右方向键调整列宽。
- 列宽只在当前页面会话内生效。

## 3. 与早期方案相比的调整

### 3.1 不再复制 SVG

用户更需要直接粘贴图片，因此工具栏中“复制 SVG”已改为“复制 PNG”。

### 3.2 不再提供透明 PNG

透明 PNG 先从第一版工具栏移除，避免操作过多。当前保留导出 PNG，背景跟随当前主题。

### 3.3 不再提供 PDF 导出

PDF 导出从当前阶段移除，并移除 `jspdf` 依赖。PDF 可作为后续高级导出能力再考虑。

### 3.4 主题不再三态

早期方案是 `auto / light / dark`。当前实现为：

- 默认跟随系统。
- 用户手动切换只在 `light / dark` 间切换。

这样减少状态复杂度，也更符合阅读场景。

### 3.5 缩放范围扩大

早期方案是 `0.2x-8x`。当前大图模式支持 `1%-999%`，并支持右下角手输。

## 4. 技术实现摘要

### 4.1 Mermaid 目录

```text
src/web/components/mermaid/
├── MermaidBlock.tsx
├── MermaidToolbar.tsx
├── MermaidLightbox.tsx
├── MermaidMinimap.tsx
├── MermaidContextMenu.tsx
├── mermaidRenderCache.ts
├── svgUtils.ts
├── exportUtils.ts
└── types.ts
```

### 4.2 表格组件

```text
src/web/components/ResizableTable.tsx
```

关键机制：

- `colgroup` 控制列宽。
- `table-layout: fixed` 固定列宽分配。
- pointer events 处理拖拽。
- `body.table-column-resizing` 处理拖拽态。

## 5. 当前验收清单

- Mermaid 图表正文渲染稳定。
- 图表 hover 显示工具栏。
- 工具栏 tooltip 任意时刻 hover 都出现。
- 复制源码/复制 PNG 显示 toast。
- 大图模式支持捏合缩放和平移。
- 大图右下角缩放比例可输入 `1-999`。
- 主题切换会改变 Mermaid 内部配色。
- 宽表格出现横向滚动。
- 表头列宽拖拽手柄存在且可调整列宽。

## 6. 后续可做

- 表格列宽持久化到 localStorage。
- 表格双击列边界自适应内容宽度。
- Mermaid 多图上一张 / 下一张切换。
- 复制 PNG 的浏览器权限状态提示优化。
- 批注模式下将图表、表格和正文统一纳入可批注范围。
