## Context

参见 `proposal.md` 的 Why。当前仓库是 pnpm Workspace，包含 Electron Main、Preload、React Renderer、领域 contracts 和确定性 Mock Runtime。Go/Eino 实现已经回退，但旧 `establish-runtime-foundations` change 仍记录了原方案。新的 Runtime 必须保持已确认 UI 不变、历史只在客户端，并为后续 Browser/Computer Skill 提供隔离边界。

LangGraph JavaScript 的 checkpointer 会在图的 superstep 保存状态，`thread_id` 用于关联一系列 checkpoint，`interrupt()` 可保存状态并在收到 `Command({ resume })` 后继续。Electron 官方建议需要从 Main 派生 Node 子进程时优先使用 `utilityProcess`，它支持 `MessagePort` 双向通信。设计基于这些正式能力，不自行实现另一套图执行器或开放网络端口。

## Goals / Non-Goals

**Goals:**

- 建立可随 Electron 打包的本地 TypeScript Agent Runtime，并与 Renderer、Main 和具体 Skill Provider 解耦。
- 使用 LangGraph 表达可恢复 Agent Loop，统一任务 checkpoint、等待用户、中断、继续和事件投影。
- 使用客户端 SQLite 保存历史、业务事件和 LangGraph checkpoint，远程模型只承担推理。
- 使用 InversifyJS 分别组装 Main 与 Runtime 组合根，并保留确定性测试绑定。
- 为 Browser Use 与 Computer Use 提供独立 Provider 注册和双向调用通道。

**Non-Goals:**

- 不实现真实模型供应商、Prompt/Jev 决策质量或完整生产 Agent 策略。
- 不实现 Playwright/Electron Fork 接入、网页导航、Action Graph、Page Memory、Procedure Memory 或零 Token 重放。
- 不实现 AXUIElement、CGEvent、ScreenCaptureKit 或 Native Browser Engine。
- 不修改首页、任务页和已确认视觉状态。
- 不实现账号、用户校验、云同步、计费、遥测或远程会话存储。

## Decisions

### 1. Runtime 作为 `apps/agent-runtime` 独立 UtilityProcess

进程拓扑固定为：

```text
React Renderer
    ↓ 白名单 Preload API
Electron Main
    ↔ RuntimeClient / SkillProviderHost
Agent Runtime UtilityProcess
    ↔ ModelGateway（远程推理，无历史所有权）
    ↔ SQLite（本地历史与 checkpoint）
```

Electron Main 使用 `utilityProcess.fork()` 启动打包后的 Runtime 入口，同一应用实例只保持一个 Runtime。Main 拥有窗口、WebContentsView 和未来桌面 Provider；Runtime 拥有 Agent 图、Registry、仓储和模型适配端口。Renderer 不直接连接 Runtime。

选择 UtilityProcess 而不是把 LangGraph 放进 Main，是为了让模型请求、图执行、SQLite 和潜在长任务不会阻塞或污染窗口生命周期。选择它而不是普通 `child_process.fork()`，是因为 Electron 为 UtilityProcess 提供明确的打包、进程度量和 MessagePort 集成。它仍然是受信任的应用代码，不加载第三方任意脚本。

### 2. 使用 MessagePort 上的版本化 RPC，移除 gRPC/Protobuf

Main 创建专属 `MessageChannelMain`，将一端交给 UtilityProcess。`packages/runtime-contracts` 保存 TypeScript discriminated union、Zod schema、协议版本和领域映射。消息分为：

- `handshake.request/response`；
- `command.request/response`：submit、interrupt、continue、provide-user-input、get-task；
- `event.subscribe/ack/item`：基于持久化 cursor 恢复；
- `skill.register/unregister/execute/result/cancel`：Runtime 向 Main 的反向调用；
- `runtime.shutdown`。

每个请求包含 `requestId`、`protocolVersion`、`deadline` 和 payload；入站消息必须在分派前通过 schema 校验。主版本不一致拒绝连接，次版本通过 capability 集合降级。超时请求进入终态，迟到响应只记录诊断信息。

同为 TypeScript 后，继续维护 Protobuf/gRPC codegen 会增加打包与协议映射成本，且 MessagePort 已满足应用内单机双向通信，因此不保留旧传输栈。若未来 Runtime 需要脱离 Electron 独立部署，应新增网络适配器，而不是让当前 Renderer 接触网络协议。

### 3. LangGraph 只负责 Agent 工作流，不拥有产品全部状态

Runtime 使用 `StateGraph` 构建最小图，首个可验证图包含：`acceptGoal → plan → resolveSkill → invokeSkill → verifyOutcome → finish`，并允许路由到 `awaitUser` 或 `failed`。图状态只保存执行所需的原始领域数据：`taskId`、`threadId`、目标、消息引用、当前阶段、待执行 Skill、等待原因、错误和最后 checkpoint 标识。

LangGraph 的 `thread_id` 使用稳定 task id。需要用户信息时使用 `interrupt()`；收到输入后用 `Command({ resume })` 继续。用户主动中断不等同于 LangGraph 的 HITL interrupt：Supervisor 将 AbortSignal 传播给当前模型或 Skill 调用，Runtime 停止调度新节点，并从最近已提交 checkpoint 标记任务为 `interrupted`。继续命令从该 checkpoint 恢复。

不使用 LangChain `createAgent` 作为核心，因为它会隐藏 ActionDriver 需要显式控制的 Skill 解析、权限检查、UI 事件和接管状态。`@langchain/core` 只用于必要的模型消息与适配器类型；业务领域不导入具体模型供应商类型。

### 4. SQLite 同时保存业务记录和 LangGraph checkpoint

数据库位于 `app.getPath('userData')/data/actiondriver.db`，路径由 Main 在启动 Runtime 时传入。Runtime 是唯一写入进程，启用 WAL、foreign keys 和 busy timeout。业务 schema 包含 tasks、messages、steps、skill_invocations、runtime_events 和 schema_migrations；LangGraph 使用官方 SQLite checkpointer 的表保存 checkpoints 与 pending writes。

业务事件以单调 cursor 排序，并记录 `thread_id + checkpoint_id + event_key` 唯一键。图执行流在 checkpoint 提交后由 ProjectionService 幂等写入业务投影；若进程在两者之间退出，启动 reconciliation 会比较最新 checkpoint 与已投影 checkpoint 并补齐缺失事件。这样不要求跨 LangGraph 内部写入和业务仓储建立不可控的分布式事务，同时保证 UI 不遗漏或重复应用事件。

数据库迁移在 Runtime ready 前执行，只允许前进。Mock 模式使用临时数据库或内存适配器，不访问用户数据。

### 5. Renderer、Main 与 Runtime 分别使用 InversifyJS 组合端口与适配器

`apps/agent-runtime` 的容器只绑定 Runtime 端口：GraphRunner、CheckpointStore、TaskRepository、EventRepository、ModelGateway、SkillRegistry、Clock 和 IdGenerator。Electron Main 容器绑定 RuntimeSupervisor、RuntimeClient、SkillProviderHost、BrowserSkillProvider 占位和 ComputerSkillProvider 占位。Renderer 前端保留独立的 InversifyJS composition root，绑定 AgentCommandService、AgentSessionRepository 和 SkillGateway；React 根节点通过类型化 Context 注入一次解析出的 `AppServices`，页面和组件只接收服务接口，不直接导入 Container、不使用 service locator，也不自行 `new` 基础设施适配器。

三个进程层的组合根都支持明确的 `mock` 与 `local` 绑定：Renderer 的 mock 绑定现有 MockAgentRuntime，local 绑定 Preload Runtime Adapter；Main 的 mock 绑定进程内测试替身，local 绑定 UtilityProcess Supervisor；Runtime 的 mock 绑定确定性模型与内存仓储，local 绑定 SQLite 和远程模型适配器占位。运行模式由应用构建配置决定，不由用户输入切换。测试只能通过组合根 override 替换依赖，避免在 React 组件中散落条件分支。

### 6. Skill Registry 保存逻辑请求与实际 Provider

Runtime Registry 以 `skillId + contractVersion` 接收调用，以 `providerId + providerVersion` 记录实际执行者。Browser Use 与 Computer Use 分别注册、下线和取消，互不依赖。Main 持有 Provider 实现，Runtime 只持有元数据和反向 RPC stub。

当前 change 只注册 Mock Provider 并验证协议。后续 Browser Use change 可注册 `browser-use.playwright`；Native 阶段再注册 `browser-use.native`。两者必须保留各自的引擎接口、引用品牌类型与执行策略，只在高层任务请求、报告和评测指标上统一，不在本 change 中设计共同的底层 BrowserGraphProvider。

### 7. 模型边界保持远程无状态

ModelGateway 接收一次推理所需的消息、工具描述、模型参数和请求标识，返回结构化模型输出或流式增量。任务历史和 checkpoint 不上传为远程持久化对象；Runtime 根据图节点需要从本地仓储构造最小上下文。

Phase 0 默认使用 DeterministicModelGateway 验证图和恢复。真实远程适配器及凭据管理进入后续 change，避免在尚无账号、安全隐私体系时引入不可验收的生产网络依赖。

### 8. Supervisor 使用有界恢复和显式关闭

Supervisor 状态为 `stopped | starting | ready | degraded | stopping | failed`。异常退出后在 60 秒窗口内最多重启 3 次；超过预算进入 failed。退出应用时先停止新命令，发送 shutdown，等待数据库写入完成，然后关闭 MessagePort；超时后调用 `kill()`。

开发测试通过注入 ProcessFactory、RuntimeClientFactory、Clock 和 FileSystem 端口验证状态机，不启动真实 Electron Helper。macOS 打包冒烟必须验证 arm64 与 x64 应用能够找到 Runtime 入口和原生 SQLite 依赖；最终用户不需要安装 Node.js 或 Docker。

### 9. Renderer 通过单一类型化入口控制 Skill 生命周期

local Renderer 的现有暂停、继续和人工接管控件继续消费 `SkillGateway`，但生产实现不得绑定 Mock。Runtime 合同增加 `skill.control` 命令，请求仅包含 `invocationId` 与 `pause | resume | take-over`，响应返回持久化后的 `SkillExecutionEvent`。Electron Main 注册明确命名的 Agent IPC Handler，Preload 只暴露 `controlSkill(invocationId, command)`，Renderer Adapter 将其映射回现有 `SkillGateway`。

Battle 已于 2026-09-22 裁决。被否方案包括：把 Skill 暂停/继续映射成任务级 interrupt/continue，因为这会混淆恢复点和单次调用状态；在 local 组合根保留 Mock SkillGateway 或把按钮降级为视觉占位，因为这会让生产控件产生伪成功并违反既有 functional 交互契约。选定方案增加一项公共 IPC 与 Runtime command，代价是协议和测试面扩大，但保持 UI 语义、Provider 独立性与统一生命周期状态机不变。重新开启条件是 Runtime 无法以 invocation id 稳定定位持久化调用，或后续权限模型要求把人工接管拆成独立授权流程。

### 10. Electron 原生 SQLite 绑定与 local 模式桌面集成测试

Electron 38 的 utility process 使用自己的 Node ABI（本机实测 `NODE_MODULE_VERSION 139`），而 pnpm 为本地 Node 构建的 `better-sqlite3` 是另一个 ABI。二者不能共用同一份原生二进制，因此：

- Node 侧（vitest、迁移和仓储测试）继续使用 pnpm 安装的默认原生绑定，不改变现有测试回路。
- Electron 侧使用独立产物 `apps/agent-runtime/native/electron/<arch>/better_sqlite3.node`，由 `scripts/build-electron-native.mjs` 针对 Electron 版本与架构构建（node-gyp + Electron headers），不覆盖 pnpm 的 Node 绑定。
- Runtime 在 `process.versions.electron` 存在时只加载 Electron 专用产物，并通过 `better-sqlite3` 的官方 `nativeBinding` 选项注入；产物缺失或 ABI 不匹配时，local Runtime 启动失败并输出可诊断错误，不得回退到 Node 绑定或 Mock。
- 业务数据库与 LangGraph checkpointer 共用同一 `createRuntimeDatabase()` 入口，避免两处分别解析原生绑定。

Battle 已于 2026-09-22 裁决：用户选择用真实桌面路径验证 6.5，并要求提前建立 Electron 原生依赖（原 7.1 的一部分）。被否方案是只做进程内 vitest 集成测试，或把 Electron local 模式冒烟全部推迟到打包之后。选择该方案的理由是本 change 已出现两个只在 Electron 中暴露的失败：`runtime-entry` 以具名导入方式取 `parentPort` 导致入口无法加载，以及原生绑定 ABI 不匹配导致 Runtime 启动即崩。代价是新增原生构建步骤与产物所有权，以及 E2E 需要 production（local）构建。重新开启条件是 Electron 专用产物无法稳定产出，或打包方案要求不同的原生依赖布局。

## Risks / Trade-offs

- [LangGraph checkpoint 与业务投影在不同写入路径产生短暂不一致] → 使用 checkpoint 关联键、幂等 ProjectionService 和启动 reconciliation，恢复测试覆盖每个崩溃窗口。
- [SQLite 驱动包含原生模块并受 Electron ABI 影响] → 锁定 Electron/Node ABI，使用 electron-rebuild/预构建产物并在两种 macOS 架构做打包后冒烟；缺失产物时构建失败。
- [UtilityProcess MessagePort 断线造成请求悬挂] → 所有请求携带 deadline，断线统一失败 pending request，重连后从持久化 cursor 和 checkpoint 恢复。
- [用户中断发生在不可取消的外部动作中间] → Provider 契约声明取消能力；Runtime 不把“已请求取消”当作“已取消”，等待终态并在恢复前重新观察。
- [LangGraph 或 LangChain 类型泄漏到 UI 和 Skill 合同] → 框架类型只存在于 Runtime adapter；`packages/contracts` 与 `packages/runtime-contracts` 使用 ActionDriver 自有 DTO。
- [本 change 被扩展成 Browser Use 实现] → 验收仅允许 Mock Provider、注册/调用/取消和独立 Provider 标识；Playwright/Native 引擎、记忆和网页操作进入后续 change。
- [新增 Skill 控制入口扩大 Renderer 可调用面] → 只允许固定的 invocation id 与三种枚举命令，Main 与 Runtime 双重校验，拒绝通用命令名、任意状态和值未持久化的伪成功响应。
- [Electron 专用原生产物与 Node 绑定并存造成误用] → 只在 `process.versions.electron` 为真时加载 Electron 产物，缺失即启动失败；构建脚本按 Electron 版本与架构输出到独立目录，并在产物旁记录 Electron 版本、架构与构建时间的元数据，加载时逐项校验。
- [真实桌面 E2E 需要 production/local 构建，与视觉 E2E 共用 `out/`] → 视觉与 local 两套 E2E 分别执行构建与运行，不并行共享构建输出。

## Migration Plan

1. 保留当前 Mock Renderer，新增 `packages/runtime-contracts` 和协议校验测试。
2. 建立 `apps/agent-runtime`、InversifyJS 组合根、确定性模型、LangGraph 最小图和内存测试适配器。
3. 增加 SQLite migrations、官方 LangGraph SQLite checkpointer、业务仓储和 reconciliation 测试。
4. 在 Electron Main 增加 UtilityProcess Supervisor、MessagePort RuntimeClient 和 Mock SkillProviderHost。
5. 通过白名单 Preload API 接入现有领域服务，生产组合根切换为 local，视觉和组件测试继续使用 mock。
6. 增加 macOS 打包后启动、握手、任务、事件、中断恢复和退出清理冒烟，再移除旧 Go 方案残留的计划引用。

回滚时可切回 Mock-only 组合根；新版数据库不由旧 Mock 直接写入。迁移和 Runtime ready 失败必须阻止 local 模式启动，不得静默回退成伪成功结果。
