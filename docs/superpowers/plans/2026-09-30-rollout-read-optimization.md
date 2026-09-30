# Rollout 读取与续读优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 降低长会话请求查找与连续续读的重复计算，同时保持 rollout 的持久化、顺序与恢复行为。

**Architecture:** 日志继续作为唯一事实源。请求索引由一个内部所有者同步维护；单请求事件视图从日志派生，在连续追加时更新，失配时丢弃重建，并以硬上限控制内存。只有实测收益达标才改动读取器。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest、better-sqlite3、JSONL。

**Spec:** `docs/superpowers/specs/2026-09-30-rollout-read-optimization-design.md`；OpenSpec：`openspec/changes/archive/2026-09-30-optimize-rollout-replay-and-lookups/`。

## Global Constraints

- 全部直接在 `main` 工作；仅暂存本变更文件。
- 每行写入后 `fsync`、JSONL/SQLite 格式、Stream 协议、事件标识与 cursor 语义均保持不变。
- 迭代期只运行定向测试和必要的 typecheck；准备最终提交时才各运行一次全量 `pnpm typecheck`、`pnpm lint`、`pnpm test`。
- 包内逻辑测试放在 `apps/local-runtime/tests/`，不放在根 `tests/`。
- 每项性能优化须在相同环境的真实 store 基准中改善目标路径至少 20%，且不能显著增加写入延迟或内存峰值。

## Review Focus

- 同一任务出现重复请求或幂等键时，查找结果须与改动前首次匹配一致；Task 2 测试。
- 请求元数据更新后缓存事件的 ID、responseId 和 messageId 不得滞留；Task 3 测试。
- 其他请求的行穿插追加时，当前请求的事件 sequence 和 cursor 不得跳号；Task 3 测试。
- 残缺尾行与跨块中文不得被误当完整记录；Task 4 测试。
- 缓存超限、被驱逐或重开后，重放结果须与从日志完整派生一致；Task 3 测试。

---

### Task 1: 基线与行为基准

**Files:**
- Create: `apps/local-runtime/benchmarks/rollout.bench.ts`
- Modify: `apps/local-runtime/tests/unit/rollout/session-store.test.ts`
- Record: `openspec/changes/archive/2026-09-30-optimize-rollout-replay-and-lookups/verification.md`

**Interfaces:**
- Consumes: `RolloutSessionStore`, `RolloutWriter`, `deriveRolloutEvents` 当前接口。
- Produces: 固定样本生成器与基线结果；后续任务复用同一数据、命令和 Node 24 环境。

- [ ] **Step 1: 写固定数据集与测量入口**：覆盖 1/100/1000 个请求、100/1000/10000 条事件，临时目录与相同随机种子；准备阶段只做一次持久化写入，计时阶段记录查找、首次续读、256 条分页、重开和 RSS 峰值。基准文件不进入 `pnpm test` 的 `*.test.ts` 全量套件；结果写入 `verification.md` 而不设易抖动的 CI 时间断言。
- [ ] **Step 2: 运行基线**：`PATH=/opt/homebrew/bin:$PATH corepack pnpm vitest bench apps/local-runtime/benchmarks/rollout.bench.ts --run`；记录机器、Node 版本、中位数和 P95。
- [ ] **Step 3: 增加等价性测试**：在 `session-store.test.ts` 对同一请求的实时、分页和重开事件做逐字段比较，包含交错请求、重复键、追加新行和残缺尾行。运行该文件确认当前实现通过，保留为后续任务的行为护栏。

### Task 2: 请求索引

**Files:**
- Create: `apps/local-runtime/src/rollout/request-index.ts`
- Test: `apps/local-runtime/tests/unit/rollout/request-index.test.ts`
- Modify: `apps/local-runtime/src/rollout/{store-context,session-store,read,write,recovery}.ts`

**Interfaces:**
- Produces: `RolloutRequestIndex`，提供 `getByRequestId(id)`、`getByTaskId(id)`、`getByIdempotencyKey(key)`、`upsert(request)` 与 `values()`；内部主 Map 按 requestId，两个辅助映射按首次插入顺序处理重复键。
- Consumes: `PersistedStreamRequest` 与启动时的 `projection.listStreamRequests()`；外部 Repository 接口不变。

- [ ] **Step 1: 写 RED 测试**：验证从既有请求重建、首次匹配、覆盖同一 requestId 后旧键失效、新键可查，以及新请求不覆盖已有重复键的首项。运行 `request-index.test.ts`，确认因尚无类而失败。
- [ ] **Step 2: 实现最小索引**：在 `request-index.ts` 管理三个映射；把所有 `requests.set` 改为 `upsert`，把任务/幂等键线性查找改为索引调用。运行 `request-index.test.ts` 与 `session-store.test.ts`，确认通过。
- [ ] **Step 3: 性能复测**：按 Task 1 的相同样本记录查找与写入延迟。收益不足 20% 或写入明显退化时撤回该性能改动，在 `verification.md` 写明数据；否则保留并勾选 OpenSpec 2.1/2.2。

### Task 3: 有界事件视图

**Files:**
- Create: `apps/local-runtime/src/rollout/request-event-view.ts`
- Test: `apps/local-runtime/tests/unit/rollout/request-event-view.test.ts`
- Modify: `apps/local-runtime/src/rollout/{event-bridge,store-context,session-store,read}.ts`

**Interfaces:**
- Produces: `deriveRolloutEventsForLine(line, request, stateAfter, sequence)`，由完整折叠与连续追加共同调用；`RequestEventView` 提供 `append(line, stateAfter)`、`listAfter(cursor, limit)` 与 `invalidate()`，缓存管理者限制驻留请求数和估算字节数。
- Consumes: Task 2 的请求索引与现有 `RolloutSessionState`；不改变 `EventRepository` 接口。

- [ ] **Step 1: 写 RED 测试**：同一记录经完整折叠和逐行追加得到完全相同的事件字段；运行 `request-event-view.test.ts`，确认缺少增量入口而失败。
- [ ] **Step 2: 提取共用派生函数并转 GREEN**：`deriveRolloutEvents` 改为调用该函数；定向测试确认原事件输出不变。
- [ ] **Step 3: 写缓存 RED 测试**：覆盖重复分页不再折叠旧行、其他请求插入、追加本请求新行、元数据变化、游标失配、容量驱逐和重开回退；测试同时比较完整派生结果。
- [ ] **Step 4: 实现有界视图并转 GREEN**：`listForRequestAfter` 从缓存读取或完整派生，连续追加更新已驻留视图；硬上限超出即驱逐，不写磁盘。运行 `request-event-view.test.ts`、`session-store.test.ts` 和 Agent Runtime 的 `stream-event-delivery` 定向测试。
- [ ] **Step 5: 性能复测**：按 Task 1 的相同样本记录首次与连续续读、写入延迟、RSS 峰值。目标路径未改善至少 20% 或资源显著回退时撤回缓存，保留等价性测试并记录原因；否则勾选 OpenSpec 3.1–3.3。

### Task 4: 条件式读取器与最终验收

**Files:**
- Modify if measured: `apps/local-runtime/src/rollout/log.ts`
- Test if measured: `apps/local-runtime/tests/unit/rollout/rollout.test.ts`
- Record: `openspec/changes/archive/2026-09-30-optimize-rollout-replay-and-lookups/verification.md`

**Interfaces:**
- Consumes: `readRollout(filePath, byteOffset)`，返回类型和 `validBytes` 语义不变。
- Produces: 若达到收益门槛，改为有界分块原始读取；否则保持原实现并记录测量。

- [ ] **Step 1: 测量重开峰值**：按 Task 1 的大日志样本记录原始 Buffer 分配与 RSS。若分块读取不足以改善峰值至少 20%，在 `verification.md` 记录并结束本项。
- [ ] **Step 2: 若满足门槛，先写 RED 测试**：对大日志断言单次原始 Buffer 分配不超过 64 KiB，同时覆盖跨块中文、换行、无效中间行、残缺尾行及非零 byteOffset，比较 `lines`、`validBytes`、`truncated`；确认分配上限测试在当前实现上失败。
- [ ] **Step 3: 实现分块读取并转 GREEN**：保留解析与首个坏行停止语义，定向运行 `rollout.test.ts` 和 `session-store.test.ts`，复测峰值；若收益未达标回退实现，仅保留有价值的行为测试。
- [ ] **Step 4: 最终定向验收**：运行 rollout 相关测试、Agent Runtime 事件投递及 StreamSessionService 定向测试和必要的包级 typecheck；检查 `git diff --check`，记录数量与前后基准。
- [ ] **Step 5: 准备单次提交**：在 Node 24 下各运行一次 `pnpm typecheck`、`pnpm lint`、`pnpm test`，按运行时影响决定是否追加本地 E2E。只暂存本变更文件，把命令结果写入 `verification.md` 或提交信息后提交。全量命令不在迭代步骤运行。

## Self-Review

本计划对应 OpenSpec 1.1–5.2：先基线与等价性，再请求索引、事件视图、条件式读取器，最后验证与提交。Task 2/3 的内部接口只由 rollout 包使用；性能门槛不足时保留测量与测试、撤回无收益实现。五项 Review Focus 均有对应测试步骤。
