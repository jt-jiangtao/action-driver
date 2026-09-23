## 1. Tool 契约与持久化基础

- [ ] 1.1 在 `packages/runtime-contracts` 定义 Tool Definition、Tool Call、Tool Event、审批控制帧、结构化错误和 Zod schema，并运行该包契约测试验证合法往返、未知字段拒绝与不可序列化输入失败。
- [ ] 1.2 为 Runtime 数据库增加 `tool_invocations` 前进迁移及仓储端口，验证首次迁移、重复启动、旧 v5 数据库升级、输入/输出持久化与按任务排序读取。
- [ ] 1.3 实现 Tool Registry 与模型名称双向映射，验证重复名称、未知版本、未启用工具和无效 JSON Schema 均被确定性拒绝。

## 2. OpenAI-compatible 工具调用协议

- [ ] 2.1 扩展模型领域消息、请求和终态类型以表达 assistant tool calls 与 tool results，运行 TypeScript 类型检查和协议单元测试验证 wire 类型不会泄漏到 Agent 领域。
- [ ] 2.2 扩展 OpenAI-compatible 请求构造，按本轮允许工具生成 `tools` 与 `tool_choice: auto`，验证纯文本请求在无工具时保持现有请求体不变。
- [ ] 2.3 聚合流式 `delta.tool_calls` 的 id、index、name 和 arguments，验证 arguments 跨分片、多调用乱序片段、缺失 id、非法 JSON 和不兼容 finish reason 的成功与失败行为。
- [ ] 2.4 更新模型调用持久化与模型层日志，使每个真实模型轮次保留安全化请求/响应且凭据继续被过滤，运行 model gateway 与日志测试验证工具 schema、tool result 和错误可追踪。

## 3. 通用 Tool Runtime

- [ ] 3.1 实现 Tool Policy 的 discover/call 双阶段判断与 `allow | require_approval | deny` 结果，验证隐藏工具不会进入模型请求、参数变化使旧批准失效、拒绝不会调用执行器。
- [ ] 3.2 实现 Tool Invocation 状态机与服务，覆盖 `proposed → waiting_approval|queued → running → completed|failed|cancelled`、非法转移、AbortSignal 和 timeout，并验证每次转移持久化一条幂等运行事件。
- [ ] 3.3 实现有界工具输出聚合器，验证有序 `tool.content`、stdout/stderr 总上限、截断元数据和单调用聚合结果，禁止为每个分片创建接口日志。
- [ ] 3.4 将单次 Tool Invocation 记录到接口层日志并沿用日志控制面排除规则，验证 `actiondriver:log:list` 不递归出现且 request/response/error 可在详情中读取。

## 4. LangGraph 模型—工具循环

- [ ] 4.1 将 GraphRunner 扩展为模型文本或工具调用两类路由，并用确定性模型与 fake executor 验证“模型请求工具 → 执行 → 追加 tool result → 模型生成最终文本”的完整循环。
- [ ] 4.2 支持同一响应的多个工具调用按 provider index 串行执行，验证 call id 关联、失败结果回传和最终正文不含工具执行进度。
- [ ] 4.3 增加每任务 8 轮、16 次调用预算以及取消传播，验证无限工具模型得到 `TOOL_BUDGET_EXCEEDED`、运行中取消等待真实 executor 终态且不会伪报完成。

## 5. 只读 Sandbox Executor

- [ ] 5.1 实现工作区路径解析器，验证普通相对路径、绝对路径、`..`、不存在目标、内部符号链接和越界符号链接的允许与拒绝行为。
- [ ] 5.2 实现 `sandbox.fs.list@1` 与 `sandbox.fs.read@1`，验证确定排序、1,000 项列表上限、1 MiB 读取上限、UTF-8 内容、范围和截断元数据。
- [ ] 5.3 实现 `sandbox.shell.run@1` 的 `spawn(..., { shell: false })` 执行器及 `rg/head/tail/wc` 参数白名单，验证 shell 元字符、未知 flag、网络/写入命令、越界路径、秘密环境变量、10 秒超时和 1 MiB 输出上限均按设计处理。
- [ ] 5.4 在 Runtime 组合根注册 Sandbox 工具、工作区根和首版策略，验证文件工具自动允许、shell 工具等待一次性批准、未启用工具返回 `TOOL_UNAVAILABLE`。

## 6. WebSocket、审批和页面投影

- [ ] 6.1 扩展 WebSocket client/server schema 与 capabilities，加入 `tool.approve`、`tool.reject` 和 `tool.*` 服务端事件，验证鉴权前拒绝、call/task/hash 校验、重复决定幂等和断线重放。
- [ ] 6.2 扩展 `StreamSessionService` 的 sequence、事件持久化与快照恢复，使模型文本和工具事件互不混淆，运行重连、重复投递、取消和页面重载测试。
- [ ] 6.3 扩展 Renderer stream client、任务投影和领域 DTO，验证工具事件不会追加到助手 Markdown，等待审批和终态能从持久化快照恢复。
- [ ] 6.4 在任务页输入框上方增加紧凑审批条并提供“拒绝”“允许一次”，验证键盘焦点、按钮 loading/disabled/终态、长命令省略与窄窗口布局，且无 Browser 工具时右侧面板保持关闭。

## 7. 端到端验证与交付

- [ ] 7.1 增加本地假 OpenAI-compatible 上游 E2E，验证真实 WebSocket 经过文本 → tool call → Sandbox `fs.read` → tool result → 最终 Markdown、数据库恢复和模型/接口日志完整可查。
- [ ] 7.2 增加 shell 审批 E2E，验证未批准不创建进程、允许一次后执行、拒绝/取消/超时终态和正文无内部执行进度。
- [ ] 7.3 使用一个已保存且支持 tool calling 的真实 OpenAI-compatible 模型执行 smoke；若模型不支持则显示 `TOOL_PROTOCOL_UNSUPPORTED` 而不回退 Mock，并保存去凭据的验证证据。
- [ ] 7.4 按任务组完成后分别运行相关包测试，最终运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和本变更 E2E，确认已有真实文本流、会话续问、日志与输入框行为无回归。
