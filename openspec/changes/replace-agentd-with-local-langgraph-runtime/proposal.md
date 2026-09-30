## Why

现有运行时规划以 Go、Eino、gRPC 和 Protobuf 为核心，但 Action-Driver 的 Agent Loop 需要与 Electron、TypeScript 领域模型和本地 Skill Provider 高频协作，并原生支持暂停、继续、人工接管与持久化恢复。改用本地 Node.js/TypeScript + LangGraph 可以减少跨语言边界，让 Agent 编排、依赖注入和桌面能力调用保持类型一致，同时继续确保历史会话只保存在客户端。

## What Changes

- **BREAKING**：停止 Go/Eino Agent Service、跨语言 Protobuf/gRPC Runtime 和 Go SQLite 单写者方案，替换为随 Electron 应用分发的本地 Node.js/TypeScript Agent Runtime。
- 在独立的 `apps/agent-runtime` 中使用 LangGraph 编排 Agent Loop、checkpoint、中断、继续和等待用户；LangChain 仅按需提供模型与 Tool 适配，不使用高层 `createAgent` 作为核心循环。
- Electron Main 负责启动和监督单一 Runtime 进程，并通过版本化、类型安全的本地消息协议进行双向通信；Renderer 仍只能通过白名单 Preload API 使用 Agent 能力。
- Preload 白名单增加类型化 `controlSkill(invocationId, command)`，只允许暂停、继续和人工接管三种 Skill 控制命令，使生产 Renderer 不需要保留伪造的 Mock SkillGateway。
- 由本地 Runtime 独占 SQLite 写入，保存任务、消息、步骤、Skill 调用、运行事件、历史会话和 LangGraph checkpoint；远程模型推理端不保存 Action-Driver 会话历史。
- 使用 InversifyJS 分别组装 Renderer 前端、Electron Main 和 Agent Runtime；前端页面只消费注入的领域服务，Browser Use 与 Computer Use 继续作为相互独立的 Skill Provider，由 Agent Loop 调用。
- 保留确定性 Mock Runtime 和 Mock Skill，用于当前页面、组件测试和视觉回归；本阶段不实现真实模型推理、Browser Use、Computer Use、Action Graph 或 Page/Procedure Memory。
- 后续 Browser Use change 将独立实现 Playwright Fork 第一版，并为 Native Browser Engine 保留分离的接口与评测边界；不得在本 change 中把两套引擎抽象成同一底层 Graph Provider。

## Capabilities

### New Capabilities

- `local-agent-runtime`: 定义本地 TypeScript/LangGraph Agent Runtime 的进程生命周期、图执行、中断恢复和模型边界。
- `local-runtime-storage`: 定义客户端 SQLite 对历史会话、运行事件和 LangGraph checkpoint 的单写者持久化行为。
- `runtime-transport`: 定义 Electron Main 与本地 Runtime 之间版本化、双向且 Renderer 隔离的消息传输行为。

### Modified Capabilities

- `agent-skill-boundary`: 将生产 Skill Registry、Provider 路由和生命周期事件绑定到本地 LangGraph Runtime，同时保持 Browser Use 与 Computer Use 独立。

## Impact

- 新增 `apps/agent-runtime` 及其 TypeScript 构建、测试和 Electron 打包入口；不再恢复 `services/agentd`、Go Workspace、Eino、Buf、Protobuf 或 gRPC 依赖。
- Electron Main 新增 Runtime Supervisor、本地消息客户端、IPC Adapter 和明确的进程退出处理；Preload 与 React 继续使用现有领域 DTO。
- 新增 LangGraph、LangChain Core/模型适配和 SQLite 驱动依赖；Renderer、Electron Main 与 Agent Runtime 统一使用 InversifyJS，版本将在实施计划中锁定并接受 Electron 打包验证。
- 现有 `establish-runtime-foundations` change 被本 change 的 Runtime 相关决策取代；其中定制 Electron/Chromium Fork 供应链目标继续有效，但 Browser Use 细节进入后续独立 change。

## Battle Status

### Battle 1：Renderer Skill 生命周期控制（已裁决，2026-09-22）

- 状态：已裁决。
- 目标：让 local Renderer 的暂停、继续和人工接管控件通过真实 Runtime Skill 生命周期生效，同时保持 Runtime 通道与 Renderer 隔离。
- 最终方向：扩展 Runtime 合同和 Preload 白名单，新增类型化 `controlSkill(invocationId, command)`。
- 被否方案：将 Skill 暂停/继续错误映射为任务 interrupt/continue；local 模式继续绑定 Mock SkillGateway 或把现有功能控件降级为视觉占位。
- 主要理由：选定方案保持现有 UI 语义、统一 Skill 生命周期和生产组合根真实性，不制造伪成功，也不混淆任务与单次 Skill 调用的控制边界。
- 用户覆盖：无。

### Battle 2：桌面集成测试的落地层与 Electron 原生依赖（已裁决，2026-09-22）

- 状态：已裁决。
- 目标：让 6.5 覆盖"提交目标 → 收到时间线事件 → 中断 → 继续 → 等待用户恢复 → 应用退出清理"的真实桌面路径，且全部数据来自 Mock Provider。
- 最终方向：6.5 实现为 Electron local 模式的 Playwright 集成测试；把 7.1 中 Electron ABI 原生依赖部分前移为 6.6，先建立 Electron ABI 的 `better-sqlite3` 原生产物与加载规则，再补测试。
- 被否方案：只做进程内（vitest）桌面集成测试；把 Electron local 模式冒烟全部推迟到打包之后。
- 主要理由：证据显示仅进程内测试无法覆盖 Electron utility process 的真实约束——本 change 已因此暴露 `runtime-entry` 具名导入 `parentPort` 导致入口无法加载，以及 `better-sqlite3` 为 Node ABI（137）而 Electron 38 utility process 需要 ABI 139 的启动崩溃。用户已裁决优先取得真实桌面证据。
- 主要权衡：Node 单测与 E2E 需要不同 ABI 的原生绑定，因此必须区分 Node 默认绑定与 Electron 专用产物，并让缺失或不匹配的产物在 local 模式启动时显式失败；代价是新增一条原生构建步骤和产物路径。
- 用户覆盖：无。
- 重新开启条件：Electron 专用原生产物无法在受支持的 macOS 架构上稳定产出，或产物加载规则与打包方案冲突。
