## Context

见 `proposal.md` 的 Why。当前五个目标源码文件共约 4,011 行；Desktop renderer 的服务文件平铺在同一目录。`StreamSessionService` 同时管理活动请求、幂等创建、附件绑定、轮次执行与事件投递；`LangGraphRunner` 的图定义和工具节点共享 runner 中的观察者及中断状态；`RolloutSessionStore` 同时管理日志、投影、请求缓存、读取与恢复。`database.ts` 内含 16 个连续迁移及打开流程。现有调用方使用 `@action-driver/agent-runtime` 的根入口与既有子路径、`@action-driver/contracts` 根入口，以及 Desktop 和 local-runtime 的相对路径。

现有 `rollout-persistence` 规范要求 JSONL 日志是唯一权威事实源，SQLite 只是可重建投影；`runtime-event-recovery` 与流协议要求重连和恢复保持事件顺序。本变更不改变这些行为要求。当前 `main` 无未提交改动；部分未归档 OpenSpec 变更仍引用旧目录名，实施时不改写它们的规划内容。

## Goals / Non-Goals

**Goals:** 六处结构整理在一个变更和一次最终提交中完成；每个新模块有单一职责、类型化的输入输出和可定向测试的边界；状态和副作用的唯一所有者明确；现有运行行为、对外事件与导出保持兼容。

**Non-Goals:** 不改变 Agent 决策逻辑、UI 交互、HTTP/WebSocket 协议、rollout 格式、数据库迁移内容与版本、模型或 Skill 契约；不新增依赖，也不迁移数据所有权到其他进程。

## Decisions

### 1. 一次完成，按依赖顺序落地

用户已在 Battle 中明确选择方案 B：六项在同一变更中完成，建立模块间窄接口，并更新调用方。可执行替代方案 A 是保留所有现有入口，只搬出局部函数并分阶段提交，回归面较小，但结构边界不够明确。Agent 原推荐 A；用户在获悉更广引用调整及流式/恢复回归风险后选择 B。实现可分内部步骤与定向验证，但规划、最终提交和归档对应同一 OpenSpec change。

### 2. Stream Session：编排者持有生命周期，职责模块通过上下文协作

`StreamSessionService` 保持对外 `handle`、`cancelTask`、`close`、快照与审批入口，独占 `active`、`activeSessions` 和事件交付实例。请求创建模块负责幂等检查、会话/模型与附件校验绑定、初始记录构造及持久化；轮次执行模块负责 Graph 调用、增量内容/工具事件提交、终态与成品登记；历史模块仅从仓储读取已终止轮次并转换模型输入。三者通过显式依赖对象和结果类型传值，不各自复制活动请求表。事件身份、写入、发布顺序集中在明确的协作接口，尤其保留 accepted 先于 response.start、持久化先于发布、取消与终态清理的时序。新增对需要复用的模块子路径导出；既有 `stream-session-service` 子路径及根导出仍兼容。

### 3. Graph：状态、工具节点和纯逻辑分离

`graph/state.ts` 定义 Annotation、路由与运行限制；`graph/tool-execution.ts` 封装工具调用节点及其依赖接口；`graph/helpers.ts` 放置无副作用的活动标题、图片过滤、输入提示等函数。`agent-graph.ts` 保留 `LangGraphRunner`、图装配、观察者生命周期、中断/继续入口和 `GraphToolRuntime` 对外形状。工具模块只接收执行所需的 gateway、registry、policy、observer 与状态，不反向导入 runner；观察者和控制器仍由 runner 持有。既有子路径和根导出继续可用，新增子路径仅暴露有真实调用需求的稳定接口，不把 Graph 内部状态公开为产品契约。

### 4. Desktop：功能组内放实现与 mock

`services/agent-session/` 收纳适配器、流客户端、流投影、运行时 Agent HTTP API 和会话 mock；`services/model-connections/`、`services/agent-files/` 分别收纳对应 Desktop/Runtime 实现及 mock。任务目录、Skill、插件服务按其实际职责成组；通用 HTTP 客户端放在明确的共享传输位置。`computer-use-guidance` 中的 React hook 按使用职责归到 hooks，纯任务判定函数归会话组。容器、页面、组件与单测引用直接指向新模块，不留一层层旧路径转发文件。测试继续位于 Desktop 包自己的 `tests/`，与功能组对应。

### 5. Rollout：一个状态所有者，分离读写恢复流程

`RolloutSessionStore` 继续是 `StreamSessionRepository` 的唯一入口，并独占日志 writer、折叠后的 session state、请求/任务映射、序号水位与 `RolloutProjection`。`rollout/read.ts` 负责从已折叠状态构造任务、消息、工具、事件和快照；`rollout/write.ts` 负责把操作映射为领域行并通过 store 提供的唯一追加能力提交；`rollout/recovery.ts` 负责根据未结束轮次生成终态草稿，仍经相同追加能力持久化。模块间以窄的 `RolloutStoreContext`/回调协作；不创建第二个缓存、writer 或投影。写入顺序保持先追加日志、再折叠/投影、再派生流事件；恢复不重跑工具，保持幂等。

### 6. Database 与 Contracts：定义拆分，入口稳定

把 1–16 号迁移定义放进 `database/migrations/`，以静态有序清单组合；历史 SQL、版本和名称保持逐项一致。`database.ts` 仍导出 `RuntimeMigration`、`DEFAULT_RUNTIME_MIGRATIONS`、`openRuntimeDatabase` 和 `createRuntimeDatabase`，负责配置、备份、连续性校验和事务执行。迁移定义只依赖数据库类型或局部纯辅助函数，避免反向导入打开入口。

`contracts` 拆成消息内容与排序、任务投影、Skill、会话服务等主题模块；主题间依赖方向固定，避免通过 `index.ts` 互相引用。`index.ts` 统一再导出原有全部值、类型和函数，保持名称、运行时身份及导入路径兼容；对导出清单进行自动比对。新增内部文件不等于新增对外行为。

## Risks / Trade-offs

- [用户选择 B 覆盖 Agent 推荐 A，移动代码和引用更广，可能遗漏边界调用方] → 先盘点源码、测试、包导出和构建引用；分职责移动后运行定向测试与 typecheck，提交前执行全量验证。
- [请求创建/轮次执行拆分改变幂等、取消、重连或事件发布顺序] → 保留单一生命周期所有者；覆盖 accepted/start、运行中快照、重连、取消、终态与失败清理的定向用例。
- [Graph 工具节点抽离后丢失观察者、授权或易失图片的生命周期] → 通过窄上下文显式注入；保留现有 Graph 工具、Skill、中断和错误脱敏用例。
- [rollout 读写恢复分离产生双事实源或重复派生] → 所有路径共用 store 的状态及唯一 append；用重开、投影重建、序号与中断恢复测试验证。
- [迁移重排使既有库升级失败] → 比对 1–16 的版本、名称、SQL 与顺序；运行数据库迁移定向测试及实际运行时集成验证。
- [Desktop 目录迁移影响 Vite/Electron 构建或 mock 装配] → 更新所有引用，运行容器、页面、服务定向测试及适用本地/打包端到端验证。

## Migration Plan

先记录现有导出与迁移清单，再按 Contracts、Database、Rollout、Agent Runtime、Desktop 的依赖顺序进行内部改动与定向验证。所有六项通过后，准备同一提交：只在此时一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，并针对运行时与桌面打包路径运行适用的端到端验证；记录命令、通过/失败/跳过数量和限制。验证完成后归档 OpenSpec change，再只暂存并提交本任务文件及归档记录。若实施中出现新的数据所有权、协议或不可逆决策，暂停相关写操作并重新 Battle、更新规划。回退该提交即可回退结构变化；不涉及数据迁移。
