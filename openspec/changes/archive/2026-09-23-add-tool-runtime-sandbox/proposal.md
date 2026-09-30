## Why

Action-Driver 已跑通真实模型流式会话，但当前模型适配器只接受文本结果，现有 Skill Provider 也缺少可供模型发现、校验、审批和流式观察的通用 Tool 契约，因此无法在不为每种能力重复实现状态、权限和日志的前提下执行真实操作。下一步需要先建立通用 Tool Runtime，并用受限 Sandbox 跑通第一个真实工具闭环，作为后续 Web Search、Browser Use、Computer Use 和 MCP Adapter 的共同底座。

## What Changes

- 新增版本化、可序列化的 Tool Definition、Tool Call、Tool Event、结构化错误与终态结果契约，并以 JSON Schema 校验工具输入。
- 新增 Tool Registry、Policy Gate 与 Tool Executor 边界，使模型只能调用本轮明确启用且通过策略校验的工具。
- 扩展 OpenAI-compatible 模型流适配，识别并聚合流式 `tool_calls`，让 LangGraph 在“模型 → 工具 → 模型”循环中继续生成最终正文。
- 新增工作区范围的 Sandbox Executor，首版提供只读 `fs.list`、`fs.read` 和默认禁网的 `shell.run`；不提供任意目录写入、`apply_patch` 或宿主机 GUI 操作。
- 将工具调用的 `start / content / end / error` 事件通过现有 WebSocket 运行事件链路传输，并持久化单次聚合调用及完整输入、输出和错误，禁止为每个输出分片创建接口日志。
- 保持最终正文只显示模型面向用户的答复；工具执行进度进入运行事件与日志投影，不混入助手正文。
- 明确 Skill 是带 manifest 的说明与编排包，Tool 是可执行能力；Skill 只能声明所需工具和权限，不能通过 Markdown 自行授予权限。
- 本变更不实现 Web Search、Browser Use、Computer Use、MCP、写文件工具、任意网络访问或新的工具管理 UI。

## Capabilities

### New Capabilities

- `agent-tool-runtime`: 定义工具注册、模型工具调用、策略校验、生命周期事件、取消、错误和日志行为。
- `sandbox-execution`: 定义工作区范围的文件读取与受限命令执行边界。

### Modified Capabilities

- `agent-skill-boundary`: 将 Skill 与可执行 Tool 分离，规定 Skill 通过结构化 manifest 声明工具依赖和权限，而不是把 Markdown 指令或具体实现本身当作执行权限。

## Impact

- 影响 `packages/runtime-contracts`、`packages/model-connections`、`apps/agent-runtime` 的模型协议、LangGraph 循环、Registry、SQLite 投影、WebSocket 事件和日志测试。
- 复用现有 `SkillInvocationService` 的生命周期与持久化思想，但建立独立 Tool 契约；Browser/Computer Skill 仍保持独立且不在本变更落地。
- Sandbox 在 Agent Runtime 进程中通过受限端口执行，首版不引入容器或远程执行依赖；这不宣称具备强对抗隔离，只提供明确的工作区、命令、环境、网络和资源边界。
- Battle 已完成：用户裁决采用“通用 Tool Runtime → Sandbox → Web Search → Browser Use → Computer Use，MCP 作为适配器”的方向。被否方案包括逐功能定制执行链路和 MCP-first；主要理由是两者会重复或外泄审批、生命周期、日志和安全策略。当前无未解决的关键分歧。
