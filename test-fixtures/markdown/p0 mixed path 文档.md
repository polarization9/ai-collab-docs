# P0 Fixture 文档

## 阅读能力

这是一份包含中文路径、空格路径和常见 Markdown 结构的 fixture。

> 引用块用于验证 Markdown 阅读基础渲染。

- 列表项一
- 列表项二

| 名称 | 状态 |
| --- | --- |
| 表格 | 可读 |
| 长列 | 用于横向滚动基础覆盖 |

```ts
export const fixture = "code block";
```

```mermaid
flowchart TD
  A[打开文档] --> B[创建批注]
```

![space image](images/local%20image%20with%20space.svg)

![中文图片](images/中文图片.svg)

## 批注锚点

重复文本用于测试精确锚点。

重复文本用于测试精确锚点。

## 编辑闭环

保存前内容。
