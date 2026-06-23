# Margent Codex 初始化指南

这份文档用于引导 Codex 帮用户完成 Margent 的首次本机初始化。

用户不需要理解底层配置细节，只需要告诉 Codex：“请根据这份文档帮我初始化 Margent”。Codex 需要主动检查、配置、验证，并在失败时说明具体卡在哪一步。

## 1. 将 Margent 设为本机 Markdown 默认打开方式

Codex 需要尝试把 Margent 设置为本机 `.md` / `.markdown` 文件的默认打开方式。

目标状态：

- 用户以后双击 Markdown 文件时，默认用 Margent 打开。
- 如果系统不允许 Codex 自动完成，Codex 应告诉用户用 Finder 的“显示简介”手动设置。
- App 内不需要弹窗要求用户设置默认打开方式。

## 2. 安装 / 修复 Codex MCP 连接

Codex 需要把 Margent MCP server 注册到本机 Codex 配置中。安装 `Margent.app` 本身不会让 Codex 自动发现 MCP；必须显式写入 Codex 配置并重启 Codex。

### 2.1 检查 Margent 安装路径

确认用户已经把 Margent 安装到：

```text
/Applications/Margent.app
```

确认内置 Node runtime 存在且可执行：

```text
/Applications/Margent.app/Contents/Resources/resources/node/bin/node
```

优先使用新版桌面 MCP CLI：

```text
/Applications/Margent.app/Contents/Resources/_up_/dist/desktop/mcpCli.js
```

如果新版路径不存在，但下面的旧版路径存在，可以使用旧版路径兼容当前安装包：

```text
/Applications/Margent.app/Contents/Resources/_up_/dist/mcpCli.js
```

如果以上路径都不存在，Codex 应告诉用户：当前 Margent 安装包不包含可用的 MCP CLI，需要重新安装最新版 Margent。

### 2.2 写入 Codex 配置

修改：

```text
~/.codex/config.toml
```

修改前先备份原文件，例如：

```bash
cp ~/.codex/config.toml ~/.codex/config.toml.bak-margent-$(date +%Y%m%d%H%M%S)
```

如果已有 `[mcp_servers.margent]`，更新它；如果没有，新增：

```toml
[mcp_servers.margent]
command = "/Applications/Margent.app/Contents/Resources/resources/node/bin/node"
args = [
  "/Applications/Margent.app/Contents/Resources/_up_/dist/desktop/mcpCli.js"
]
startup_timeout_sec = 20
tool_timeout_sec = 60
default_tools_approval_mode = "auto"
```

如果只能使用旧版 MCP CLI 路径，则把 `args` 改成：

```toml
args = [
  "/Applications/Margent.app/Contents/Resources/_up_/dist/mcpCli.js"
]
```

不要在全局 MCP 配置里追加某个具体 Markdown 文档路径。Margent MCP 工具可以通过 `documentPath` 参数处理具体文档，后续绑定当前文档时再建立文档和 Codex 会话的关系。

Codex 修改配置时必须保留用户已有的其他 `mcp_servers`、`projects`、`plugins` 和设置，不要重写整个 `config.toml`。

### 2.3 验证 MCP CLI 可以启动

使用实际写入配置的路径运行：

```bash
/Applications/Margent.app/Contents/Resources/resources/node/bin/node \
  /Applications/Margent.app/Contents/Resources/_up_/dist/desktop/mcpCli.js \
  --help
```

预期输出包含：

```text
Usage: margent-mcp [markdown-file]
```

如果使用旧版路径，则把命令中的 `dist/desktop/mcpCli.js` 换成 `dist/mcpCli.js`。

### 2.4 完全重启 Codex

Codex 写入配置后，需要提醒用户完全退出并重新打开 Codex。只刷新当前对话通常不够。

### 2.5 验证 reviewer 工具可见

重启 Codex 后，Codex 应确认自己能看到 Margent reviewer 工具，例如：

- `reviewer_get_annotation_context`
- `reviewer_add_annotation_reply`
- `reviewer_apply_document_edit`
- `reviewer_update_annotation_status`
- `reviewer_mark_review_event_handled`

如果 Codex 看不到 Margent MCP 或 reviewer 工具，需要明确说明协作通道尚未连接，不能假装已经可以处理批注。

## 3. 建立 Margent 与 Codex 的本地协作通道

完成 MCP 注册并重启 Codex 后，Codex 需要让自己具备读取和处理 Margent 批注的能力。

目标状态：

- Codex 能读取用户本机 Markdown 文档。
- Codex 能读取 Margent 批注。
- Codex 能回复批注。
- Codex 能在明确需要时修改 Markdown 正文。
- Codex 能把已处理的批注任务标记完成。

如果 Codex 还不能看到 Margent 的批注工具，就回到第 2 节修复 MCP 连接。

## 4. 在需要验证协作链路时绑定当前 Codex 会话和文档

这一步只在用户希望 Codex 完成初始化、处理批注或验证协作闭环时需要执行。用户如果只是阅读示例文档，不需要把示例文档连接到 Codex 会话。

Codex 需要按用户意图，把当前会话绑定到正在处理的 Markdown 文档，让 Margent 知道后续批注任务应该投递给哪个 Codex 会话。

目标状态：

- 如果用户只是阅读示例文档或未要求验证 Codex 协作，可以跳过绑定。
- 如果当前会话是这份文档的主要创作或讨论会话，绑定为来源会话。
- 如果当前会话是后续接着处理批注的新会话，绑定为接续会话。
- 用户不需要查找、复制或填写 thread id。
- 绑定成功后，Margent 能显示已经检测到对应 Codex 会话。

## 5. 验证批注处理闭环

Codex 需要用一条真实或测试批注验证协作链路。

目标状态：

- Codex 能读取指定批注。
- Codex 能判断这条批注是提问、讨论还是明确修改需求。
- 对提问型批注，Codex 能直接回复。
- 对明确修改型批注，Codex 能修改正文并回复处理说明。
- 处理完成后，Codex 能把任务标记为已处理。

## 6. 向用户报告初始化结果

Codex 完成初始化后，需要用用户能看懂的方式汇报结果。

建议汇报格式：

```text
Margent 初始化完成：
- Markdown 默认打开方式已设置 / 需要你手动设置。
- Codex MCP 已写入配置并通过启动验证 / 尚未写入成功。
- Codex 已连接 Margent 批注工具 / 尚未连接成功。
- 当前文档已绑定到这个 Codex 会话 / 本次不需要绑定 / 尚未绑定。
- 已验证一条批注处理闭环 / 尚未验证。
```

如果某一步失败，Codex 应说明是哪一步失败，以及用户下一步需要做什么。不要只说“初始化失败”。
