## Why

当前持久化把「顺序」同时放在三处：SQLite 消息零件里的 `order`、由 `runtime_events` 重放推导出的活动时间线、以及 Agent Graph 内存里的 `activeActivityId`。三者必须一致却没有机制保证，于是出现「生成图片后执行工具被并进前一个任务组」、占位槽位与并行工具在刷新后顺序漂移等缺陷。

用户已裁决对齐 Codex 的真实存储架构：**rollout JSONL 作为唯一权威事件日志，SQLite 作为带序号的查询投影**。这是本变更要解决的问题与选择此时做的原因——原始流式顺序缺陷不能靠局部修补优雅解决，必须把「顺序」收敛成单一事实源。

## What Changes

- **BREAKING**：删除运行时 SQLite 业务库（`data/actiondriver.db`：tasks、messages、steps、runtime_events、tool_invocations、stream_requests、session_assets 等），**不做数据迁移**，旧数据直接丢弃。
- 新增 **rollout JSONL**：每会话一个 append-only 文件，逐行记录会话事件，作为唯一权威日志；除追加外永不改写。
- 新增 **SQLite 投影**：以 `rollout_ordinal`（及其字节偏移）为序的 thread / turn / item 索引，由 rollout 增量投影得到（带字节偏移 + 序号游标）；侧栏、分页、刷新只读投影，不重新推导顺序。
- **占位与待执行**成为 rollout 里的普通项：生图批次先写 `image_batch` 行占位并预留序号，待执行工具先写 `tool` 行（`proposed`/`queued`）再执行；状态更新一律追加新行，折叠取最后状态。
- 工具分组边界从「仅正文」扩展为「任意可见块」：正文、图片批次、图片、文档都会结束当前工具组；同轮连续/并行工具仍归同组。
- 配置与密钥移出运行时库：模型连接配置落应用数据目录的配置文件，密钥继续由操作系统保护的凭据能力保存。
- **BREAKING**：移除「旧事件可安全迁移」承诺，改为「旧库直接丢弃、不迁移」。

## Capabilities

### New Capabilities
- `rollout-persistence`: 定义 rollout JSONL 日志与 SQLite 投影的存储契约：行模型、序号与预留槽位分配、状态折叠、投影游标、刷新一致性与重启安全。

### Modified Capabilities
- `runtime-event-recovery`: 事件顺序、重放、快照与重启恢复改为定义在 rollout + 投影之上；删除旧事件迁移要求。
- `codex-task-activity`: 有序正文与动态任务的顺序和归属由 block 账本决定；可见块（含图片）结束当前工具组。
- `inline-tool-activity`: 工具分组边界扩展为任意可见块；待执行与占位工具在组内持久呈现且刷新后位置不变。

## Battle Status

### 类型与分类依据

架构型（决策型）。依据 [AGENTS.md](../../../AGENTS.md) 与 [Agent Battle 协议](../../../docs/governance/agent-battle-protocol.md)：本变更改变持久化方案与数据所有权（模块职责、持久化边界、公共存储契约），并推翻既有设计约定，属于必须先完成 Battle 的决策型任务。

### 状态

**Battle 已完成并由用户裁决（2026-09-30）：采用 rollout JSONL + SQLite 投影；不迁移数据、直接删除旧库；在 `main` 分支实施。**

证据基础：

- 本机 `~/.codex` 实测确认 Codex 真实架构是「JSONL rollout 日志 + 多个 SQLite 投影/状态库 + 文件」，并非「JSONL 数据库」；`thread_history_projection_state.next_rollout_byte_offset / next_rollout_ordinal` 是 rollout→SQLite 的增量投影游标，`threads.rollout_path` 指回 JSONL。
- 官方文档（`learn.chatgpt.com/docs/app-server`）佐证：`thread/metadata/update` 描述为 SQLite-backed，`thread/archive` 描述为移动线程日志文件。
- 仓库既有评估 [codex-alignment-assessment.md](../../../docs/codex-alignment-assessment.md) 第 10 节曾建议「保留 SQLite，不为了相似立即改为 JSONL」，本次由用户覆盖。

被否决方案：纯 SQLite 局部修补（原方案 A）；纯 JSONL 单账本、无投影（上一轮方案）；SQLite 索引 + JSONL 双写。

用户覆盖的已知代价（记录于 design.md 的 Risks / Trade-offs）：无跨文件事务、查询需依赖投影、损坏恢复不再由 SQLite 兜底、每会话单写者与索引锁、图片必须走引用、既有评估结论被推翻。

### 仍未裁决的分歧

以下子项尚待用户确认，**不作为既定范围**，其默认取值记录于 design.md 并标注为假设：

1. 投影范围：是否只投影 thread/turn/item（推荐），还是同时投影日志、记忆、目标、队列。
2. JSONL 与投影的关系：JSONL 为权威、投影可重建（推荐），还是双写互为备份。
3. 分库命名：是否照搬 Codex 的 state / history / logs 分库形态。

## Impact

- 代码：`apps/agent-runtime/src/{database.ts,repositories.ts,ports.ts,stream-session-service.ts}`、`apps/agent-runtime/src/stream/*`、`apps/agent-runtime/src/persistence/*`、`apps/agent-runtime/src/media/*`、`apps/agent-runtime/src/computer-use/app-approval-store.ts`、`apps/agent-runtime/src/model-connections/*`、`apps/agent-runtime/src/runtime-ownership.ts`、`apps/agent-runtime/src/sqlite-checkpointer.ts`、`apps/agent-runtime/src/runtime-process.ts`、`apps/desktop/src/main/runtime-paths.ts`。
- 测试：`apps/agent-runtime/tests/unit/{database,repositories,stream-session-service,local-adapters,runtime-process,sqlite-checkpointer,persistence-guard}.test.ts` 及 media/computer-use 相关定向测试；提交阶段按仓库规范运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`。
- 契约：新增 rollout 行 schema 与投影 schema；`StreamServerEvent` 对外协议保持不变，快照改由投影生成。
- 依赖：投影仍用 SQLite，`better-sqlite3` 保留；不新增外部依赖。
- 数据：删除现有 `data/actiondriver.db` 及其 `-wal`/`-shm`；不做迁移。
