## Context

见 `proposal.md` 的 Why。当前运行时的顺序事实被拆在三处：`messages.content_json` 里的助手零件 `order`、由 `runtime_events` 重放 `reduceActivityProjection` 得到的活动时间线、以及 `apps/agent-runtime/src/agent-graph.ts` 内存里的 `activeActivityId`。三处必须一致却无机制保证，这正是「生图后工具被并进前一组」「占位槽位与并行工具刷新后漂移」的根因。

参考实现（本机 `~/.codex` 实测）：会话以 `sessions/YYYY/MM/DD/rollout-*.jsonl` 追加式日志保存，行类型为 `session_meta`、`turn_context`、`response_item`、`event_msg`、`token_usage_record`、`world_state`；SQLite（`state_*.sqlite`、`thread_history_*.sqlite`、`logs_*.sqlite`、`memories_*.sqlite`、`goals_*.sqlite`、`queue_*.sqlite`）承担投影/索引/日志/记忆/目标/队列；`thread_history_projection_state.next_rollout_byte_offset / next_rollout_ordinal` 是 rollout→SQLite 的增量投影游标，`threads.rollout_path` 指回 JSONL。官方 app-server 文档亦描述 `thread/metadata/update` 为 SQLite-backed、`thread/archive` 为移动线程日志文件。

约束：只支持 macOS 本地运行时；模型连接凭据已由受 OS 保护的密钥能力持有；现有对外流式协议 `actiondriver.stream.v2` 与 `StreamServerEvent` 需要保持不变，避免牵动 Renderer；工作区存在其他会话未提交的 `placement/*` 与 `main.tsx` 改动，本变更不得触碰或提交它们。

## Goals / Non-Goals

**Goals:**

- 用一个追加式日志作为顺序的唯一事实源，实时与重开共用同一折叠结果。
- 用一个有序 SQLite 投影承担列表、分页、快照读取，刷新永不重新推导顺序。
- 让占位（图片批次）与待执行工具成为日志中的一等项，先写后跑。
- 把工具分组边界从「仅正文」推广到「任意可见块」。

**Non-Goals:**

- 不迁移旧数据；不改写历史格式；不保留旧库兼容分支。
- 不改变对外流式协议、IPC、视觉与 e2e 交互 id。
- 不引入云端/远程存储；仍是本地单机。
- 不把 LangGraph checkpoint 引擎内部状态纳入本次改造（见 Decisions 第 8 条）。
- 不追求与 Codex 一模一样的表结构或字段名；只对齐「日志 + 投影」这一架构。

## Decisions

### 1. rollout JSONL 为权威日志，SQLite 为可重建投影

每个会话一个 append-only JSONL 文件，逐行记录用户消息、助手块、工具项、资产引用与回合边界；SQLite 只保存由日志折叠出的有序投影（thread / turn / item，键为 `rollout_ordinal`）。

布局对齐 Codex：`sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`，一行一个 JSON 对象，追加后 `fsync`。记录类型为 `session_meta`、`turn_begin`/`turn_end`、`block`（`text` | `image_batch` | `image` | `document` | `tool_group`）、`tool`。顺序即数据：行序就是因果序，写入即冻结，运行时不再重算。

理由：日志不可变，折叠是纯函数，因而实时与重开必然一致；投影提供 SQL 才有的列表、分页与检索。

替代方案：纯 SQLite 局部修补（无法消除三份顺序来源）；纯 JSONL 无投影（放弃列表/分页能力，需全量扫描）；JSONL 与 SQLite 双写互为备份（引入第二事实源与不一致风险）。三者均被否决。

### 2. 单一序号空间 + 预留槽位

每个可见块在写入时分配一次单调序号 `seq`，读取时不重算。图片批次在创建时预留 `1 + imageCount` 个槽位，第 i 张图片固定在 `batch.seq + 1 + i`；新块从所有已分配与已预留槽位之后开始。

只用一个序号空间；每个块渲染到哪个区（顶部区 = 过程正文 + 工具组，底部区 = 最终回答 + 图片 + 文档）由块的 `kind` 决定，读取方只按 `kind` 过滤再按 `seq` 排序，MUST NOT 另设两套序号。

理由：占位与乱序到达只有在「序号先于内容分配」时才能稳定。

替代方案：在图片到达时按到达顺序追加（会随后续到达顺序漂移）；用批次内相对索引而非全局序号（跨块排序仍会冲突）。

### 3. 先写后跑 + 追加式状态更新

生图批次与工具调用在执行前写入；工具与块的状态变化通过追加新行表达，折叠取同一标识的最后一条。日志行只增不改。

理由：这样刷新只依赖日志本身，不需要在内存里保留「当前打开的工具组」这类易失状态。

替代方案：就地更新 JSON（需要重写整文件，破坏 append-only 与崩溃安全）。

### 4. 分组边界 = 任意可见块

过程正文、图片批次、图片与文档都结束当前工具组；没有任何可见块隔开的连续或同轮并行工具归入同一组。

理由：直接对应用户报告的缺陷；同轮并行工具归同组符合既有 spec 语义。

替代方案：仅按轮次分组（会把跨轮但连续的工具拆开）；仅在正文处分组（即现状，无法处理图片）。

### 5. 投影带增量游标，幂等可重建

投影记录已投影到的日志字节偏移与序号；重启从游标继续；投影被删除时按日志全量重建。

理由：避免重复投影与跳项，并让「投影可丢」成为可验证的性质。

替代方案：每次启动全量重建（大历史代价高）；不记游标、按内容去重（需要第二套去重账本）。

### 6. 折叠是唯一状态函数

定义一次左折叠：`state = fold(行序列)`。实时把新行 apply 到同一 state，重开对整个文件折叠。二者调用同一函数。

理由：从构造上排除「实时与刷新分叉」。

替代方案：实时增量 reducer + 读时全量重放两套实现（现有缺陷的成因）。

### 7. 非日志数据各归其位

模型连接配置落应用数据目录的配置文件（`model-connections.json`，含加密后的密钥串，文件权限 0600）；密钥继续由受 OS 保护的凭据能力保存；图片与文件字节落文件目录，日志只存引用；侧栏列表与分页由 SQLite 投影的 `threads` 表承担，不再另建一套追加式索引，避免出现第二份顺序来源；跨进程安全由运行时所有权声明保证（同一数据目录同时只有一个运行时写者）。

二进制按内容寻址落在 `blobs/<sha256>`，日志行只保留引用与元数据（mime、宽高、字节长度）。

理由：机密与二进制既不该进日志，也不适合进投影。

替代方案：全部塞进日志（泄露与膨胀风险）；把配置留在被删除的运行时库里（与新架构不一致）。

### 8. 删除旧运行库；checkpoint 引擎状态暂留

删除 `data/actiondriver.db` 与其旁文件，不迁移。LangGraph 的 checkpoint 属引擎内部状态，与用户可见历史无关，本次保持独立文件，不在本变更范围内。

理由：用户已裁决不迁移；checkpoint 与「会话历史顺序」不是同一问题，混在一起会扩大范围。

替代方案：一并改造 checkpoint 存储（超范围，且无用户可见收益）。

### 9. 领域记录 + 记录→事件适配层（apply 期间补充裁决）

日志行保持领域化（`block`/`tool`/`turn`），同时新增一个适配层把记录确定性地还原成既有 `RuntimeEventRecord`，喂给现有 `toServerEvent`。文本记录携带增量而非全量，折叠时按序号拼接。这样 `StreamEventDelivery`、`stream-snapshot`、`reconnect replay` 与对外 `actiondriver.stream.v2` 协议都无需改动，实时与重放继续共用同一条链路。

理由：apply 时发现重连是「逐条重发持久化事件」，若日志只存折叠后的全量块状态就无法还原增量，而 specs 同时要求「保持 `StreamServerEvent` 不变」与「重放与快照一致」。适配层让日志保持 Codex 式领域记录，又不动对外协议。

替代方案：日志直接存 `RuntimeEventRecord`（协议事件）——改动最小，但日志不再是领域记录，与 Codex rollout 形态不符，被否决。

代价：`stream-session-service` 写入路径需从「构造 runtime event」改为「追加领域记录 + 派生事件」，并新增记录→事件映射；`contentIndex` 等派生字段由折叠结果计算而非写入日志。

## Battle 结论

- 类型：架构型（决策型）
- 目标：消除三份顺序来源，让占位、待执行与并行工具在实时与重开后顺序一致。
- 当前方案：rollout JSONL（权威日志）+ SQLite 带序号投影。
- 主要质疑：Codex 「其他数据」实测几乎全是 SQLite，并非纯 JSONL；仓库既有评估第 10 节亦建议保留 SQLite。用户以「对齐 Codex 真实架构、不考虑成本与迁移」覆盖该建议。
- 替代方案：纯 SQLite 修补 / 纯 JSONL 无投影 / JSONL+SQLite 双写。
- 最终决策：rollout JSONL + SQLite 投影；不迁移、直接删除旧库；在 `main` 实施。
- 主要权衡：换取单一事实源与刷新一致性，代价是无跨文件事务、查询依赖投影、损坏恢复不再由 SQLite 兜底。
- 用户覆盖：记录覆盖 [codex-alignment-assessment.md](../../../docs/codex-alignment-assessment.md) 第 10 节「保留 SQLite」的建议，及其已知风险。
- 重新开启条件：出现新证据使「日志+投影」无法满足刷新一致性，或官方协议/依赖发生不兼容变化。

## Risks / Trade-offs

- [无跨文件事务] → 日志行按「整行 + newline + fsync」原子追加；资产先落盘再写引用行；写入顺序固定为「资产 → 引用行」。
- [尾部残行 / 文件损坏] → 读取时跳过或截断到最后一个完整有效行；恢复只追加终结行，不改写历史。
- [查询能力下降] → 由 SQLite 投影承担列表、分页与检索；投影丢失时按日志重建。
- [投影与日志不一致] → 投影携带字节偏移与序号游标；重复投影按标识幂等，缺项按游标补齐。
- [并发写] → 每会话单写者；索引与投影使用跨进程锁文件。
- [日志膨胀] → 图片与文件只存引用，字节落文件目录。
- [机密泄露] → 日志与投影 MUST NOT 含明文密钥；凭据只在受 OS 保护的存储中。
- [行为回归面大] → 对外 `StreamServerEvent` 协议不变；以快照投影实现旧协议字段，端到端交互 id 不改，视觉与 e2e 规格保持。
- [其他会话的未提交改动] → 仅在本次范围内新增文件与改动；提交时排除 `placement/*`、`main.tsx` 等无关改动。
- [状态库仍保留旧会话表] → 运行时已不再读写它们（会话历史全部走 rollout），但表级删除会与仍以旧模式打开 SQLite 的既有测试套件冲突；本变更先做到「旧库文件删除 + 运行时只走 rollout」，表与旧实现的清理随任务 6.2 与其测试迁移一并完成。
- [服务级套件迁移已完成] → stream-session-service 以及其他 10 个套件已全部切到 rollout store / 复合测试存储，33/33 与整包 741 项通过。迁移过程中发现并修复的真实缺陷（只影响 rollout 路径）：桥接在折叠前跳过 session_meta 导致 response.start.model 为 null 且错误被吞后整轮静默挂起；response.start 重复派生；纯文本回合写成 parts；请求 lastSequence 停在 -1 导致运行中快照校验失败；activity 文本丢失 activityId；工具组缺少锚点块；工具 input/output/presentation 未随日志保留导致重开后画廊与详情为空；未流式输出的收尾答案丢失；legacy 工具的 callSequence 需要从事件 sequence 回退。旧实现已删除：repositories 收窄为辅助存储，tool-store 删除，迁移 v16 重建辅助表以解除对已删除会话表的引用，旧库文件在启动时删除。

## Migration Plan

1. 运行时启动时检测旧库是否存在；存在则删除 `actiondriver.db`、`actiondriver.db-wal`、`actiondriver.db-shm`，不读取、不转换。
2. 新会话从空日志开始；`sessions/`、`blobs/`、`index.jsonl` 目录按需创建。
3. 回滚策略：保留删除前的旧库副本（可选），若需回退则停止新版运行时、恢复旧库并回到本次变更之前的提交。

## Open Questions

1. 投影范围：是否只投影 thread / turn / item（当前假设），还是同时投影日志、记忆、目标、队列。
2. 索引文件是否与 Codex 一样分库（state / history / logs）命名，还是合并为单一投影库。
3. LangGraph checkpoint 是否在后续变更中一并迁移。

## Verification

提交前一次性验证（2026-09-30，`main`）：

- `pnpm typecheck`：全部工作区通过。
- `pnpm lint`：通过（含 152 条 e2e 交互声明校验）。
- `pnpm test`：**2603 passed / 11 failed / 2 skipped**。11 项失败全部位于 `packages/cua`（`tab-reference`、`browser-session`）与 `packages/browser-runtime`（`service-downloads`、`service-cdp`、`service-page-waits`、`service-command-security`），报错为 `data:` 模块导入与 `@statsig/js-client` 内联，**与本变更无关**（HEAD 基线同样失败，本变更未触碰这两个包）。
- `pnpm test:e2e:local`：**7 passed / 3 failed**，与 HEAD 基线逐条一致（失败项为 `packaged Renderer reaches the Runtime HTTP API`、`persists the selected Token Plan image API`、`keeps a wide uploaded image visible`，均为既有/环境性）。**本变更引入的 2 项 e2e 回归已修复**：根因是快照缺少助手消息——渲染层按 `messageId` 归属流式事件，找不到该消息便会丢弃包括 `response.end` 在内的全部助手事件，任务永久停留在运行中。修复方式是在 `createStreamTask` 起就写入助手消息记录，并让派生内容按 id 合并进同一条消息。
