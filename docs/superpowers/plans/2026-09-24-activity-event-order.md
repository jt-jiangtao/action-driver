# Ordered Activity Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make activity titles runtime-owned and render process text, tools, and final answers in persisted event order across live streaming, reconnect, and snapshots.

**Architecture:** Keep the existing SQLite event `cursor` as the only ordering authority. The Graph emits activity and stable text-item events; tools keep their existing `callId` and `activityId`. A pure activity reducer drives both server snapshots and renderer live updates, while cumulative assistant messages remain conversation state rather than a second process-rendering path.

**Tech Stack:** TypeScript, LangGraph, SQLite (`better-sqlite3`), Zod stream contracts, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-activity-event-order-design.md`; OpenSpec change `openspec/changes/fix-activity-timeline-fallback`.

## Global Constraints

- Do not add a model call, third-party dependency, new display `sequenceNumber`, or `outputIndex`.
- Never advertise `activity_update` to a model or create a synthetic tool result for a title change.
- Persist before broadcasting; order by `cursor`, not `occurredAt` or client arrival time.
- Preserve raw local tool I/O without a `NODE_ENV` branch and keep approvals above the composer.
- Work on the user-requested `main` checkout; preserve unrelated dirty files and stage only files verified for each commit.

## Review Focus

- Model emits text then tools in one call: the text remains before the first tool, not duplicated as a final answer (Task 2 test).
- Model emits only final text: the provisional text becomes one final answer below the completed duration archive (Task 2 and 4 tests).
- Tool fails, waits for approval, or is cancelled: its first-event position and `activityId` remain unchanged (Task 3 test).
- Reconnect repeats an event or skips retained history: duplicate rows are not created; an expired range is replaced by a cursor-consistent snapshot (Task 3 test).
- Two tools complete in reverse order: row positions remain at invocation order while results update their own `callId` (Task 3 test).

---

### Task 1: Remove the model activity tool and keep runtime title/correlation guarantees

**Files:**
- Modify: `apps/agent-runtime/src/agent-graph.ts:54-75,290-430,654-735`
- Modify: `apps/agent-runtime/tests/agent-graph.test.ts:23-80,190-250,390-405`
- Modify: `apps/agent-runtime/tests/model-gateway.test.ts:260-290`
- Modify: `apps/desktop/e2e/support/fake-openai-tool-server.ts:60-140`

**Interfaces:**
- Consumes: `ToolDefinition[]` discovered by `RuntimeToolPolicy` and `ProviderToolCall` from `ModelGateway`.
- Produces: the existing `ActivityGraphEvent` `started/updated/completed` events; external tool records retain `activityId` and `callId`.

- [ ] **Step 1: Write the failing tests.** Replace tests that expect `activity_update` with a model request assertion and two actual tool calls:

```ts
expect(request.tools?.map((tool) => tool.modelName)).not.toContain('activity_update')
expect(observed.filter((event) => event.kind === 'activity').map((event) => event.event.type))
  .toEqual(['started', 'updated', 'updated', 'completed'])
expect(toolRecords.map((record) => record.payload.activityId))
  .toEqual(expect.arrayContaining(['activity:task-activity:default']))
expect(toolRecords.every((record) => record.payload.callId !== undefined)).toBe(true)
```

Also assert no model-context `role: 'tool', name: 'activity_update'` result is appended, and that a no-tool turn still starts and completes its default activity. Update the E2E fake server to return only real tool calls.

- [ ] **Step 2: Run RED.** `corepack pnpm vitest run apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/tests/model-gateway.test.ts` must fail on the advertised internal tool or synthetic result.
- [ ] **Step 3: Implement the minimal Graph change.** Use only discovered tools in `plan`, remove `activityUpdateTool`, `toActivityEvent`, and `normalizeActivityEvent`, and let the existing per-external-tool branch update `titleRevision` before invocation:

```ts
const tools = discoveredTools
const title = activityTitleForTool(providerCall.modelName)
activityTitleRevision += 1
await observer?.({ kind: 'activity', event: {
  type: 'updated', activityId: activeActivityId!, title,
  titleRevision: activityTitleRevision
} })
```

Keep the default activity and safe generic title if argument inspection cannot produce a specific title. Do not alter actual tool authorization.

- [ ] **Step 4: Run GREEN.** Run the two Vitest files above; confirm only external calls count against the existing tool budget and every tool record carries the active activity ID.
- [ ] **Step 5: Commit this tested unit.** Stage only the four Task 1 files and commit `refactor: make activity titles runtime owned`.

### Task 2: Preserve streamed text identity and classify process versus final text

**Files:**
- Modify: `apps/agent-runtime/src/ports.ts:33-55`
- Modify: `apps/agent-runtime/src/agent-graph.ts:295-335,611-630`
- Modify: `apps/agent-runtime/src/stream-session-service.ts:280-330,540-575`
- Modify: `packages/runtime-contracts/src/stream-protocol.ts:280-320`
- Test: `apps/agent-runtime/tests/agent-graph.test.ts`
- Test: `apps/agent-runtime/tests/stream-session-service.test.ts`
- Test: `packages/runtime-contracts/tests/stream-protocol.test.ts`

**Interfaces:**
- Consumes: one model `plan` request ID per call and streamed `ModelGatewayEvent` content/end events.
- Produces: `activity.text` with stable `textId`, `activityId`, `delta`; `activity.text.done` with the same `textId` and `phase: 'process' | 'final'`. Both are persisted stream events with the normal `cursor`.

- [ ] **Step 1: Write failing mixed-output tests.** A stream of `content('A') → end(tool-calls) → tool A → content('B') → end(finish)` must yield stable text IDs and dispositions:

```ts
expect(activityEvents).toEqual(expect.arrayContaining([
  expect.objectContaining({ type: 'text', textId: 'plan:task', delta: 'A' }),
  expect.objectContaining({ type: 'text.done', textId: 'plan:task', phase: 'process' }),
  expect.objectContaining({ type: 'text.done', textId: 'plan:task:1', phase: 'final' })
]))
```

Add a no-tool final-only test and a stream failure test (pending text remains visible as process without being mislabeled a successful final answer).

- [ ] **Step 2: Run RED.** `corepack pnpm vitest run apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/tests/stream-session-service.test.ts packages/runtime-contracts/tests/stream-protocol.test.ts` must fail because `textId` / `textDone` are not supported.
- [ ] **Step 3: Add the smallest event contract and Graph emission.** Derive `textId` from the model-plan request ID; emit deltas immediately and one terminal disposition:

```ts
type TextEvent =
  | { type: 'text'; activityId: string | null; textId: string; delta: string }
  | { type: 'text.done'; activityId: string | null; textId: string; phase: 'process' | 'final' }

const phase = terminal.kind === 'tool-calls' ? 'process' : 'final'
await observer?.({ kind: 'activity', event: {
  type: 'text.done', activityId, textId, phase
} })
```

Persist and forward these through `StreamSessionService`. Keep `response.content` for the stored assistant message, but do not use it to render process order. If a model call emits zero text, emit no text item.

- [ ] **Step 4: Run GREEN.** Run all Task 2 Vitest files and `corepack pnpm --filter @actiondriver/agent-runtime typecheck`.
- [ ] **Step 5: Commit this tested unit.** Stage only Task 2 files and commit `feat: classify streamed activity text`.

### Task 3: Make cursor-ordered projection and snapshots agree

**Files:**
- Create: `packages/runtime-contracts/src/activity-projection.ts`
- Modify: `packages/runtime-contracts/src/index.ts`
- Modify: `packages/contracts/src/index.ts:74-112`
- Modify: `packages/runtime-contracts/src/stream-protocol.ts:225-280`
- Modify: `apps/agent-runtime/src/stream-session-service.ts:375-455,634-690`
- Modify: `apps/agent-runtime/src/ports.ts:210-250`
- Modify: `apps/agent-runtime/src/repositories.ts:190-250,475-510`
- Modify: `apps/agent-runtime/src/mock-adapters.ts:160-185`
- Test: `packages/runtime-contracts/tests/activity-projection.test.ts`
- Test: `apps/agent-runtime/tests/stream-session-service.test.ts`

**Interfaces:**
- Consumes: persisted events converted to the normal `StreamServerEvent` shape, each bearing a `cursor`.
- Produces: `reduceActivityProjection(current, event): ActivityTimelineState`, shared by snapshot assembly and renderer; `ActivityTimelineState` contains ordered activity/text/tool references and tool-to-activity lookup. `readStreamSnapshot(requestId): StreamSnapshotRead` reads one consistent high-water state.

- [ ] **Step 1: Write failing reducer and snapshot tests.** Test `text A → tool A → text B → tool B` with ascending cursors; reverse completion order; duplicate tool event; waiting approval, failure, and cancellation. Assert the same ordered references after replay and after snapshot. Add a snapshot race test that appends an event after the captured high-water cursor and asserts it is absent from that snapshot. In a concurrent-writer fixture, delay the first broadcast and assert clients still receive ascending cursors. Feed a pre-migration `activity.text` without `textId` and derive its stable fallback ID from `eventId` without losing that text.

```ts
const state = events.reduce(reduceActivityProjection, emptyActivityTimelineState())
expect(state.activities[0]?.items.map((item) => item.id))
  .toEqual(['text:plan:task', 'tool:call-a', 'text:plan:task:1', 'tool:call-b'])
expect(state.toolActivityIds['call-a']).toBe('activity:task:default')
expect(state.toolActivityIds['call-b']).toBe('activity:task:default')
```

- [ ] **Step 2: Run RED.** `corepack pnpm vitest run packages/runtime-contracts/tests/activity-projection.test.ts apps/agent-runtime/tests/stream-session-service.test.ts` must fail on missing shared reducer or inconsistent snapshot contents.
- [ ] **Step 3: Implement shared ordered reduction.** Reject an event whose `cursor` was already applied; add a display item only on the first text/tool event; apply later deltas/status to the same ID; apply title updates only when `titleRevision` grows:

```ts
export type ActivityTimelineState = {
  cursor: number
  activities: ActivityProjection[]
  timeline: TaskTimelineProjectionItem[]
  toolActivityIds: Record<string, string | null>
  textPhases: Record<string, 'pending' | 'process' | 'final'>
}

export type StreamSnapshotRead = {
  cursor: number
  events: RuntimeEventRecord[]
  task: RuntimeTaskRecord | null
  messages: PersistedMessage[]
  tools: PersistedToolInvocation[]
}

export function reduceActivityProjection(
  state: ActivityTimelineState,
  event: StreamServerEvent
): ActivityTimelineState {
  if (!('cursor' in event) || event.cursor <= state.cursor) return state
  // Activity start inserts a group; text/tool first sight inserts a stable item.
  // Text and tool deltas update their existing item; final-phase text leaves process.
  return { ...state, cursor: event.cursor }
}
```

Add `readStreamSnapshot` to `StreamSessionRepository` and implement it as one SQLite read transaction (and the equivalent mock adapter) so the task, messages, tool invocations, and `events WHERE cursor <= highWater` agree. Serialize each request's append-and-broadcast operations in the stream service so concurrent callbacks cannot emit a later cursor first:

```ts
const previous = writeTails.get(requestId) ?? Promise.resolve()
const current = previous.then(async () => {
  const persisted = await repositories.events.append(record)
  await emit(toServerEvent(request, persisted))
})
writeTails.set(requestId, current.catch(() => {}))
await current
```

Do not sort by `occurredAt`. Keep the new `textId` optional when parsing historical events and use `eventId` as a fallback for those records; new emissions must always include `textId`. Keep current public snapshot fields only if they are used by the renderer; remove newly redundant fields only after consumer search.

- [ ] **Step 4: Run GREEN.** Run Task 3 tests, `corepack pnpm --filter @actiondriver/runtime-contracts typecheck`, and `corepack pnpm --filter @actiondriver/agent-runtime typecheck`.
- [ ] **Step 5: Commit this tested unit.** Stage only Task 3 files and commit `feat: project ordered activity events from cursor`.

### Task 4: Render one ordered process instead of two reordered content lanes

**Files:**
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.ts:10-170,200-285`
- Modify: `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx:5-165`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx:62-103`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx:195-240`
- Test: `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`
- Test: `apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx`

**Interfaces:**
- Consumes: the Task 3 `reduceActivityProjection` state and Task 2 `activity.text.done` phase.
- Produces: `TaskProjection.activityTimeline` and `activities` in cursor order; the task page renders one process timeline followed by the final assistant message.

- [ ] **Step 1: Write failing renderer tests.** Feed the same interleaved event fixture to the live projection and to a `response.snapshot`, and assert identical text/tool DOM order. Update the stale page test that still expects `e2e/tasks/detail/tool-activity/running#section`. Add a running-timer-first assertion and a completed archive-before-conclusion assertion.

```ts
const labels = within(screen.getByRole('region', { name: '任务过程' }))
  .getAllByTestId('activity-item')
  .map((node) => node.textContent)
expect(labels).toEqual(['正文 A', expect.stringContaining('工具 A'), '正文 B', expect.stringContaining('工具 B')])
expect(screen.queryByTestId('e2e/tasks/detail/tool-activity/running#section')).toBeNull()
```

- [ ] **Step 2: Run RED.** `corepack pnpm vitest run apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx` must expose the current body-before-timeline rendering and stale old-card expectation.
- [ ] **Step 3: Implement one renderer path.** Apply shared reducer updates to `TaskProjection`; `ActivityTimeline` maps ordered references without regrouping; `TaskPage` renders user messages above it and only a terminal/final assistant message after it. Do not render cumulative in-progress assistant content as a separate process block:

```tsx
<ConversationMessages messages={userMessages} generating={false} />
<ActivityTimeline task={task} />
{finalMessage ? <ConversationMessages messages={[finalMessage]} generating={false} /> : null}
```

Preserve raw I/O disclosure, approval bar, shimmer/reduced-motion behavior, and running/terminal duration header.

- [ ] **Step 4: Run GREEN.** Run Task 4 Vitest files and `corepack pnpm --filter @actiondriver/desktop typecheck`.
- [ ] **Step 5: Commit this tested unit.** Stage only Task 4 files and commit `fix: render task process in event order`.

### Task 5: Verify the full flow and reconcile planning artifacts

**Files:**
- Modify: `apps/desktop/e2e/tool-runtime.spec.ts`
- Modify: `openspec/changes/fix-activity-timeline-fallback/tasks.md`
- Modify: `openspec/changes/fix-activity-timeline-fallback/design.md` only if implementation exposes a new documented invariant.

**Interfaces:**
- Consumes: the completed runtime stream, shared projector, and task page.
- Produces: a desktop E2E that proves ordinary external tool calls create one activity without the internal model tool; verified OpenSpec task status.

- [ ] **Step 1: Extend the E2E fixture.** Assert a streamed text/tool/text/tool exchange, tool raw I/O disclosure, one activity association, completion archive, and final answer placement. Reopen the task and compare the same item order:

```ts
await expect(page.getByLabel('任务过程')).toContainText('正文 A')
await expect(page.getByLabel('任务过程')).toContainText('正文 B')
await expect(page.getByText(/^用时 /)).toBeVisible()
await expect(page.getByText('最终结论')).toBeVisible()
// Compare the activity item's textContent sequence before and after reopening.
```
- [ ] **Step 2: Run RED on the old behavior.** Run `corepack pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts` using the repository's existing E2E setup; if it fails only because the test environment is unavailable, record that separately rather than treating it as product failure.
- [ ] **Step 3: Correct only a failed integration boundary.** If the sequence assertion fails, inspect persisted cursor order, then adjust the existing reducer or TaskPage render order—not the schema. For example, remove an accidental second assistant lane:

```tsx
<ConversationMessages messages={userMessages} generating={false} />
<ActivityTimeline task={task} />
{finalMessage ? <ConversationMessages messages={[finalMessage]} generating={false} /> : null}
```
- [ ] **Step 4: Verify.** Run the targeted runtime, contract, renderer, and E2E tests; run typechecks for changed packages; run `git diff --check` and `corepack pnpm exec openspec validate fix-activity-timeline-fallback --strict`. Compare live, reconnect, and fresh-open output for identical process ordering. Update completed OpenSpec checkboxes only after each check passes.
- [ ] **Step 5: Commit verified integration changes.** Stage only the E2E, relevant fixes, and OpenSpec files; commit `test: verify ordered activity lifecycle`. Archive the OpenSpec change only after the entire change is verified and the project's archive convention permits it.
