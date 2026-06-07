# Margent 新用户初始化与示例文档方案

## 1. 背景

Margent 开源后，新用户第一次下载 App 时，主要阻力不在阅读器本身，而在三个前置动作：

- 不知道应该打开哪份 Markdown 才能快速体验。
- 不知道 `.review.json`、`.codex.json` 和 Markdown 正文之间的关系。
- 不知道如何让 Codex 帮自己完成默认打开方式、MCP 和接续会话配置。

这个方案的目标是减少首次体验的空白感，但不把 Margent 做成教学型启动页，也不新增独立“打开示例文档”入口。

## 2. 产品原则

- 首屏仍然是可用的文档工具，不做营销页。
- 示例文档进入真实文档路径，批注和编辑行为都走正式链路。
- 用户删除示例文档或从最近文件里移除后，Margent 不自动恢复。
- 默认打开方式和 Codex 配置交给面向 Agent 的初始化文档，不让普通用户在 App 内理解系统命令。

## 3. 示例文档方案

App bundle 内置两份只读模板：

```text
examples/Margent Quickstart.md
examples/Margent Quickstart.en.md
```

首次启动时，Server 会根据有效语言选择模板，并复制到用户可写目录：

```text
~/Documents/Margent/Margent Quickstart.md
~/Documents/Margent/Margent Quickstart.en.md
```

语言选择规则：

- 设置为 `zh-CN` 时使用中文 Quickstart。
- 设置为 `en-US` 时使用英文 Quickstart。
- 设置为 `system` 时读取系统语言；中文系统使用中文 Quickstart，其他语言默认使用英文 Quickstart。
- 只在首次初始化时选择一次；用户后续切换语言不会自动替换或新增 Quickstart。

然后把这份文件加入最近文件列表。用户看到的体验是：

1. 打开 Margent。
2. 空态启动页下方的最近文件里出现对应语言的 Quickstart 文档。
3. 点击后进入真实阅读界面。
4. 批注写入同目录的 `.review.json`。
5. 如果连接 Codex，连接信息写入同目录的 `.codex.json`。

## 4. 不提供恢复入口

如果用户删除首次复制出的 Quickstart 文档，最近文件中可以显示“文件不存在”。Margent 不需要提供“重新创建示例文档”的按钮，也不在下次启动时重新复制。

这样做的原因是：示例文档只是降低首次空态摩擦，不是用户长期工作流的一部分。删除后反复恢复会像系统在替用户管理文件，反而破坏本地优先产品的可预期性。

## 5. 默认打开方式

默认 Markdown 打开方式不放到 App 内弹窗里做。

更合适的路径是：用户让 Codex 执行初始化时，Codex 读取 `Margent Codex 初始化指南.md`，检查 `/Applications/Margent.app` 是否存在，注册 LaunchServices，并尝试把 Markdown UTI 的默认 handler 设置为 `com.margent.desktop`。

如果 macOS 策略或本机状态导致命令失败，Codex 再提示用户通过 Finder 的“显示简介”手动设置。

## 6. 接续会话闭环

接续会话不要求用户理解 thread id。

当前主路径仍然是：

1. Margent 生成“复制接续指令”。
2. 用户粘贴到目标 Codex 会话。
3. Codex 调用 `reviewer_bind_current_codex_thread` 绑定自己。
4. Margent 通过 `.codex.json` 看到接续会话已绑定。

后续可以增强为“等待接续”状态：用户复制指令后，连接卡片进入轻量等待态，并短轮询 `.codex.json`。一旦目标会话完成绑定，状态文案从“未检测到对应 Codex 会话”更新为“已检测到对应 Codex 会话”。

这个增强只改变用户反馈，不改变连接数据模型。

## 7. 当前落地状态

- 已新增内置示例文档模板。
- 已支持根据有效语言首次复制中文或英文 Quickstart 到 `~/Documents/Margent/`。
- 已支持首次把示例文档写入最近文件。
- 已通过本地状态文件记录初始化，避免用户删除后再次恢复。
- 已把示例资源加入 Tauri 打包资源。

## 8. 待确认

- 最近文件中的示例是否需要轻量标签，例如“示例”。当前先不加，保持 UI 简洁。
- 已新增英文 Quickstart 文档；首次最近文件会根据有效语言注入中文或英文 Quickstart。
- “等待接续”状态是否要进入下一轮 UI 实现，还是先保持文档方案。
