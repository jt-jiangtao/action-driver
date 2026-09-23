## Why

本地 Agent 的 Shell 与 Web Search 目前逐次停在工具审批，用户已裁决改为直接执行已注册且获本轮授权的工具。审批横跨 Runtime、流协议和桌面输入区；只隐藏按钮会使任务永久停留在 `waiting_approval`，因此必须端到端移除活跃审批流程。

本变更属于安全边界和公共接口变更。Battle 已比较“所有已授权工具自动执行”与“仅低风险工具自动执行、高风险仍逐次审批”。后者保留人工拦截，但不能满足不中断任务的目标。用户确认前者，并接受模型受错误或恶意内容诱导时可能自动读取工作区信息、把敏感内容带入搜索查询的风险；工具注册、逐轮授权列表、参数校验、Sandbox、取消、超时和审计仍保留。新增文件写入、任意命令或任意网络发送工具时须重新审查边界。

## What Changes

- 策略对通过注册、逐轮授权和名称检查的工具返回 `allow`；输入校验继续在执行器之前进行。
- 新工具调用只走 `proposed → queued → running → completed|failed|cancelled`，不再等待用户批准。
- 移除 approve/reject 控制帧、服务调用链、桌面按钮和输入框上方的审批条。
- 保留旧审批事件的读取兼容；升级时仍处于等待审批的旧调用安全结束，不自动执行。
- 更新 Shell、文件、Web Search 的单元与端到端测试，并验证完成后刷新能恢复工具过程。

## Capabilities

### Modified Capabilities

- `agent-tool-runtime`: 已授权工具自动执行；旧审批记录只读兼容。
- `agent-task-experience`: 不再呈现阻塞式工具审批 UI。

## Impact

影响 Runtime Tool Policy、Invocation、SQLite 恢复、WebSocket 协议、Desktop Renderer 和相应测试。当前只读 Sandbox 及独立的 SearXNG 网络工具不扩大能力范围；不新增依赖，不重写已归档的历史 OpenSpec 变更。
