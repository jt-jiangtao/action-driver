## Context

参见 `proposal.md` 的 Why。当前生产链路是 Renderer 直接通过 WebSocket 向 `apps/agent-runtime` 提交任务，Runtime 使用 LangGraph 调用 OpenAI-compatible `/chat/completions` 并将文本分片持久化后推送给页面。`ModelGateway` 的领域结果已经预留 `invoke-skill`，但生产流适配只解析文本；`SkillRegistry` 与 `SkillInvocationService` 能保存统一生命周期，却把说明型 Skill 和执行能力放在同一抽象中。日志已有请求/响应聚合与控制面排除规则。

本变更必须在保留真实文本流、同会话多任务、现有 WebSocket 恢复和本地 SQLite 单写者的前提下加入工具循环。第一版 Sandbox 面向可信桌面应用内的最小只读能力，不宣称能抵抗恶意原生进程；强隔离容器、远程执行和任意代码执行需要独立决策。

## Goals / Non-Goals

**Goals:**

- 建立与模型供应商和具体工具实现解耦的 Tool Definition、Registry、Policy、Invocation 与 Executor 边界。
- 让真实 OpenAI-compatible 模型能返回流式 tool call，Runtime 执行后继续模型循环并产生最终 Markdown 正文。
- 让工具状态、审批、取消、输出、聚合日志和模型层调用在现有任务与会话链路中可追踪。
- 以 `fs.list`、`fs.read` 和受限 `shell.run` 验证工作区只读执行器。

**Non-Goals:**

- 不迁移到 OpenAI Responses API，不依赖 OpenAI 托管工具。
- 不实现 Web Search、Browser Use、Computer Use、MCP、文件写入、补丁、包安装或通用代码解释器。
- 不提供容器级、虚拟机级或对抗恶意本地二进制的安全承诺。
- 不重做日志页面、模型配置页或任务页整体布局。

## Decisions

### 1. Tool 是执行契约，Skill 是声明和编排包

新增独立 `ToolDefinition` 与 `ToolExecutor`，不直接扩展现有 `SkillProvider` 为万能接口。内部工具标识使用命名空间形式，例如 `sandbox.fs.read@1`；模型可见名称使用兼容 OpenAI-compatible 网关的 ASCII 名称，例如 `sandbox_fs_read`，Registry 保存双向唯一映射。定义至少包含输入 JSON Schema、风险、读写/网络副作用、超时和输出限制。

Skill manifest 只声明 `requiredTools`、权限与加载信息；Skill Markdown 只提供行为指导。Runtime 按本轮实际启用的 Skill 和策略生成可见工具集合，Markdown 不能注册工具或提升权限。

备选方案 A 是继续让每个 `SkillProvider` 直接代表可执行工具。它改动较少，但会把提示词包、Browser/Computer 编排和单一函数调用继续混为一谈，无法形成 MCP 与 Sandbox 共用的最小契约。备选方案 B 是直接使用 LangChain Tool 类型作为公共契约；它能快速接入模型，但会让框架类型进入存储、WebSocket 与 UI，因此不采用。用户已裁决选择通用内部 Tool Runtime。

### 2. 公共 DTO 放入 `runtime-contracts`，执行端口留在 Agent Runtime

`packages/runtime-contracts` 保存可序列化 DTO、Zod schema、WebSocket 帧和错误码；`apps/agent-runtime` 保存 Registry、Policy、Invocation Service 与具体 Executor。`packages/model-connections` 只负责把内部模型请求映射为供应商协议，并把流式响应还原为 provider-neutral 的文本或 tool calls。

运行时定义采用普通 JSON Schema 子集。首版由 Zod 定义输入并导出 JSON Schema，Registry 注册时同时校验 schema 可序列化、模型名称唯一和版本合法。任何 executor 都只能收到已通过 schema 校验的参数。

### 3. 先扩展 Chat Completions tool calling，不切换模型 API

现有 OpenAI-compatible 适配器在请求中增加 `tools` 与 `tool_choice: "auto"`。流解析器按 `choices[0].delta.tool_calls[].index` 聚合 id、function name 和 arguments；只有 finish reason 为 `tool_calls` 且所有 arguments 可解析时，才返回结构化 tool-call 终态。文本终态沿用当前 content/end 语义。

模型领域消息扩展为判别联合：普通 system/user/assistant 文本、assistant tool-call 消息和带 `toolCallId` 的 tool result。供应商适配器拥有 wire 映射，LangGraph 与存储不保存 OpenAI SDK 对象。

备选方案是立即迁移 Responses API 以使用 hosted tools 和 tool search。它会同时改变当前已跑通的流协议、兼容网关范围和日志载荷，且首个 Sandbox 不需要 hosted tools，因此推迟到 Web Search 或大量工具动态发现确有需求时再单独 Battle。

### 4. LangGraph 显式运行“模型 → 工具 → 模型”循环

现有 plan 节点演进为可循环节点：

```text
model
  ├─ final text ───────────────→ finish
  └─ tool calls → resolve/policy → approval? → execute tools
                                             ↓
                                      append tool results
                                             ↓
                                           model
```

同一 assistant 响应中的多次工具调用按 provider index 串行执行，先保证稳定日志顺序、审批顺序和可复现测试；未来只有在工具声明 `parallelSafe` 且存在性能证据时才并行。默认每个任务最多 8 个工具轮次、16 个工具调用；超过预算返回 `TOOL_BUDGET_EXCEEDED`，不得静默继续。

工具失败以结构化 tool result 交回模型一次，让模型可以解释失败或改用其他已授权工具；输入不可解析、预算耗尽、任务取消和 Runtime 内部一致性错误直接终止任务。最终助手正文只来自模型 final text，工具进度不拼进 Markdown。

### 5. Tool Policy 在执行器之前做发现与调用两次校验

Policy 输入包含任务、工具定义、本轮 grants、风险和调用参数摘要，输出为 `allow | require_approval | deny`。构造模型请求时先过滤不可发现工具；收到调用后再次根据完整参数决策，避免模型仅凭看到定义获得执行权。

首版策略：

- `fs.list`、`fs.read`：工作区内只读，自动允许。
- `shell.run`：始终要求“允许一次”，批准绑定 `taskId + callId + argumentsHash`，参数变化后旧批准失效。
- 未启用工具、写入、网络或未知副作用：拒绝。

等待批准时持久化 `waiting_approval`，WebSocket 发布工具事件。任务页在对话正文之外、输入框上方显示紧凑审批条，提供“拒绝”和“允许一次”；不得把执行进度插入助手 Markdown。客户端发送带 call id 的 approve/reject 帧，服务端再次校验当前状态与 arguments hash。连接断开不自动批准，重连后由持久化状态重新投影。

### 6. 工具调用使用独立持久化记录和聚合日志

SQLite 新增 `tool_invocations`，字段包括 call id、provider tool call id、task id、tool id/version、arguments hash、输入、policy decision、状态、聚合输出、结构化错误和时间戳。迁移只新增表和索引，不修改现有消息与模型调用记录。

每次状态转移写入 `runtime_events`，事件名为 `tool.proposed`、`tool.waiting_approval`、`tool.running`、`tool.content`、`tool.completed|failed|cancelled`；content 事件可分片推送，但数据库中的 invocation 保存有上限的聚合输出。接口层日志以一次 invocation 为一条 request/response 记录，操作名使用稳定工具 id；模型层日志仍保留每一轮真实模型请求和响应。日志查询控制面沿用排除规则，工具层不得记录 `actiondriver:log:list`。

### 7. Sandbox 采用受限能力集合，而不是伪装成强隔离 Shell

Runtime 启动时由配置注入单一 `workspaceRoot`。所有文件路径先拒绝绝对路径，再做 `resolve`、现有目标 `realpath` 和根目录 containment 检查；目录列表最多 1,000 项，文件读取默认最多 1 MiB，并返回截断、范围和原始大小。

`shell.run` 使用 `spawn(executable, args, { shell: false, cwd, env })`。首版只允许只读命令 `rg`、`head`、`tail`、`wc`，每个命令使用参数白名单解析器，不使用危险参数黑名单：

- 路径参数必须通过相同 containment 检查；省略路径时只作用于 workspace cwd。
- `rg` 不允许 `--pre`、任意可执行 hook、跟随越界符号链接或未识别 flag。
- 不允许 stdin 脚本、管道、重定向、命令替换、环境变量赋值和 shell 元字符语义。
- 环境只包含明确构造的 `PATH`、`LANG`、`LC_ALL`，不继承 API key、Runtime token 或用户秘密。
- 默认超时 10 秒，stdout 与 stderr 合计最多 1 MiB；超限或取消时终止进程树。

该方案无法阻止一个已经被允许但本身恶意的原生二进制访问宿主机，因此允许列表只能绑定应用随附或解析到受信任系统路径的固定 executable。容器、WASI 或远程 Sandbox 都是可执行替代方案，但会引入运行依赖、平台差异或部署成本；首版以“最小只读命令 + 明确不做强隔离承诺”换取本地可交付性。

### 8. 流式事件沿用现有 WebSocket 会话，不新增第二连接

工具帧与现有 run 生命周期共享一条 WebSocket，并携带 `requestId`、`taskId`、`callId`、单调 sequence 和事件类型。客户端状态机按 call id 幂等应用重复事件；模型文本 sequence 与工具 sequence 分属明确事件 envelope，避免把 stdout 当作 Markdown delta。

审批控制、任务取消和断线恢复复用现有鉴权、origin 校验、ping/pong 与重连机制。浏览器右侧面板仍只由 Browser Use 决定；Sandbox 工具不会打开右侧面板。

## Risks / Trade-offs

- [OpenAI-compatible 网关对流式 tool call 的字段支持不一致] → 使用本地假上游覆盖分片顺序、arguments 拆分和多调用，并用至少一个真实已配置模型做 smoke；不兼容时返回明确 `TOOL_PROTOCOL_UNSUPPORTED`，不降级为文本猜测。
- [模型在工具循环中无限调用] → 使用 8 轮/16 调用双预算，预算写入任务错误和日志。
- [批准消息与参数被替换或重放] → 批准绑定 task、call、arguments hash，只接受 `waiting_approval` 当前版本，重复决定幂等返回原结果。
- [工作区路径通过符号链接逃逸] → 对现有目标执行 realpath containment；不存在目标在本变更中不可写，因此直接拒绝。
- [受限命令仍不是强 OS Sandbox] → 只允许固定只读 executable 与参数白名单，不继承秘密，不宣称对抗隔离；引入写入或任意代码执行前必须重新 Battle。
- [工具输出过大拖慢 WebSocket、SQLite 和模型上下文] → 内容事件分片有上限，聚合输出和传回模型的结果分别截断并带元数据。
- [工具事件污染助手正文或日志递归] → 协议使用独立事件类型，Renderer 分区渲染，日志层保留控制面排除与单调用聚合测试。
- [现有 Skill 与新 Tool 概念迁移产生双轨] → 本变更不删除 Skill Registry；只把 Sandbox 注册为 Tool，并通过 adapter 为后续 Skill manifest 使用，Browser/Computer 的迁移留在各自 change。
- [用户覆盖 Agent 建议] → 无。用户接受了通用底座优先、MCP 作为适配器、Computer Use 后置的推荐。

## Migration Plan

1. 先新增 Tool DTO、schema、Registry、Policy 和 SQLite migration，保持当前模型请求不带 tools，所有现有测试继续通过。
2. 扩展假上游与 OpenAI-compatible adapter，支持文本和 tool-call 两类流式终态；用契约测试固定 wire 映射。
3. 在 LangGraph 接入工具循环和预算，以确定性 Tool Executor 跑通模型 → 工具 → 模型测试。
4. 注册 Sandbox 文件工具与命令工具，接入审批控制帧、持久化事件和聚合日志。
5. 增加任务页紧凑审批条与 WebSocket 投影，完成本地假上游 E2E 和真实模型 smoke。

若上线前失败，可关闭 Runtime 的 tool capability，使模型请求恢复为纯文本模式；新增数据库表保留但不被旧流程读取。回滚不得把工具调用伪装成成功文本。
