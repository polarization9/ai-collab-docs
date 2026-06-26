# Margent 就地批注 Popover 定位优化方案

## 1. 背景

Margent 已经支持点击正文高亮区域，在原文附近打开单条批注会话 popover。这个交互适合深入阅读：用户不需要切到右侧批注列表，可以围绕某个文本片段直接查看、追问、投递给 Agent。

当前问题是：popover 的位置有时会压到窗口边缘或被顶部 tab 栏遮挡。典型场景是用户点击靠近顶部或靠近左侧的高亮区域时，popover 仍然尝试以高亮区域为中心上下展开，最后只能做简单边界裁剪，导致视觉上不稳定。

本方案只讨论 popover 定位策略，不包含批注内容、Agent 投递、滚动隔离等其他改动。

## 2. 当前实现

相关文件：

- `src/web/components/annotations/AnnotationLayer.tsx`
- `src/web/components/annotations/AnnotationThreadPopover.tsx`
- `src/web/components/annotations/AnnotationWorkspace.tsx`
- `src/web/styles.css`

当前链路：

1. 用户点击高亮区域或 pending / failed marker。
2. `AnnotationLayer` 用被点击元素的 `getBoundingClientRect()` 作为 `anchorRect`。
3. `AnnotationWorkspace` 保存 `threadPopover.anchorRect`。
4. `AnnotationThreadPopover` 调用 `getPopoverPosition(anchorRect, popoverSize)` 计算 `top / left / maxHeight`。
5. popover 使用 `position: fixed`，坐标直接相对 viewport。

当前 `getPopoverPosition` 的核心逻辑：

- 默认宽度约 420px。
- 优先判断放在 anchor 下方还是上方。
- 横向以 anchor 中心对齐。
- 如果超出窗口右侧或底部，就把 `left / top` clamp 回 viewport 内。

这个实现简单，但它只有“上 / 下”两个主要位置，没有把“右侧稍微往下”“左侧稍微往下”这类阅读场景考虑进去。

## 3. 本质问题

这不是单纯的 CSS 溢出问题，而是定位模型太单一。

当前算法假设：

- popover 应该围绕 anchor 水平居中；
- 放上方或下方就够了；
- 最后用 clamp 处理越界。

但真实阅读场景里，anchor 可能出现在：

- 顶部 tab 栏附近；
- 视口左侧或右侧；
- 长段落的末尾；
- 多行高亮的某个局部片段；
- 滚动容器内部，而 popover 是 `fixed`；
- popover 内容很长，需要内部滚动。

在这些场景下，简单 clamp 会产生两个问题：

- popover 虽然没有完全出界，但视觉上离 anchor 的关系变弱。
- popover 可能被推到不自然的位置，比如贴到顶部、压住 tab 栏、遮挡太多正文。

## 4. 目标

第一版目标：

- popover 不超出可视窗口。
- popover 不压到顶部 tab / app chrome 区域。
- 优先出现在用户点击高亮附近，保持“就地讨论”的感觉。
- 靠近顶部时，优先向右下或左下展开，而不是硬贴顶部。
- 靠近左侧时，可以自然放在右侧；靠近右侧时，可以自然放在左侧。
- 内容很长时，popover 自身滚动，位置仍然稳定。
- 多条批注重叠时，切换 `1/2` 不造成明显跳动。

非目标：

- 不做拖拽浮窗。
- 不做吸附动画。
- 不做全局批注面板重构。
- 不改变当前点击高亮打开 popover 的交互。

## 5. 设计原则

### 5.1 先选位置，再做裁剪

不要先用一种固定位置，然后靠 clamp 把它塞回窗口。

应该先生成多个候选位置，对每个候选位置计算可见性、距离、遮挡风险，再选择最合适的位置。clamp 只作为最后的微调，不作为主要定位策略。

### 5.2 以被点击区域为锚点

继续使用当前点击到的 DOMRect 作为 anchor，而不是整条批注的第一个 rect。

这个点已经在当前实现里基本正确：用户点击哪一段高亮，popover 就应该围绕哪一段出现。后续定位优化要保留这个原则。

### 5.3 顶部安全区要显式建模

当前只用统一 `padding = 14`。但 macOS 桌面 App 顶部有 tab 栏和工具栏，popover 不应该进入这个区域。

建议定义 viewport safe area：

```ts
type PopoverViewport = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
```

其中：

- `left = 14`
- `right = window.innerWidth - 14`
- `bottom = window.innerHeight - 14`
- `top` 不固定写死，优先从页面结构测量，例如 tab/content 容器顶部；如果取不到，再 fallback 到 72px 左右的保守值。

### 5.4 优先保持阅读连续性

对于正文阅读，popover 不一定要严格居中。很多情况下，放在 anchor 右侧稍微往下的位置更自然，因为：

- 不挡住被点击的文字前半段；
- 鼠标/视线从高亮右上角进入 popover 更顺；
- 靠近顶部时不容易顶到 tab 栏。

因此候选位置优先级可以从“上下”调整为“侧向优先，侧向不可用再上下”。

## 6. 推荐定位策略

### 6.1 候选位置

基于 anchorRect 生成候选位置：

1. `right-start`
   - popover 左上角在 anchor 右侧。
   - top 与 anchor top 对齐，或略向下偏移。
   - 适合大多数靠左 / 中部文本。

2. `right-lower`
   - popover 左上角在 anchor 右侧，并比 anchor top 稍微低一些。
   - 适合靠近顶部的文本，避免压到 tab 栏。

3. `left-start`
   - popover 右侧贴近 anchor 左侧。
   - 适合 anchor 靠右时。

4. `left-lower`
   - popover 在 anchor 左侧，并略向下。
   - 适合 anchor 靠右且靠近顶部时。

5. `below-center`
   - popover 在 anchor 下方，水平居中。
   - 适合侧边空间不足但下方空间足够时。

6. `above-center`
   - popover 在 anchor 上方，水平居中。
   - 适合 anchor 靠近底部时。

7. `viewport-fallback`
   - 以上都不理想时，放在安全 viewport 内最接近 anchor 的位置。
   - 这是兜底，不是主路径。

### 6.2 候选打分

每个候选位置计算一个 score，选择最高分。

建议分数由这些因素组成：

- 是否完全在 safe viewport 内。
- 可用高度是否足够。
- 与 anchor 的距离是否短。
- 是否遮挡 anchor 本身。
- 是否贴近顶部安全区。
- 是否需要大幅 clamp。

伪代码：

```ts
function scoreCandidate(candidate) {
  let score = 0;

  if (candidate.fitsWidth) score += 40;
  if (candidate.fitsHeight) score += 40;
  if (!candidate.overlapsAnchor) score += 20;

  score -= candidate.clampDistance * 0.5;
  score -= candidate.anchorDistance * 0.1;

  if (candidate.placement === "right-lower") score += 8;
  if (candidate.placement === "right-start") score += 6;
  if (candidate.placement === "below-center") score += 2;

  return score;
}
```

这里的“打分”不是复杂模型，只是把现在隐含的定位偏好显式化，避免后续继续用点状 if 修问题。

### 6.3 宽高计算

当前 CSS 宽度：

```css
width: min(420px, calc(100vw - 28px));
max-height: min(520px, calc(100vh - 28px));
```

建议继续保留视觉宽度，不做大改。

JS 侧计算时：

- 使用实际 `popoverRef.getBoundingClientRect()` 获取已渲染尺寸。
- 首次渲染没有尺寸时，用默认宽度和默认高度估计。
- `maxHeight` 根据最终 placement 的可用空间计算。
- `maxHeight` 不低于一个可用下限，例如 220px；如果 viewport 太小，再按 safe viewport 压缩。

### 6.4 顶部安全区

需要避免 popover 顶部进入 tab 栏区域。

建议第一版做一个轻量方法：

```ts
function getPopoverSafeViewport(): PopoverViewport {
  const padding = 14;
  const appTop =
    document.querySelector(".app-tabs")?.getBoundingClientRect().bottom ??
    document.querySelector(".workspace-tabs")?.getBoundingClientRect().bottom ??
    72;

  return {
    left: padding,
    top: Math.max(padding, appTop + 8),
    right: window.innerWidth - padding,
    bottom: window.innerHeight - padding
  };
}
```

实际 class name 要以当前 DOM 为准，不在方案阶段硬编码最终名字。

如果取不到顶部容器，就 fallback 到当前 padding 或一个保守顶部值。这里属于低风险兜底，因为顶部遮挡是明确问题。

### 6.5 推荐第一版优先级

第一版不需要做太复杂。

推荐策略：

1. 计算 safe viewport。
2. 生成 6 个主要候选位置。
3. 对候选位置做 clamp，记录 clamp 距离。
4. 打分选择最优。
5. 设置 `top / left / maxHeight`。

这样可以覆盖绝大多数问题，同时不会引入拖拽、动画、门户层级等额外复杂度。

## 7. 具体改造点

### 7.1 `AnnotationThreadPopover.tsx`

改造 `getPopoverPosition`：

- 输入增加 safe viewport。
- 内部生成候选 placement。
- 返回结果增加 placement，便于调试。

建议类型：

```ts
type PopoverPlacement =
  | "right-start"
  | "right-lower"
  | "left-start"
  | "left-lower"
  | "below-center"
  | "above-center"
  | "viewport-fallback";

type PopoverPosition = {
  top: number;
  left: number;
  maxHeight: number;
  placement: PopoverPlacement;
};
```

`placement` 暂时可以不渲染，只用于调试和测试。

### 7.2 `AnnotationWorkspace.tsx`

当前 `threadPopover.anchorRect` 已经是 viewport 坐标，且 popover 是 fixed，坐标系一致。

暂时不需要改状态结构，除非后续希望记录点击来源，例如 highlight / marker。

### 7.3 CSS

第一版不需要大改 CSS。

可以保留：

```css
.annotation-thread-popover {
  position: fixed;
  width: min(420px, calc(100vw - 28px));
  max-height: min(520px, calc(100vh - 28px));
}
```

如果实际测试发现顶部 safe area 仍不稳定，再考虑把 popover 放到专门的 overlay root，但第一版不建议扩大范围。

## 8. 验收标准

### 8.1 基础定位

- 点击正文中部高亮，popover 出现在高亮附近。
- 点击靠左高亮，popover 优先出现在右侧。
- 点击靠右高亮，popover 优先出现在左侧。
- 点击靠顶部高亮，popover 不进入顶部 tab / toolbar 区域。
- 点击靠底部高亮，popover 不超出底部。

### 8.2 长内容

- 批注回复很多时，popover 高度受限，内部滚动。
- popover 不因为内容变长突然跳到很远的位置。
- 新回复出现后，内部滚动到底部，但外部文档位置不跳动。

### 8.3 重叠批注

- 多条批注重叠时，点击高亮打开 popover，`1/2` 切换保持在同一附近位置。
- 切换批注不因为不同内容高度产生明显跳动。

### 8.4 窗口变化

- 调整窗口宽度后，popover 重新定位且不出界。
- 文档滚动时，popover 跟随 anchorRect 更新，不残留在错误位置。

## 9. 测试建议

手动测试文档准备：

- 顶部第一屏有一段可批注文本。
- 左侧、右侧、中间各有一段可批注文本。
- 底部靠近窗口下边缘有一段可批注文本。
- 一条批注包含多条回复，足以让 popover 内部滚动。
- 两条批注有重叠高亮。

建议 viewport：

- 桌面宽屏。
- 窄窗口。
- 高度较小的窗口。

自动化测试可以后补：

- 单元测试 `getPopoverPosition` 的候选选择。
- 用固定 anchorRect + viewport 模拟边界场景。
- 验证返回 top / left 落在 safe viewport 内。

## 10. 风险

### 10.1 位置变化太明显

如果定位策略从“上下居中”改为“侧向优先”，用户可能感觉 popover 的出现方式变了。

解决方式：

- 保持距离 anchor 很近。
- 不做动画。
- 不让 popover 在同一条批注状态变化时频繁跳位置。

### 10.2 内容高度变化导致跳动

回复增加、状态变更、错误提示出现时，popover 实际高度会变。

解决方式：

- 使用 measured size 重新计算，但优先保持当前 placement。
- 只有当前 placement 明显越界时才切换 placement。

### 10.3 顶部安全区取值不准

如果 DOM class 变化或顶部栏高度不同，safe top 可能不准。

解决方式：

- 第一版通过查询真实 DOM 获取 top。
- 查询失败时使用保守 fallback。
- 验收时覆盖 dev server 和打包 App。

## 11. 建议实施顺序

1. 把 `getPopoverPosition` 拆成纯函数，支持传入 viewport、anchorRect、popoverSize。
2. 增加候选 placement 生成和打分。
3. 接入顶部 safe viewport。
4. 保留现有视觉样式，只替换定位计算。
5. 手动测试边界场景。
6. 如果定位稳定，再考虑补单元测试。

## 12. 第一版结论

这次不应该继续给当前 `getPopoverPosition` 增加零散 if。

更合适的改法是把定位从“上下二选一 + clamp”升级为“候选位置 + safe viewport + 简单打分”。这样能系统性解决顶部、左右边界、长内容和重叠批注场景，同时保持实现规模可控。
