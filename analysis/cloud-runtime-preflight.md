# Action-Driver 云端服务预研：Runtime 复用边界与抽离优先级

- 评估日期：2026-09-30。
- 状态：待裁决，仅供讨论；不是已批准的设计或实施计划。
- 授权：本轮只做只读分析与规划产物，未修改产品代码、未运行全量测试。
- 输入来源：`apps/agent-runtime/src/*`、`openspec/specs/agent-tool-runtime/spec.md`、`docs/codex-alignment-assessment.md` 第 3/9 节，以及 `openspec/changes/replace-sqlite-store-with-rollout-jsonl`（用户 2026-09-30 已裁决，其存储改造已落地在工作区）。
- 下游产物：宿主引导与装配边界已固化并进入 `openspec/changes/split-runtime-host-bootstrap` 的 apply 阶段；下文有关启动函数内联装配的代码锚点记录的是实施前基线。
- 未决：云端的产品形态、目标用户、部署位置（自建/托管）、数据所有权、身份模型、阶段顺序均未裁决。

## 0. 任务分类与依据

本任务属**决策型（架构型）**。判断依据：它改变模块职责、进程/部署边界、数据所有权、安全约束，并存在多个后果不同的合理方案，失败会造成显著返工（`docs/governance/agent-battle-protocol.md` 的任务分类）。

因此本轮按 Battle 顺序只完成"事实收集 → 质疑 → 替代方案 → 比较 → 推荐"。**Battle 未完成**：目标与成功标准只有部分明确，用户尚未裁决。本文件不构成实施授权，也不改变 `docs/codex-alignment-assessment.md` 的任何结论。

## 1. 现状事实（代码锚点）

先固定几条决定结论的事实，避免"看起来能复用"的误判。

| 事实 | 证据 | 对云端的意义 |
| --- | --- | --- |
| Runtime 已经是一个 loopback HTTP + WebSocket 服务，而不是只靠 Electron IPC | `service/http-service.ts:119` 起 `node:http` 服务并挂 `@hono/node-server`；`service/websocket-service.ts:39` 挂 `ws`；desktop 渲染进程通过 `runtime-http-client.ts` + `RuntimeConnectionInfo{wsUrl,protocol,accessToken}` 访问 | "服务面可复用"不是设想，是现状。Electron 依赖集中在**启动器**，不在业务 |
| Agent 执行核心只依赖 ports，不依赖 Electron/Node 宿主 | `agent-graph.ts:150` `LangGraphRunner` 的构造参数是 `ModelGateway` / `SkillRegistry` / `BaseCheckpointSaver` / `GraphToolRuntime`；`ports.ts:285` `GraphRunner`、`ports.ts:327` `RuntimeAdapters` | 执行流程可整段复用，前提是注入另一套 port 实现 |
| 装配已经显式注入，且拒绝回退到 mock | `composition-root.ts:9`、`local-adapters.ts:30`；`createRuntimeServices` 在 local 模式没有 adapters 时直接抛错 | 抽离缺口不是"缺接口"，而是"缺一个可替换的装配根" |
| Electron 耦合点很少且已参数化 | 全仓库 `parentPort` 仅 `runtime-entry.ts:5`、`runtime-process.ts:57/441/455/456`（外加与宿主无关的 `web-open/extract-worker.ts` 的 worker_threads）；`startAgentRuntimeProcess(parentPort, databasePath, exit, environment)` 已接收注入的 `environment` | 宿主引导拆分是**小改**，不是重写 |
| parentPort 只承担"就绪上报 + 关闭指令"两件事 | `runtime-process.ts:456` 上报 `runtime.ready` 与服务描述符；`441/455` 只处理 `runtime.shutdown` | 可用一个极小的 host 端口替代，不需要通用事件总线 |
| 存储接口层已就绪，但装配仍内联在启动函数 | `ports.ts:341` 已定义宿主无关的 `RuntimeRepositories`；`local-adapters.ts` 已改为依赖该接口；`runtime-process.ts` 已改用 `RolloutRuntimeRepositories`（rollout 日志 + `rollout-state.sqlite`/`rollout-history.sqlite` 投影）并通过 `ACTION_DRIVER_RUNTIME_DATA_ROOT` 驱动，但仍在 `startAgentRuntimeProcess` 内联构造 `openRuntimeDatabase`、`SqliteRuntimeRepositories`、`RolloutSessionStore`、资产/输入/输出存储、`createSqliteCheckpointer` 与模型连接文件 | **存储接口抽离已完成**（rollout 变更）；剩下的是"装配入口收敛为单一工厂"，属宿主拆分同一变更 |
| 单写者是显式设计 | `runtime-ownership.ts` `claimRuntimeOwnership` 用 `runtime_process_owner` 表 + PID 活性做单进程独占；rollout 设计决策 5 写明"每会话单写者 + 跨进程锁文件" | 多实例路线必须与"每会话单写者"一致，而不是简单水平扩展 |
| 执行环境是 macOS 专属 | `session-sandbox.ts:117` 非 darwin 直接 `SandboxUnavailableError`，profile 写死 `system.sb`、拒绝 `/Users`、禁止 localhost 出站；`execution/runtime-paths.ts` 要求 `process.platform === 'darwin'` 且存在 `runtimes/darwin-<arch>` 与 `bin/rg`，否则 `RUNTIME_ARCH_UNSUPPORTED` | 云端（Linux 容器）是**新实现**，不是抽象 |
| 运行中状态大量驻留单进程内存 | `agent-graph.ts:152` `activeControllers`/`modelObservers`/`toolObservers`/`streamRequestIds`；`stream-session-service.ts:59-60` `active`/`activeSessions`；`stream/event-delivery.ts:15` `publicationTails`/`publishedCursors` | 多实例下取消、审批、会话互斥会失效 |
| 快照输出依赖进程内状态 | `stream-session-service.ts:788` `isActive: (candidate) => this.active.has(candidate)`；`event-delivery.ts` 的 `hasPendingApprovals` 是构造期常量 | 同一请求在不同实例上的快照可能不同 |
| 中断/取消只按"本进程是否持有该请求"生效 | `stream-session-service.ts` `cancelTask` 在 `this.active` 里查找；`LangGraphRunner.interrupt(taskId)` 只作用于本地 `activeControllers` | 跨实例取消需要额外通道或粘性路由 |
| 认证是进程级单 token，没有身份/租户 | `service/http/http-request-policy.ts` 用 `tokenDigest` 常量时间比较 + `rendererOrigin`；`/readyz` `/healthz` 免鉴权；`ServiceHttpOptions.token` 是单个字符串 | 多租户不是"加个 claim"，是**新子系统** |
| 可观测性已经是 OTLP，端点可配 | `packages/observability/src/otel.ts` 读 `OTEL_EXPORTER_OTLP_ENDPOINT`；`http-service.ts` 透传 `traceparent`（`withRemoteTraceparent`） | 云端导出基本可用，缺的是租户维度与集中审计 |
| 凭据加密已经是端口 | `model-connections/credential-cipher.ts` 的 `SecretCipher`，且源码注释已注明"cloud assembly would use a managed key" | 端口在、实现要换（KMS + 多租户存储） |
| 能力协商已有雏形 | `placement/*`（host 注册、remote host 声明、bindings、leases）、`service/local-capability-service.ts`、`skill-registry.ts`；desktop 通过 `skill-provider-host.ts` 反向提供 skill 执行 | 云端需要新的 host kind；桌面"本机 skill 提供者"在云上没有对应物 |

## 2. 问题一：哪些部分可以整段复用

结论分三层：**可以整段复用**、**复用逻辑但要换实现**、**不可复用**。

### 2.1 可以整段复用（逻辑与协议不变）

| 复用单元 | 证据 | 说明 |
| --- | --- | --- |
| Agent 执行图 `agent-graph.ts` | `LangGraphRunner` 只依赖 4 个构造参数 | LangGraph/StateGraph 结构、工具循环、活动标题、截图挥发性消息处理与宿主无关；默认 `MemorySaver` 说明 checkpointer 本就是可替换点 |
| `ports.ts` 全套端口 | `GraphRunner`、仓储、`ModelGateway`、`SkillRegistry`、`Clock`、`IdGenerator` | 这就是云端要实现的契约面；不需要新增第二套接口 |
| 工具/技能调用内核 | `tool-invocation-service.ts`、`tool-registry.ts`、`tool-policy.ts`、`tool-invocation-state-machine.ts`、`tool-activity.ts`、`tool-error-exposure.ts`、`tool-result-redaction.ts`、`skill-registry.ts` | 只依赖 `ToolInvocationPersistence` 等端口，无宿主假设 |
| 流会话编排 `stream-session-service.ts` | 依赖 `StreamSessionRepository`、`GraphRunner`、`IdGenerator` 与可选 IO 端口 | 逻辑可复用；它的内存映射是 4.4 的多实例问题 |
| 流协议与投递 | `packages/runtime-contracts/src/stream-protocol.ts`（`action-driver.stream.v2` + zod 解析）、`stream/event-delivery.ts`、`stream/stream-snapshot.ts` | 线上协议与客户端契约稳定，重连按 cursor 重放本来就是设计目标 |
| HTTP/WS 服务面 | `service/http-service.ts`、`service/http/*`（路由、错误映射、请求策略）、`service/websocket-service.ts` | Hono + `node:http` + `ws` 在任意 Node 云环境中可跑；只有鉴权模型要换 |
| 契约包 | `packages/contracts`、`runtime-contracts`、`plugin-contracts`、`model-connections`、`observability` | 纯 DTO/schema；`model-connections` 用 fetch 传输，`observability` 用 OTLP，都已云端友好 |
| 装配模式 | `composition-root.ts` + `local-adapters.ts` | "显式注入、无隐式回退"是可复用的做法；`local-*` 本身是本地实现 |

### 2.2 复用逻辑但必须换实现

- **存储**：`ports.ts` 的仓储接口可复用；`SqliteRuntimeRepositories`（`repositories.ts:36`）、`openRuntimeDatabase`（`database.ts:433`）、`createSqliteCheckpointer` 是本地实现，云上是"共享持久化 + 多写者/单写者亲和"。
- **checkpointer**：端口在（`BaseCheckpointSaver`），但云端需要跨实例可见的 checkpointer，否则 `continue`/`provideInput` 必须粘到原实例。
- **凭据**：`SecretCipher` 端口复用，key 来源从 env 换成托管密钥服务。
- **可观测性**：端口与 exporter 复用，加租户/任务属性与集中审计。
- **能力协商**：`placement/*` 的 router/host 模型复用，加 `cloud` host kind。

### 2.3 不可复用（须在云上新建）

- 桌面启动链：`runtime-entry.ts`（`parentPort` 硬依赖）、`apps/desktop/src/main/runtime-supervisor.ts`（`utilityProcess.fork`）。
- 执行环境：`execution/session-sandbox.ts`（macOS sandbox-exec profile）、`execution/runtime-paths.ts`（darwin 打包运行时）、plugin staging + `plugin-host.mjs` 的打包 Node 拉起方式。
- 桌面专属能力：`computer-use/*`、`browser-desktop`、`web-open/*`（jsdom/readability 与桌面宿主）、`plugins/desktop-resource-port`、`plugins/command-port`、Electron 插件面板 preload。
- 本地运行库与单写者独占：`native-binding.ts`（Electron ABI 的 better-sqlite3）、`runtime-ownership.ts`。
- 身份/多租户/配额/调度：仓库内没有任何对应实现。

## 3. 问题二：需要提前抽离的边界与优先级

优先级口径：**P0** = 现在做成本低、且是其余工作的前置；**P1** = 现在做成本低、但不做也能推进（做则省一次返工）；**P2** = 云立项后按真实需求做。

### 3.1 宿主引导与传输层拆分 — P0（最高）

**现状**：`runtime-entry.ts:5-7` 在拿不到 `process.parentPort` 时直接抛 `Agent Runtime requires an Electron parentPort`；`runtime-process.ts:56` 的函数签名已把 `parentPort`、`databasePath`、`exit`、`environment` 全部参数化。

**为什么是边界**：云端启动器的生命周期（信号、探针、容器退出码）与 Electron utility process 完全不同。传输层本身已经拆好了——真正的耦合只剩"引导/就绪/关闭"这三个控制动作。

**最小抽离动作（低成本）**：

1. 把"build wiring + 启动服务 + 返回 `{ ready, close }`"重命名为宿主无关的 `createAgentRuntime(options)`，去掉 `parentPort` 入参。
2. 加一个极小的生命周期端口（例如 `onReady(descriptor)` / `onShutdown(handler)`），实现两个适配器：`electron-parent-port-host`（保持现有行为）与 `node-process-host`（SIGTERM/SIGINT + 进程退出码）。
3. `runtime-entry.ts` 退化为 Electron 适配器；新增一个纯 Node 入口。

**可验证收益（现在就成立）**：不启动 Electron 也能起 Runtime 并跑既有 HTTP/WS e2e，CI 与本地调试更快；这也让"云上第一版 = 同一 bundle 换启动器"成为可能。

**反例/风险**：如果把它做成新接口层而始终只有一个实现，就变成"单实现接口"缺陷。因此这里只做**装配函数参数化 + 两个薄适配器**，不引入抽象基类或事件总线。

### 3.2 存储装配 — P1（接口已就绪，只需收敛装配入口）

**现状（rollout 变更落地后）**：`openspec/changes/replace-sqlite-store-with-rollout-jsonl` 已把会话历史改为 rollout JSONL + SQLite 投影，并在 `ports.ts` 引入宿主无关的 `RuntimeRepositories`；`local-adapters.ts` 已不再依赖具体存储实现，`runtime-entry.ts` 已从单库文件路径改为 `ACTION_DRIVER_RUNTIME_DATA_ROOT` 数据根。也就是说，**"存储接口抽离"这一项已经完成**，比原计划更早满足。

**剩余问题**：具体实现仍在 `startAgentRuntimeProcess` 内联构造——`openRuntimeDatabase`、`claimRuntimeOwnership`、`SqliteRuntimeRepositories`、`RolloutSessionStore`、`RolloutRuntimeRepositories`、资产/输入/输出存储、`createSqliteCheckpointer`、模型连接文件，全部在同一个启动函数里按 `dataRoot` 拼路径。

**最小动作（并入宿主拆分，不另开抽象）**：

1. 把存储构造收敛成**一个具名工厂**（例如 `createRuntimeStorage({ dataRoot }) → { repositories, checkpointer, assets, inputs, outputs, close() }`），装配根只调用它。
2. 让调用方只提供数据根，不再自行拼接文件布局（桌面端已按 6.3 完成一半）。

**优先级**：P1——与宿主引导拆分同一个变更完成即可；单独抽离一次、再在宿主拆分时改一次，等于多做一次返工。

### 3.3 执行环境 — P2（云立项后，独立适配器）

**现状**：macOS sandbox-exec、darwin 打包运行时、会话独立工作目录（`session-workspace.ts` 拒绝绝对路径/`..`/符号链接）、插件用打包 Node 拉起。`docs/codex-alignment-assessment.md` 第 9 节已指出"当前 Electron parentPort 启动、macOS 沙箱和运行时路径需要拆为核心 Runtime、桌面启动适配器与远程/云端执行适配器"。

**判断**：云上（Linux 容器）没有可复用的沙箱或运行时路径，抽接口只会得到"两个完全不同语义的实现套一个签名"。可用的边界已经存在：`ToolExecutionContext.workspace` 与 `SessionSandbox`/`runtime-paths` 的调用点都在装配根。

**现在唯一的低成本动作**：不要把这些假设进一步扩散到 `agent-graph`、工具内核或 ports；保持"执行环境由装配根注入"的现状（已经满足）。

### 3.4 单进程内存状态：粘性路由 vs 外置共享状态 — P1（先定契约）

需要处理的进程内状态：

| 状态 | 位置 | 失效表现 |
| --- | --- | --- |
| 请求/会话活动表 | `stream-session-service.ts:59-60` | 跨实例 `session-busy` 互斥失效；同一会话可能并发两个 turn |
| 取消/中断 | `agent-graph.ts:152`、`StreamSessionService.cancelTask` | 取消只能打到持有该请求的实例 |
| 观测者注册 | `agent-graph.ts` `modelObservers`/`toolObservers` | 续跑/审批恢复必须回到原实例 |
| 投递游标与队列 | `stream/event-delivery.ts:15` | 仅影响活跃连接的实时推送；重连本就走持久化重放 |
| 审批 broker / Computer Use 门闸 / 已加载 Skill / 挥发性截图 | `runtime-process.ts` 装配块 | 审批本身是桌面能力，云上不存在 |
| 凭据 cipher key、placement host 表 | `runtime-process.ts` | 每实例独立，需要共享或重新协商 |

**推荐策略**：**按 sessionId 粘性路由 + 每会话单写者**，与 rollout 设计决策 5 一致。理由：重放/快照本来就读持久化（`StreamEventDelivery.release()` 明确写着"so a later resume replays from persistence"），所以**唯一真正跨实例的状态就是"谁在跑这个 turn"与"怎么取消它"**。

**如实记录的缺口**（当前代码不能靠"重放一切"解决）：

- `snapshot()` 的 `isActive` 依赖进程内 `active`；`hasPendingApprovals` 是构造期常量 → 同一请求在不同实例可能得到不同快照内容。
- `cancelTask` 与 `GraphRunner.interrupt` 都是进程内的。
- `activeSessions` 是唯一的并发门闸；持久化里 `previous.status === 'running'` 只能覆盖崩溃后的重启，覆盖不了多实例竞态。

**替代方案**：外置共享状态（Redis/队列做取消与审批，Pub/Sub 做 WS 扇出）。收益是任意实例可服务任意请求；代价是引入新基础设施、把"单写者 + 可重放日志"的简单模型复杂化，且当前没有证据表明需要无亲和调度。

**结论**：现在只做两件低成本的事——(1) 在设计中把"一个会话同一时刻只有一个写者"写成显式契约；(2) 把"取消/中断需要到达持有者"记录为已知约束。真正的路由/共享状态等云立项。

### 3.5 凭据、审批/同意、可观测性、能力协商、身份/多租户

| 维度 | 现状 | 云端需要的性质 | 档位 |
| --- | --- | --- | --- |
| 凭据 | `SecretCipher` 端口 + env key；存储在 SQLite | 托管密钥、按租户隔离、可轮换、可撤销 | 端口现在就有；实现云立项后做 |
| 审批/同意 | 已裁决"新调用自动执行"，`waiting_approval` 仅作历史；逐应用审批只用于桌面 Computer Use | 若云上要人工审批，需要新的审批协议与恢复语义 | **决策型**，需单独 Battle，不要现在假设 |
| 可观测性 | OTLP + traceparent 透传 | 租户/会话属性、集中审计、导出器鉴权 | 基本可用；租户维度云立项后做 |
| 能力协商 | `placement/*` host 注册、bindings、leases；desktop 反向提供 skill 执行 | `cloud` host kind；无桌面时 skill 不可用要显式失败（现有 `resolveSkill` 已返回 `CAPABILITY_UNAVAILABLE`） | 模型可复用；新 host kind 云立项后做 |
| 身份/多租户 | 单进程单 token；无 user/tenant/owner 字段；`claimRuntimeOwnership` 是单机文件锁 | 用户、租户、组织、配额、审计归属 | **纯新建**，不是抽象 |

## 4. 问题三：三档归类

### 4.1 现在就该抽离的低成本缝隙

1. **宿主引导拆分（P0）**：`createAgentRuntime(options)` + Electron/Node 两个薄 host 适配器；`runtime-entry.ts` 退化为适配器。已立项为 `openspec/changes/split-runtime-host-bootstrap`。
2. **存储装配收敛为单一工厂（P1，已并入同一变更）**：存储接口层由 rollout 变更完成；本项只剩把内联构造收敛为一个具名工厂。
3. **把"每会话单写者 + 取消需到达持有者"写成显式契约（P1）**：文档与类型注释即可，不改运行行为。
4. **服务配置对象收敛（P1，可选）**：`ServiceHttpOptions` 已是大对象，可在宿主拆分时顺手把"传输参数"与"业务端口"分开，避免云端装配误传本地字段。

这四项都不改变对外 `action-driver.stream.v2` 协议，也不改动已裁决的 rollout 范围。

### 4.2 云端立项后再做

1. Linux 执行适配器：沙箱、打包运行时路径、进程/PTY、插件 host 拉起。
2. 身份、租户、配额、审计归属；从单 token 迁移到真正的认证授权。
3. 托管密钥与按租户凭据存储。
4. 跨实例 checkpointer 与共享状态/路由策略（按届时是否真的需要无亲和调度决定）。
5. WS 扇出与多实例实时投递（若不做粘性路由）。
6. 可观测性的租户维度与集中审计导出。

### 4.3 纯新建（不是抽象）

1. Worker 调度与容器/沙箱生命周期（创建、准备、维护、回收）。
2. 远端持久化、对象存储、跨区域备份与恢复。
3. 网关、TLS、会话亲和、限流与配额执行。
4. 多租户数据模型、隔离与迁移。
5. 云端审批/同意协议与 UI。
6. 计费、用量与成本归集。

## 5. 问题四：现在不建议做的事（YAGNI）

依据：本仓库优化口径明确"单实现接口、包单构造函数的工厂、隐藏逻辑的间接层按缺陷处理"；设计模式基线要求"（模式）解决的是本仓库已观察到的真实问题，不是预期问题"。

1. **不要为存储/checkpointer/执行环境预先定义第二套接口**。`ports.ts` 已经是接口；现在再抽一层只会与已裁决的 rollout 变更互相冲突，且没有第二个实现来验证签名是否正确。
2. **不要引入 Redis/Kafka/Postgres 抽象、Unit of Work、ORM 或分布式事务**。现有模型是"单写者 + 可重放追加日志"，加这些东西会同时放大复杂度和不一致风险。
3. **不要做"本地/云双模式开关"塞进现有装配根**。把云端分支写进 `runtime-process.ts` 会污染唯一一条已验证的本地启动路径，并让失败难以定位。云端应是独立装配根（新 app/入口），复用 packages。
4. **不要提前做多租户 schema 迁移**。设计尚未裁决，且 rollout 变更正在同时改存储格式。
5. **不要把 Computer Use / Browser 抽象成"云端可替换能力"**。它们是桌面宿主能力，云端不操作用户本机 GUI 的既有裁决仍然有效。
6. **不要把 parentPort 换成通用事件总线或插件化宿主协议**。目前只需要"就绪 + 关闭"两个动作。
7. **不要预先支持 K8s/Serverless 双目标或自动伸缩**。没有负载证据。
8. **不要为了"看起来对齐云端"而替换 Hono、`ws` 或流协议**。这些恰好是最值得保留的部分。

## 6. 推荐与代价比较（Battle 推荐，未裁决）

### 替代方案

| 方案 | 内容 | 收益 | 代价/风险 |
| --- | --- | --- | --- |
| A：现在全量抽离 | 给存储、执行环境、宿主、身份都定义端口+双实现骨架 | "提前准备好" | 与已裁决 rollout 变更冲突；大量单实现接口；无第二实现验证签名；返工风险最高 |
| B：零抽离 | 云立项时一次性改存储+引导+执行+身份 | 现在零成本 | 变更集中爆发；本地启动路径与云端耦合在同一处修改；调试面最大 |
| C（推荐）：只抽宿主与装配缝隙 | `createAgentRuntime` + host 适配器；存储装配收敛为单一工厂；把单写者/取消约束写成契约 | 成本低、可立即验证（无 Electron 起服务）；云端只需换启动器与装配实现 | 仍会在云立项时新增执行环境与身份子系统，但那时是**新增**而非**重写** |

### 推荐

**采用 C**。具体排序：

1. 宿主引导拆分（P0，最小、解锁最大）。
2. 存储装配收敛为单一工厂（P1，并入同一变更；接口层已由 rollout 变更完成）。
3. 记录"每会话单写者 + 取消需到达持有者"契约（P1，文档级）。
4. 其余全部推迟到云端立项。

### 主要风险

- 宿主拆分若被做成新抽象层而非装配参数化，会引入单实现接口缺陷。
- 若装配入口不在同一次宿主拆分中收敛，云端将来会二次改动同一批调用点（3.2 已给出两条规避约束）。
- "粘性路由"在需要无亲和调度（例如抢占式调度、自动伸缩回收实例）时会失效；届时要么补共享控制通道，要么补扇出。这应在云立项时按真实调度模型重新 Battle，而不是现在猜。
- 身份/多租户是全新子系统，不能沿用 loopback token 模型（`docs/codex-alignment-assessment.md` 第 9 节已明确）。

### 重新开启条件

- 云端目标用户、部署位置或调度模型发生变化；
- rollout 变更落地后存储接缝与本文假设不符；
- 出现需要无亲和调度、跨实例取消或云端人工审批的真实需求；
- 官方协议或依赖发生不兼容变化。

## 7. 建议的成功标准（供裁决参考）

若采纳推荐 C，前三项各自可验证的验收标准：

1. 不安装/不启动 Electron，用纯 Node 入口启动 Runtime，既有 HTTP/WS 定向 e2e 通过；`runtime-entry.ts` 中不再出现业务装配逻辑。
2. `runtime-process.ts` 不再直接构造存储实现，只调用一个存储工厂；rollout 变更已完成的接口层与数据根参数化在其上收尾。
3. 设计文档明确写出"单会话单写者"与"取消/中断的持有者语义"，并对多实例场景列出已知失败模式。
