# Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让并发任务的持久化事件连续可重放，并在 Runtime 崩溃后安全收口。

**Architecture:** SQLite 为每个请求原子分配连续序号；全局 cursor 只定位重放区间。Runtime 持有唯一生命周期状态机，Renderer 用纯投影和请求内序号消费事件。

**Tech Stack:** TypeScript、better-sqlite3、Zod、Vitest、fast-check、WebSocket。

**Spec:** `docs/superpowers/specs/2026-09-24-architecture-convergence-design.md`

## Global Constraints

- 保留 SQLite 与 LangGraph checkpointer；不自动重放可能产生副作用的工具。
- `eventId` 稳定，`sequence` 请求内连续，`cursor` 全库单调；所有请求事件走同一原子追加入口。
- 历史数据库必须可迁移或进入明确的只读/快照恢复路径；备份先于 schema 改写。
- 不覆盖现有未提交工作；实施前读取目标文件和当前 diff。

## Review Focus

- 两个请求交错提交：各请求从 `request.accepted` 到终态都无序号空洞；Task 1、2。
- 重复和乱序 WS 帧：文本及工具行只出现一次；Task 3。
- 重放窗口截断且客户端仍有缓冲：快照后只应用更高序号；Task 3。
- 工具已执行而结果未提交时崩溃：显示未知且不重试；Task 4。
- 重复启动：同一请求只产生一个中断终态；Task 4。

---

## File map

`database.ts` 只定义 schema/migration；`repositories.ts` 只完成原子读写；`stream-session-service.ts` 管理生命周期与重放策略；`renderer-stream-client.ts` 管理网络及排序缓冲；`stream-task-projection.ts` 只把有序事件转为 UI 状态。契约放 `packages/runtime-contracts/src/stream-protocol.ts`。

### Task 1: 数据库序号约束和旧库迁移

**Files:** Modify `apps/agent-runtime/src/database.ts`, `packages/runtime-contracts/src/stream-protocol.ts`; Test `apps/agent-runtime/tests/database.test.ts`.

**Interfaces:** Produce `RuntimeEventRecord.sequence: number` for request events, `UNIQUE(request_id, sequence)` and `(request_id, cursor)` index. Legacy non-request events remain nullable during migration.

- [ ] **Step 1: Write failing tests.** Add a migration test that opens a v4 database with interleaved request cursors `1,3` and `2,4`, upgrades it, and asserts each request receives `sequence=[0,1]`; add a duplicate `(request_id,sequence)` insert test that expects a SQLite constraint error.
- [ ] **Step 2: Run red.** `pnpm vitest run apps/agent-runtime/tests/database.test.ts` must fail on absent unique constraint/backfill.
- [ ] **Step 3: Implement migration.** Back up the DB before upgrade. In the next migration, backfill request events ordered by `(request_id,cursor)` using `ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY cursor)-1`, update `stream_requests.last_sequence`, then create the partial unique index; use a transaction and abort on inconsistent identifiers. Evolve Zod wire schema to require a sequence on new request events while decoding legacy DB rows separately.

  ```sql
  CREATE UNIQUE INDEX runtime_events_request_sequence_unique
    ON runtime_events(request_id, sequence) WHERE request_id IS NOT NULL;
  ```
- [ ] **Step 4: Run green and commit.** `pnpm vitest run apps/agent-runtime/tests/database.test.ts && pnpm typecheck`; stage only named files and commit `feat(runtime): migrate request event sequences`.

### Task 2: 唯一原子事件追加入口与有界重放

**Files:** Modify `apps/agent-runtime/src/repositories.ts`, `apps/agent-runtime/src/ports.ts`, `apps/agent-runtime/src/stream-session-service.ts`, `apps/agent-runtime/src/mock-adapters.ts`; Test `apps/agent-runtime/tests/repositories.test.ts`, `apps/agent-runtime/tests/stream-session-service.test.ts`.

**Interfaces:** Produce `events.appendForRequest(requestId,event)` and `events.listForRequestAfter(requestId,cursor,limit)`; `NewRequestEvent = Omit<RuntimeEventRecord, 'cursor' | 'sequence'>`. The former owns sequence allocation and returns the committed row. Callers never supply the next sequence.

- [ ] **Step 1: Write failing tests.** Interleave two requests, assert each event sequence is `0,1,2` despite global cursor gaps; assert `listForRequestAfter` returns at most the supplied limit and only that request. Add a terminal append collision test.
- [ ] **Step 2: Run red.** `pnpm vitest run apps/agent-runtime/tests/repositories.test.ts apps/agent-runtime/tests/stream-session-service.test.ts` must show the global-scan/sequence failure.
- [ ] **Step 3: Implement.** In one `.immediate()` transaction read `last_sequence`, update it with `WHERE last_sequence = previous`, insert the event with `previous+1`, and return its cursor. Replace all request-event append paths, including accepted/content/end/cancel, with this entry. Query `WHERE request_id=? AND cursor>? ORDER BY cursor LIMIT ?` via the existing index; page until the requested cap, never `listAfter(0).filter(...)`.

  ```ts
  type RequestEventStore = {
    appendForRequest(requestId: string, event: NewRequestEvent): Promise<RuntimeEventRecord>
    listForRequestAfter(requestId: string, cursor: number, limit: number): Promise<RuntimeEventRecord[]>
  }
  ```
- [ ] **Step 4: Run green and commit.** Run the two tests plus `pnpm typecheck`; stage named files and commit `feat(runtime): append and replay request events atomically`.

### Task 3: 客户端按请求序号消费和快照交接

**Files:** Modify `apps/desktop/src/renderer/src/services/renderer-stream-client.ts`, `apps/desktop/src/renderer/src/services/stream-task-projection.ts`, `packages/runtime-contracts/src/stream-lifecycle.ts`, root `package.json` and `pnpm-lock.yaml`; Test sibling `.test.ts` files and `packages/runtime-contracts/tests/stream-lifecycle.test.ts`.

**Interfaces:** Consume persisted `(requestId,sequence,cursor,eventId)`; emit each ordered event once. `StreamLifecycleGuard` checks start/content/end legality，不维护另一套连续计数。

- [ ] **Step 1: Write failing tests.** Deliver Task A cursors `1,3` and Task B cursor `2`; assert A displays both events. Then deliver A sequence `2` before `1`, resend `1`, and assert only `1,2` apply once. Snapshot with last sequence `4` must discard pending `<=4` and resume at `5`.
- [ ] **Step 2: Run red.** `pnpm vitest run apps/desktop/src/renderer/src/services/renderer-stream-client.test.ts apps/desktop/src/renderer/src/services/stream-task-projection.test.ts` must fail on cursor-gap behavior.
- [ ] **Step 3: Implement.** Change `pendingByCursor` to per-request sequence buffer, maintain `lastAppliedSequence` and its cursor, request replay on a gap, cap buffer size, and replace from snapshot on cap/retention failure. Keep event-ID dedupe bounded. Make projection idempotent and remove duplicate lifecycle state.

  ```ts
  if (event.sequence === lastAppliedSequence + 1) apply(event)
  else if (event.sequence > lastAppliedSequence + 1) buffer.set(event.sequence, event)
  // A lower sequence is an already-applied duplicate.
  ```
- [ ] **Step 4: Add property test.** Add pinned dev dependency `fast-check`; generate shuffled/interleaved events for two requests with duplicates, then assert live projection equals cursor-ordered replay for each request; pin a deterministic seed in regression failures.
- [ ] **Step 5: Run green and commit.** Run target tests and `pnpm typecheck`; stage named files and commit `fix(desktop): order streams per request`.

### Task 4: 启动恢复与未知工具结果

**Files:** Modify `apps/agent-runtime/src/runtime-process.ts`, `apps/agent-runtime/src/repositories.ts`, `apps/agent-runtime/src/stream-session-service.ts`, `packages/runtime-contracts/src/stream-protocol.ts`; Test `apps/agent-runtime/tests/runtime-process.test.ts`, `apps/agent-runtime/tests/repositories.test.ts`.

**Interfaces:** Produce `recoverInterruptedRequests(): Promise<RuntimeEventRecord[]>`, called before Runtime begins serving. Emit one `runtime.interrupted` terminal event per orphan request.

- [ ] **Step 1: Write failing tests.** Persist a running task with partial content and a tool-start event, recreate Runtime twice, assert one interrupted terminal event, preserved text, tool state `unknown`, and no tool invocation. Assert a completed task stays completed and a legacy pending approval follows its existing safe-cancellation path without executing a tool.
- [ ] **Step 2: Run red.** `pnpm vitest run apps/agent-runtime/tests/runtime-process.test.ts apps/agent-runtime/tests/repositories.test.ts` must fail on orphan recovery.
- [ ] **Step 3: Implement.** Before listeners start, transactionally select orphan `running` rows, append terminal events through Task 2's sequencer and mark task/request failed with a stable error code. Preserve checkpoint/content and mark uncommitted tool outcome unknown; do not dispatch retries. Guard status transition so repeated boot is idempotent.

  ```ts
  const recovered = await repositories.recoverInterruptedRequests('RUNTIME_RESTARTED')
  // Execute before HTTP/WS starts accepting commands.
  ```
- [ ] **Step 4: Run green and commit.** Run target tests, `pnpm typecheck`, and `pnpm test:e2e:local` after the integration fixture kills Runtime mid-stream; stage named files and commit `feat(runtime): recover interrupted tasks safely`.
