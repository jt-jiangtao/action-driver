## Why

并发任务共享全局事件 cursor，客户端却将它当作单请求连续序号，可能导致事件卡住；Runtime 重启后仍为 `running` 的任务也缺少确定收口。现有 HTTP/WS、旧 RPC、配置写入、包边界与模型观测处于过渡态，需要在保留既有功能和数据的前提下完成单一架构。

Battle 已完成，用户明确裁决分阶段完成全部已审查问题，并确认 Hono、`@hono/zod-validator`、TanStack Query、`fast-check` 的用途。后续审查发现生产 Mock 回退、Renderer HTTP Origin、同库多 Runtime 和共享活动投影边界四个问题；比较替代方案及风险后，用户再次明确接受本设计的四项推荐。书面设计见 `docs/superpowers/specs/2026-09-24-architecture-convergence-design.md`；当前无待裁决的关键分歧。发现新的不可逆迁移风险时按治理协议重新 Battle。

## What Changes

- **BREAKING**：持久化请求事件增加请求内连续 `sequence` 和唯一约束；全局 `cursor` 仅用于重放定位。旧数据库经备份、回填与验证迁移，协议版本同步升级。
- Runtime 启动时幂等结束无执行者的运行中请求，保留已提交内容和未知工具结果；不自动重放可能产生副作用的工具。
- 同一数据库只允许一个存活的 Runtime；启动恢复必须先取得独占所有权，生产环境不回退到 Browser/Computer Mock。
- HTTP 控制面改由 Hono + Zod 校验，WS 保持流式通道；完成迁移后删除业务 MessagePort RPC。
- Renderer 直连 HTTP 时同时校验精确的 Renderer Origin 与 Runtime token；活动投影搬入独立纯逻辑包供 Runtime/Renderer 复用。
- Runtime 统一持有任务、模型、prompt 和 Skill 定义，Main 只托管 Runtime 与执行本机能力；Renderer 使用 TanStack Query 管理读取态、纯投影管理流事件。
- 模型实现迁回 Runtime、UI 投影迁回 Renderer；删除无消费者抽象、绑定式 DI 容器及单消费者设计 token 包。
- 模型日志以 LangSmith 为唯一来源，OTel 管运行诊断，SQLite 管任务事实；清理 Phoenix 重复模型追踪。
- 用 `fast-check` 和集成/E2E 覆盖事件交错、重放、重启、迁移与打包运行。

## Capabilities

### New Capabilities

- `runtime-event-recovery`：请求事件原子序号、重放/快照以及崩溃后任务收口。

### Modified Capabilities

- `agent-tool-runtime`：活动顺序从单请求全局 cursor 解释调整为请求内序号；未知工具结果与重复执行安全规则。
- `agent-skill-boundary`：抽象依赖注入继续成立，但不要求 Inversify 容器或 IPC 作为实现形式。
- `self-hosted-observability`：模型原文来源从 Phoenix 转为已裁决的 LangSmith；运行日志与任务事实职责分离。

## Impact

影响 `apps/agent-runtime` 的数据库、仓库、流服务、HTTP 服务与装配，`apps/desktop` 的 Main/Preload/Renderer，`packages/contracts`、`packages/runtime-contracts`、`packages/model-connections`、`packages/observability` 和 `packages/design-tokens`。新增 Hono、Node adapter、Zod validator、TanStack Query 与开发依赖 `fast-check`；保留现有 SQLite、LangGraph、OpenAI SDK 和 `ws`。与在途 `serve-runtime-over-http`、`manage-agent-skills`、`use-langsmith-model-logs` 变更协调，避免重复实现或覆盖未提交工作。
