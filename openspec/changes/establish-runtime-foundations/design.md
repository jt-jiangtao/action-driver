## Context

参见 `proposal.md` 的 Why。当前仓库是 pnpm Workspace：Electron Main 仅管理窗口，Preload 只暴露环境信息，Renderer 通过 InversifyJS 直接绑定 `MockAgentRuntime` 与 `MockSkillGateway`；`packages/contracts` 中的任务、Skill 和 UI 投影均为手写 TypeScript 类型。仓库尚无 Go 模块、协议代码、SQLite 数据库、Sidecar 进程管理或定制 Electron 构建来源。

Phase 0 必须在不改变已确认首页和任务页、不接入真实 Browser Use 的前提下建立生产运行时边界。最终 Agent 位于 Go Sidecar，内嵌浏览器由 Electron/Chromium 侧持有，因此协议必须支持“桌面端向 Agent 发命令”和“Agent 向桌面能力提供者请求 Skill”两个方向。所有生产数据默认保存在本地；Renderer 继续保持纯 Web 环境。

## Goals / Non-Goals

**Goals:**

- 让 Electron Main 能可靠启动、探活、监督和关闭与应用一同分发的 Go Agent Service。
- 建立可版本化、可代码生成、支持命令与事件流的 Electron ↔ Go UDS 协议。
- 建立 SQLite schema、原子迁移与 Sidecar 单写者模型。
- 将现有 Skill 抽象提升为 Go Runtime 管理的 Registry，同时保持 Browser Use 与 Computer Use 独立。
- 建立定制 Electron Fork 的版本与产物供应链，使后续 Chromium 补丁有稳定落点。
- 保留 Mock Runtime 作为组件测试、视觉回归和无 Sidecar 开发模式。

**Non-Goals:**

- 不实现模型供应商配置、Jev 决策算法或可执行 Agent 推理循环。
- 不实现真实 Browser Skill 提供者、网页导航、Action Graph、Node Handle、增量观察或动作执行。
- 不实现 AXUIElement、CGEvent、ScreenCaptureKit 或 Swift 原生服务。
- 不修改首页和任务页视觉，不新增设置、错误中心、账号、安全隐私或遥测页面。
- 不在本 change 中制作生产签名、公证、自动更新或发布服务。

## Decisions

### 1. 进程所有权固定为 Renderer → Preload → Main → Sidecar

Renderer 只消费 `AgentCommandService`、`AgentSessionRepository` 和只读投影；Preload 只暴露命名明确的 Agent API 与订阅，不暴露 `ipcRenderer` 或通用 `invoke`；Electron Main 拥有 Sidecar 进程、UDS 客户端、桌面 Skill Provider 和 Renderer IPC；Go Sidecar 拥有 Agent Runtime、Skill Registry、事件日志与 SQLite。

未来 Browser Skill 的物理实现位于 Electron/Chromium 侧，但逻辑调用始终由 Go Runtime 发起：Runtime 写入 `queued`，经双向协议向 Electron Main 的 Browser Provider 请求执行，Provider 回传状态和结果，Runtime 再持久化并发布统一事件。Computer Use 后续可由另一 Provider 接入，不需要让 Browser Skill 依赖 Swift 服务。

备选方案是让 Renderer 直接连接 Sidecar，或把 Agent Runtime 写在 Electron Main。前者破坏安全边界并让窗口各自管理连接，后者不符合 Go + Eino 选型，二者均不采用。

### 2. 使用 Protobuf + gRPC over Unix Domain Socket

协议源文件放在 `proto/action-driver/runtime/v1/`，使用 Buf 管理 lint、breaking check 与 Go/TypeScript 代码生成。Go 使用官方 gRPC 实现；Electron Main 使用纯 JavaScript 的 gRPC 客户端，避免原生 Node ABI 依赖。生成代码分别进入 Go 内部协议包与 `packages/runtime-protocol`，生成物提交仓库，CI 重新生成并检查 drift。

首个协议面包含：

- `RuntimeControl.Handshake`、`Health`、`Shutdown`；
- `AgentCommand.SubmitGoal`、`InterruptTask`、`ContinueTask`；
- `RuntimeEvents.Subscribe`，使用持久化游标恢复；
- `SkillProvider.Register` 与双向 `Execute` 流，为 Browser/Computer Provider 留出统一入口。

每个 envelope 包含 `protocol_major`、`protocol_minor`、`request_id`、`session_id`、deadline 与明确的错误码。主版本不一致直接拒绝；次版本通过能力协商决定可用字段。事件以数据库游标作为顺序依据，客户端确认最后应用游标，重连从 `cursor + 1` 开始。

备选方案是自定义 length-prefixed JSON。它初期依赖较少，但会重复实现 schema 演进、流控、错误模型和双向流，且 Action Graph 增量数据后续更难优化，因此不采用。HTTP/TCP 也不采用，因为本阶段通信只发生在同机进程间。

### 3. Sidecar Supervisor 只存在于 Electron Main

Main 新增 `SidecarSupervisor`，状态为 `stopped | starting | ready | degraded | stopping | failed`。它负责解析当前架构对应的二进制、创建本次运行专属目录与 socket、生成会话令牌、spawn 子进程、执行握手、监控退出和清理资源。同一 Electron app 只有一个 supervisor，所有窗口共享其 `RuntimeClient`。

运行目录位于 `app.getPath('userData')/run/<app-instance-id>`，目录权限为当前用户私有，socket 不使用固定全局路径。会话令牌通过子进程环境传递并在首次握手校验，用来避免同一用户会话中的错误进程连接；这只是本地进程基线，不扩展为首版安全隐私体系。

异常退出采用有界重启：60 秒窗口内最多 3 次并带短退避；超过上限进入 `failed`，不会无限拉起。正常退出先停止接收新命令，调用 `Shutdown`，等待固定超时后再终止进程。开发测试可注入 `SidecarProcess` 和时钟端口，不依赖真实子进程。

生产包内携带 `darwin-arm64` 与 `darwin-x64` 的纯 Go 二进制；使用无 CGO 的 SQLite 驱动，使 Sidecar 能在 Docker 中交叉编译并由 macOS 冒烟验证。最终用户不需要 Docker 或 Go。

### 4. SQLite 由 Go Sidecar 独占，事件日志是投影来源

数据库位于 `app.getPath('userData')/data/action-driver.db`，路径由 Main 在启动参数中明确传递。Sidecar 使用单一数据库拥有者接口，启用 foreign keys、busy timeout 和 WAL。Electron 任何进程都不直接打开数据库。

首版 schema 包含：

- `tasks`：任务标识、标题、状态、时间戳；
- `messages`：角色、内容与任务内顺序；
- `steps`：步骤顺序、状态和详情；
- `skill_invocations`：Skill、输入、提供者与当前状态；
- `runtime_events`：单调游标、聚合标识、事件类型、版本化 payload 和时间戳；
- `schema_migrations`：已应用版本与校验值。

命令处理使用事务同时更新当前状态与追加事件；UI 投影由持久化状态读取，实时更新来自事件流。迁移以嵌入 Go 二进制的只前进 SQL 文件执行，每个版本独立事务并校验 checksum。迁移失败时 Sidecar 不进入 ready，不尝试用未知 schema 继续运行。

备选方案是 Electron 侧 SQLite 或多个进程共享数据库。它们会引入写锁竞争、迁移所有权不清和双语言业务规则，因此不采用。首版不做加密、云同步和跨设备合并。

### 5. Go Runtime 以端口隔离 Eino、Registry 与 Provider

`services/agentd` 采用以下边界：

```text
cmd/action-driver-agentd/   进程入口与依赖组装
internal/app/              生命周期与配置
internal/transport/        gRPC 服务和协议映射
internal/runtime/          Agent 命令、会话与事件编排
internal/skills/           Registry、调用状态机、Provider 会话
internal/storage/          仓储端口、SQLite 实现和 migrations
internal/einoadapter/      Eino 图与模型端口适配
```

Eino 只出现在 `einoadapter`，领域层不导入具体模型或框架类型。Phase 0 提供可注入的确定性 Runtime Driver，用于验证任务命令、事件和 Skill 调度；真实 Jev loop 与模型提供者留给 Phase 1。Registry 以稳定 `skill_id + contract_version` 注册能力，Browser 与 Computer Provider 分别上线和下线，互不改变对方状态。

未注册 Skill 返回 `CAPABILITY_UNAVAILABLE`，不得用 Mock 成功结果掩盖生产缺失能力。Mock 只存在于明确的测试/设计模式中。

### 6. 保留领域 contracts，协议类型不进入 React 组件

`packages/runtime-protocol` 只包含生成的 wire 类型和 gRPC client；`packages/contracts` 继续保存 UI 可消费的领域 DTO 与端口。Electron Main 的 Runtime Adapter 在两者之间映射，Preload 再暴露结构化克隆安全的 DTO。

现有同步 `AgentSessionRepository.getTask()` 将演进为异步读取，并增加按任务订阅的显式取消句柄；React 层通过 adapter 保持页面组件只接收投影。Renderer 组合根支持两种绑定：

- `mock`：继续绑定当前确定性 Mock，用于单元测试、视觉回归和 Figma 验收；
- `local`：绑定 Preload IPC Adapter，用于 Sidecar 集成测试和生产。

运行模式由 Main 的构建配置决定，不由页面或用户输入决定。Skill Gateway 的生产实现属于 Main/Sidecar 桥接，不把 gRPC client 注入 Renderer。

### 7. 定制 Electron Fork 使用独立源码仓库与本仓库锁定清单

完整 Electron/Chromium 源码不进入当前产品仓库。维护独立的 Action-Driver Electron Fork；本仓库保存 `toolchains/electron-fork/manifest.json`、补丁目录索引、产物清单 schema 与验证脚本。manifest 固定 Electron tag、Chromium revision、Fork commit、patch-set id、目标架构和协议兼容版本。

Fork 仓库使用有序 patch queue 保存 Action-Driver 差异。Phase 0 只建立无行为改动的基线构建与消费链路；Action Graph 等补丁由下一 change 增加。产物按 `electron-version/fork-commit/platform-arch` 发布，并附 SHA-256、构建环境和 patch-set 元数据。产品生产打包必须验证清单，不允许回退到 npm 公版 Electron。

Docker CI 负责 manifest/schema、patch 元数据、协议 codegen 和通用测试。Electron/Chromium 的 macOS 编译与运行测试需要 Apple 工具链，因此在固定 Xcode/macOS runner 完成；这被视为 CI 的平台构建阶段，而不是要求最终用户安装 Docker。

备选方案包括把 Chromium 源码作为 submodule 放入产品仓库，或只维护一个不可重放的 Fork 分支。前者会显著放大 checkout 和日常 CI 成本，后者无法审查与升级补丁，因此不采用。

### 8. 采用分层、可替换的验证策略

- 协议：Buf lint/breaking、生成物 drift、Go/TypeScript golden fixtures、主版本不兼容测试。
- Sidecar：使用临时 UDS 的 Go 集成测试；Main 以 fake process、fake clock 和 fake runtime client 验证状态机、重启上限与关闭。
- SQLite：临时数据库运行全量迁移、重复启动、事务回滚和旧 schema 升级测试。
- Skill Registry：注册/下线 Browser 与 Computer Provider、未注册能力、生命周期顺序和事件持久化测试。
- Electron：macOS 冒烟验证实际 Sidecar 二进制启动、握手、任务命令、事件订阅和退出清理；现有视觉回归继续使用 Mock，不因运行时测试产生不稳定截图。
- Fork：Docker 校验清单与补丁索引，macOS runner 验证基线构建、产物校验值和应用消费。

## Risks / Trade-offs

- [gRPC 双向流在 Electron 打包环境中出现连接或打包差异] → 使用无原生扩展客户端，增加打包后应用的真实 UDS 冒烟，并保持协议适配器可替换。
- [事件流重连造成重复 UI 更新] → 以持久化游标和幂等投影应用为唯一顺序依据，明确区分“收到”与“已应用”。
- [Sidecar 异常退出损坏正在写入的数据] → 所有状态变更使用 SQLite 事务，启动时执行一致性检查，超出重启预算后停止自动重启。
- [协议 DTO 与 UI DTO 漂移] → wire 类型只存在于 adapter 层，使用映射契约测试和序列化 golden fixture 固定边界。
- [Fork 构建昂贵导致反馈过慢] → 日常 Docker CI 校验清单和 patch metadata；只有上游或 patch-set 变化触发完整 macOS 构建，并复用内容寻址缓存。
- [Phase 0 被误扩展为 Browser Use] → 验收只允许能力注册、Mock Provider 和基线 Fork；任何真实网页动作或 Chromium 行为补丁进入独立 change。
- [无 CGO SQLite 驱动与原生驱动性能存在差异] → Phase 0 以正确性与可移植构建优先，并用代表性事件写入基准设定后续切换阈值。

## Migration Plan

1. 引入协议源、生成包和兼容性检查，不切换现有 Renderer Mock。
2. 建立 Go Sidecar、确定性 Runtime Driver、SQLite migrations 和临时 UDS 集成测试。
3. 在 Electron Main 加入 Supervisor、Runtime Client、IPC Handler 和 Preload 白名单 API，以 `local` 集成模式打通端到端链路。
4. 保留 `mock` 模式运行现有组件与视觉测试；生产组合根改用 `local`，并在 Sidecar 不可用时返回明确错误而非自动回退 Mock。
5. 建立 Fork manifest、独立仓库基线和 macOS 产物构建；产品打包切换到经过校验的 Fork 产物。
6. 完成 Docker 与 macOS 分层 CI 后，才允许后续 Browser Use change 在 Fork 上增加内核补丁。

若迁移失败，产品构建可回退到本 change 之前的 Mock-only 版本；数据库变更在 Sidecar ready 前完成且不做破坏性降级。已创建的新版数据库不由旧版应用打开，回滚测试使用备份或独立测试数据目录。
