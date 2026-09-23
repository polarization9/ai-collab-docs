# Margent Codex 单写者会话兼容说明

## 问题与验证

2026-09-23 本机 Codex CLI `0.155.0-alpha.16` 位于
`/Applications/ChatGPT.app/Contents/Resources/codex`。
旧版应用路径 `/Applications/Codex.app/Contents/Resources/codex` 仍作为兼容候选，
`CODEX_CLI_PATH` 优先于这两个候选，之后再查 PATH。

CLI 路径修复后，原投递方式仍在 `thread/resume` 阶段报错：
`already has an active writer`。目标会话已经被桌面端持有，
Margent 启动的独立 app-server 无法同时取得该会话的写权限。

实机验证表明 `codex queue` 能成功保存消息，但在目标会话中止后，
消息仍可能停留在队列，不能据此确认自动执行。所以未采用仅调用 queue 的方案。

## 实现

1. 连接当前用户的 Codex Desktop IPC，使用 `thread-owner-discovery` 查询目标会话的持有者。
2. 有持有者时，不启动独立 app-server。订阅桌面端的实时状态快照和增量更新，
   目标正在执行时等待；空闲后，通过 IPC `thread-follower-start-turn` 交给持有者启动。
   实机发现独立 app-server 的 `thread/turns/list` 会将桌面端仍在执行的 turn 报成 interrupted，
   因此不能用磁盘历史判断运行状态。实时状态同时支持 turns 和 canonical turnHistory 两种布局，
   增量使用 Immer patch 协议；状态版本不匹配或增量序号不连续时明确失败，不猜测状态。
3. 转发请求继承会话设置，使用新的 clientUserMessageId，不创建会话、不改变目标绑定。
4. 得到真实 turn ID 后才标记 sent。随后监控对应 turn 和 Margent event；
   MCP 写回 handled 后完成，turn 失败或中止则收口为 failed，
   turn 完成但没有 MCP 写回则沿用现有失败检查。
5. 超时后重试，如果上次桌面投递的 turn 仍在运行，就继续跟踪该 turn，不重复投递。
6. IPC 不存在或明确返回没有持有者时，保留独立 app-server 的旧投递方式和 MCP 预检。
   已向持有者发送请求后的失败不得自动改走另一个通道，以免重复执行。
7. 桌面通道 prompt 使用当前会话的工具发现机制；只有旧独立通道保留精确工具名和预检说明。
8. 用户错误信息过滤结构化 TRACE/DEBUG/INFO/WARN，保留真正的失败原因。

忙碌等待期间更新投递心跳，避免被误判为应用崩溃遗留任务；
不强制中断用户正在执行的任务。等待时间沿用 `MARGENT_CODEX_TURN_TIMEOUT_MS`，默认 600 秒。
用户删除批注时停止等待，不将对应 ignored event 改回 sent 或 failed。

## 兼容边界

桌面 IPC 是本机已验证的版本化内部协议，不是公开稳定 API。
当前用到 initialize v0、thread-owner-discovery v1、thread-follower-start-turn v2、
thread-stream-following-changed v1 和 thread-stream-state-changed v11。
后续 Codex 升级需要持续验证；不绕过写锁、不删除锁文件。
未运行桌面应用的 CLI 会话继续适用旧通道；若另一个 CLI 进程持有写锁且没有桌面持有者，
仍可能返回写锁错误，需要等待该 CLI 释放会话。

## 验证

- `npm run check:codex-delivery`：模拟 IPC 分帧、新旧投递、busy、MCP 未写回、转发失败、在途重试、
  真实中止、连接断开、协议不匹配、删除批注；验证旧磁盘状态不会使运行中的 turn 被误判为失败。
- `npm run check:agent-binding`：四个 provider 的绑定回归。
- 本机临时文档 smoke：桌面端持有目标会话时成功回复 `queue-smoke-ok`，event 为 handled。
- 不将测试脚本打包为应用功能；check:release 在构建前执行检查。
