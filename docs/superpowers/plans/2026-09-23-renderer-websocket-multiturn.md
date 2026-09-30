# Renderer WebSocket Multi-turn Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Electron Renderer own the Runtime WebSocket and support real multi-turn conversations where every turn creates a new task in the same persisted session.

**Architecture:** Main starts the local Runtime and exposes only an immutable, one-launch `wsUrl + accessToken` connection descriptor through Preload; Renderer owns the `action-driver.stream.v1` client and applies events directly. Runtime separates unique execution `threadId` from shared `sessionId`, creates a new task for each turn, sends the complete persisted conversation to the model, and projects one sidebar session with per-turn logs.

**Tech Stack:** TypeScript, Electron 38, React 19, browser WebSocket API, `ws` server, Zod, SQLite/`better-sqlite3`, LangGraph, Vitest, Testing Library, Playwright, OpenAI Node SDK, `markdown-it`.

**Spec:** `openspec/changes/serve-runtime-over-http/design.md`, `openspec/changes/serve-runtime-over-http/specs/runtime-service-transport/spec.md`, `openspec/changes/serve-runtime-over-http/specs/desktop-shell/spec.md`, `openspec/changes/serve-runtime-over-http/specs/interaction-log-viewer/spec.md`

## Global Constraints

- Local production data and model calls remain Runtime-owned; Renderer never receives a model-provider API key.
- Runtime access token is memory-only, launch-scoped, excluded from logs/errors/screenshots, and accepted only from the trusted Electron origin.
- Renderer sends and receives stream commands directly; Main must not proxy `request.create`, `request.cancel`, `request.resume`, or `response.*`.
- Each turn creates a new immutable task under the same `sessionId`; at most one task per session may run at once.
- The full persisted conversation is sent in order; this change does not silently truncate, summarize, or delete history.
- The task body contains user messages and model Markdown only; no execution-progress timeline or fabricated Browser/Computer panel.
- Only the message viewport scrolls. The composer remains fixed at the bottom and must not be obscured at the 1024×700 minimum window.
- Do not run Figma validation unless the user explicitly asks for it.
- Run targeted tests after each task. Run the complete gate only after all tasks are complete.

## Review Focus

- A second submit arriving while the first turn is running must produce `session-busy` without an orphan task, message, model call, or log.
- A continuation after the configured model is disabled or removed must fail before the upstream request and must not fall back to another model.
- A renderer reload during streaming must recover from the persisted cursor/snapshot without duplicated assistant text.
- A long conversation must keep the composer visible, follow new output only while the user is already near the bottom, and preserve manual scrollback.
- Runtime token, auth frames, and WebSocket URL credentials must never appear in interaction logs, console tracing, task persistence, Playwright artifacts, or thrown error text.

---

### Task 1: Make session identity and continuation explicit in contracts and persistence

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`
- Modify: `packages/runtime-contracts/src/stream-protocol.ts`
- Modify: `packages/runtime-contracts/tests/stream-protocol.test.ts`
- Modify: `apps/agent-runtime/src/database.ts`
- Modify: `apps/agent-runtime/src/ports.ts`
- Modify: `apps/agent-runtime/src/repositories.ts`
- Modify: `apps/agent-runtime/tests/database.test.ts`
- Modify: `apps/agent-runtime/tests/repositories.test.ts`

**Interfaces:**
- Produces: `TaskProjection.sessionId: string`, `TaskProjection.model: ModelRef`.
- Produces: `AgentGoalRequest = { goal: string; model: ModelRef; sessionId?: never } | { goal: string; sessionId: string; model?: never }`.
- Produces: `RuntimeTaskRecord.sessionId: string` while `threadId` remains unique per task/checkpoint.
- Produces repository operations `getLatestBySession(sessionId)`, `listBySession(sessionId)`, `listMessagesBySession(sessionId)`, and `listRecentSessions(limit)`.
- Produces a `request.create` union: a new-session event has `sessionId: null` plus `payload.model`; a continuation has non-empty `sessionId` and omits `payload.model`.

- [ ] **Step 1: Write failing contract tests for new-session and continuation commands**

```ts
expect(parseStreamClientEvent({
  type: 'request.create', protocol: STREAM_PROTOCOL, eventId: 'event-2',
  createdAt: now, requestId: 'request-2', idempotencyKey: 'idem-2',
  sessionId: 'session-1',
  payload: { input: { role: 'user', content: '继续解释' }, skills: [] }
})).toMatchObject({ sessionId: 'session-1' })

expect(() => parseStreamClientEvent({
  type: 'request.create', protocol: STREAM_PROTOCOL, eventId: 'event-bad',
  createdAt: now, requestId: 'request-bad', idempotencyKey: 'idem-bad',
  sessionId: null,
  payload: { input: { role: 'user', content: '缺少模型' }, skills: [] }
})).toThrow()
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `corepack pnpm exec vitest run packages/contracts/tests/contracts.test.ts packages/runtime-contracts/tests/stream-protocol.test.ts`

Expected: FAIL because `TaskProjection` lacks session/model and the protocol still requires `payload.model` for every request.

- [ ] **Step 3: Add migration and repository tests for multiple tasks in one session**

```ts
await repositories.tasks.save(task({ id: 'task-1', threadId: 'thread-1', sessionId: 'session-1' }))
await repositories.tasks.save(task({ id: 'task-2', threadId: 'thread-2', sessionId: 'session-1' }))
expect((await repositories.tasks.listBySession('session-1')).map((item) => item.id))
  .toEqual(['task-1', 'task-2'])
expect((await repositories.tasks.listRecentSessions(20)).map((item) => item.id))
  .toEqual(['task-2'])
```

- [ ] **Step 4: Run persistence tests and verify RED**

Run: `corepack pnpm exec vitest run apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts`

Expected: FAIL because migration 5 and session-aware repository methods do not exist.

- [ ] **Step 5: Implement the contract union and migration 5**

Add `tasks.session_id TEXT`, backfill it from `thread_id`, retain unique `thread_id`, and add `tasks_session_updated_idx`. New records use a unique graph thread per task and a shared session id:

```ts
export type RuntimeTaskRecord = {
  id: string
  threadId: string
  sessionId: string
  goal: string
  model: ModelRef
  // existing terminal and timestamp fields
}
```

Implement SQL joins that order session tasks/messages by `created_at, id` and choose one latest task per session for recent records.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `corepack pnpm exec vitest run packages/contracts/tests/contracts.test.ts packages/runtime-contracts/tests/stream-protocol.test.ts apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/contracts packages/runtime-contracts apps/agent-runtime/src/database.ts apps/agent-runtime/src/ports.ts apps/agent-runtime/src/repositories.ts apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts
git commit -m "feat: model multi-turn session identity"
```

### Task 2: Execute and project a new task from complete session history

**Files:**
- Modify: `apps/agent-runtime/src/ports.ts`
- Modify: `apps/agent-runtime/src/agent-graph.ts`
- Modify: `apps/agent-runtime/src/stream-session-service.ts`
- Modify: `apps/agent-runtime/src/model-log-projection.ts`
- Modify: `apps/agent-runtime/src/local-runtime-server.ts`
- Modify: `apps/agent-runtime/tests/agent-graph.test.ts`
- Modify: `apps/agent-runtime/tests/stream-session-service.test.ts`
- Modify: `apps/agent-runtime/tests/model-log-projection.test.ts`
- Modify: `apps/agent-runtime/tests/service-http.test.ts`

**Interfaces:**
- Consumes Task 1 session-aware request and repositories.
- Produces `GraphRunner.run({ taskId, goal, model, messages, systemPrompt, skills }, signal, observer)` where `messages` contains prior user/assistant history and the graph appends the current goal exactly once.
- Produces task detail containing the latest task identity and all session messages.
- Produces one `ModelLogSessionProjection` with many `ModelLogTaskProjection` children.

- [ ] **Step 1: Write a failing graph test for ordered history**

```ts
await graph.run({
  taskId: 'task-2',
  goal: '第二问',
  model,
  systemPrompt: 'system',
  messages: [
    { role: 'user', content: '第一问' },
    { role: 'assistant', content: '第一答' }
  ],
  skills: []
})
expect(gateway.requests[0]?.messages).toEqual([
  { role: 'system', content: 'system' },
  { role: 'user', content: '第一问' },
  { role: 'assistant', content: '第一答' },
  { role: 'user', content: '第二问' }
])
```

- [ ] **Step 2: Write failing stream-service tests for continuation and `session-busy`**

Cover a completed first task followed by a second `request.create`, model inheritance, distinct task/thread IDs, idempotent retry, unknown session, and a concurrent request rejected without repository writes.

- [ ] **Step 3: Run Runtime tests and verify RED**

Run: `corepack pnpm exec vitest run apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/tests/stream-session-service.test.ts apps/agent-runtime/tests/model-log-projection.test.ts apps/agent-runtime/tests/service-http.test.ts`

Expected: FAIL because the graph accepts no history and projections are task-only.

- [ ] **Step 4: Implement continuation resolution before persistence**

```ts
const previous = event.sessionId
  ? await repositories.tasks.getLatestBySession(event.sessionId)
  : null
if (event.sessionId && !previous) return emitRequestError('session-not-found')
if (previous && previous.status === 'running') return emitRequestError('session-busy')
const sessionId = previous?.sessionId ?? ids.next('session')
const model = previous?.model ?? event.payload.model
```

Build history only from terminal persisted user/assistant messages and exclude the new empty assistant placeholder. Preserve idempotency lookup before busy validation so replaying the same request returns its original accepted/snapshot result.

- [ ] **Step 5: Implement session projections and grouped model logs**

`task.get(latestTaskId)` returns `sessionId`, inherited `model`, and all messages for that task's session. `task.list` returns one latest task per session with the first task goal as stable title. Model-log list/get loads every task and call in the session and sorts them deterministically.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `corepack pnpm exec vitest run apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/tests/stream-session-service.test.ts apps/agent-runtime/tests/model-log-projection.test.ts apps/agent-runtime/tests/service-http.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/agent-runtime/src apps/agent-runtime/tests
git commit -m "feat: execute multi-turn session tasks"
```

### Task 3: Move the application WebSocket client into Renderer

**Files:**
- Create: `apps/desktop/src/shared/runtime-connection-contract.ts`
- Create: `apps/desktop/src/main/runtime-connection-ipc.ts`
- Create: `apps/desktop/src/main/runtime-connection-ipc.test.ts`
- Create: `apps/desktop/src/renderer/src/services/renderer-stream-client.ts`
- Create: `apps/desktop/src/renderer/src/services/renderer-stream-client.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/local-runtime.ts`
- Modify: `apps/desktop/src/main/agent-ipc.ts`
- Modify: `apps/desktop/src/shared/agent-ipc-contract.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/preload/desktop-api.test.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.test.ts`
- Delete after callers migrate: `apps/desktop/src/main/runtime-stream-client.ts`
- Delete after callers migrate: `apps/desktop/src/main/runtime-stream-client.test.ts`

**Interfaces:**
- Produces `RuntimeConnectionInfo = { wsUrl: string; protocol: typeof STREAM_PROTOCOL; accessToken: string }`.
- Produces Preload `runtimeConnection.get(): Promise<RuntimeConnectionInfo>`; this IPC is excluded from payload logging.
- Produces `RendererStreamClient.create(request: AgentGoalRequest & { systemPrompt?: string }): Promise<RuntimeStreamAccepted>`, `cancel(...)`, `subscribe(...)`, and `close()`.
- Removes `AgentDesktopApi.submit`, `AgentDesktopApi.cancel`, and `AgentDesktopApi.subscribeStream`; query/log/skill APIs remain temporarily bridged.

- [ ] **Step 1: Write a failing Renderer-client test around a browser-compatible fake WebSocket**

Assert that the client fetches connection info, constructs exactly one socket with `action-driver.stream.v1`, sends `auth` first, resolves `create` on `request.accepted`, publishes `response.content`, retries after close, sends `request.resume(afterCursor)`, and never puts the token in a URL or thrown error.

- [ ] **Step 2: Run the Renderer-client test and verify RED**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/src/services/renderer-stream-client.test.ts`

Expected: FAIL because `RendererStreamClient` does not exist.

- [ ] **Step 3: Write failing Main/Preload boundary tests**

```ts
expect(await api.runtimeConnection.get()).toEqual({
  wsUrl: 'ws://127.0.0.1:4321/stream',
  protocol: STREAM_PROTOCOL,
  accessToken: 'launch-token'
})
expect(api.agent).not.toHaveProperty('subscribeStream')
expect(api.agent).not.toHaveProperty('submit')
```

Assert the connection handler returns only after supervisor readiness and does not register the stream-event IPC channel.

- [ ] **Step 4: Run boundary tests and verify RED**

Run: `corepack pnpm exec vitest run apps/desktop/src/main/runtime-connection-ipc.test.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/renderer/src/di/container.test.ts`

Expected: FAIL because the old Main stream proxy is still present.

- [ ] **Step 5: Implement the direct Renderer client and narrow bridge**

Use the browser `WebSocket` constructor through an injected factory for tests. The client owns event parsing, command deadlines, event-id dedupe, sequence/cursor tracking, exponential retry with jitter, and resumption. It must not implement JSON Ping; the service remains the Ping initiator.

Register a narrow Main handler after `runtimeSupervisor.start()` using its service descriptor and launch token. Construct `wsUrl` with `new URL(streamPath, baseUrl)` and convert only the scheme from `http/https` to `ws/wss`; never append the token to the URL.

- [ ] **Step 6: Remove Main stream forwarding**

Remove `RuntimeStreamClient` construction/start/close, stream submission from `agent-ipc`, `AGENT_IPC_CHANNELS.streamEvent`, and Preload stream listeners. Keep task/model-log queries and unrelated skill controls unchanged.

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/src/services/renderer-stream-client.test.ts apps/desktop/src/main/runtime-connection-ipc.test.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/renderer/src/di/container.test.ts apps/desktop/src/main/agent-ipc.test.ts`

Expected: PASS, with no Main stream proxy assertions remaining.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/src/di apps/desktop/src/renderer/src/services/renderer-stream-client* apps/desktop/src/shared
git commit -m "feat: connect renderer directly to runtime websocket"
```

### Task 4: Submit follow-up turns from the same page

**Files:**
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.ts`
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.test.tsx`
- Modify: `apps/desktop/src/renderer/src/services/mock-agent-runtime.ts`
- Modify: `apps/desktop/src/renderer/src/services/mock-task-catalog.ts`
- Modify: `apps/desktop/src/renderer/src/services/mock-task-fixture.ts`

**Interfaces:**
- Consumes `RendererStreamClient` from Task 3 and session-aware projections from Tasks 1–2.
- Produces `TaskPage.onSubmit(goal: string)` for follow-up turns.
- Keeps the composer editable for terminal states, read-only only while `task.status === 'running'`, and remounts/clears it when the accepted `task.id` changes.

- [ ] **Step 1: Write a failing adapter test for a second turn**

Submit `{ goal: '第二问', sessionId: 'session-1' }`, emit accepted/content/end for `task-2`, and assert the projected transcript keeps task-1 messages and appends exactly one user and assistant message for task-2.

- [ ] **Step 2: Write failing App/Page tests for composer behavior**

```ts
expect(screen.getByLabelText('任务描述')).toHaveAttribute('contenteditable', 'true')
await user.type(screen.getByLabelText('任务描述'), '继续解释')
await user.click(screen.getByLabelText('发送'))
expect(submitGoal).toHaveBeenCalledWith({ goal: '继续解释', sessionId: 'session-1' })
expect(screen.getByLabelText('任务描述')).toHaveAttribute('contenteditable', 'false')
```

Also assert the composer becomes editable again after `response.end`, failed/cancelled partial text remains visible, and no “执行进度” text is rendered.

- [ ] **Step 3: Run Renderer tests and verify RED**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx apps/desktop/src/renderer/src/components/AgentComposer.test.tsx`

Expected: FAIL because TaskPage has a no-op submit callback and disables every terminal task.

- [ ] **Step 4: Connect App, TaskPage, adapter, and direct stream client**

`DesktopAgentAdapter.submitGoal` subscribes before sending, buffers early events by request/task identity, attaches the server projection after accepted, and switches the current route from the previous task id to the new task id without leaving the visible session transcript.

In `App`, centralize the new-session and continuation submission paths so both update `task`, recent sessions, and route consistently. On continuation, never read the current model selector to override the session model.

- [ ] **Step 5: Make composer state truthful**

Add `data-state="idle|disabled|running"`; clear Slate using a task-id key after accepted; disable send for empty input or unavailable inherited model; prevent Enter submission while running; and preserve Shift+Enter newline behavior.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat: continue conversations with new tasks"
```

### Task 5: Fix composer position, scrolling, and visual states

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ConversationViewport.tsx`
- Create: `apps/desktop/src/renderer/src/components/ConversationViewport.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/agent.css`
- Modify: `apps/desktop/e2e/interaction-contracts.json` only if a new interactive control is introduced (the scroll container itself is not interactive and needs no test id).

**Interfaces:**
- Produces `ConversationViewport({ followKey, children })`, where `followKey` changes on appended stream content.
- The viewport owns scroll-follow behavior; TaskPage owns fixed composer placement.

- [ ] **Step 1: Write failing viewport tests for conditional auto-follow**

Stub `scrollHeight`, `clientHeight`, `scrollTop`, and `scrollTo`. Assert a changed `followKey` scrolls to the bottom when distance is at most 24px, but does not move when the user is farther away. Assert returning manually to the bottom resumes following.

- [ ] **Step 2: Write failing layout tests for composer position**

Assert TaskPage renders a `conversation-scroll` region before, not around, the composer; the composer is always present for agent-only and split layouts; and no execution timeline is present.

- [ ] **Step 3: Run layout tests and verify RED**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/src/components/ConversationViewport.test.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx`

Expected: FAIL because conditional follow logic is absent.

- [ ] **Step 4: Implement the viewport and resilient CSS layout**

Use grid/flex constraints instead of absolute positioning or fixed page heights:

```css
.conversation-body {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
  overflow: hidden;
}
.conversation-scroll {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}
.agent-composer {
  min-height: 112px;
  margin: 0 auto 20px;
}
```

Add `:focus-within`, hover, disabled, and running styles. Disabled send must be visibly muted; the editable region must use a text cursor only when actually editable. Avoid fixed widths except existing responsive maximums (`min(720px, calc(100% - 32px))`).

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run the command from Step 3 plus `corepack pnpm validate:e2e-interactions`.

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/desktop/src/renderer/src/components/ConversationViewport* apps/desktop/src/renderer/src/pages/TaskPage.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx apps/desktop/src/renderer/src/styles/agent.css apps/desktop/e2e/interaction-contracts.json
git commit -m "fix: keep conversation composer anchored"
```

### Task 6: Verify two real turns, session grouping, logs, recovery, and security

**Files:**
- Modify: `apps/desktop/e2e/support/fake-openai-stream-server.ts`
- Modify: `apps/desktop/e2e/local-runtime.spec.ts`
- Modify: `openspec/changes/serve-runtime-over-http/tasks.md`
- Modify: `.superpowers/sdd/2026-09-23-real-agent-websocket-streaming/progress.md` if the ledger remains present locally.

**Interfaces:**
- Consumes all prior tasks.
- Produces deterministic proof that Renderer owns the socket, two tasks share one session, the second upstream request contains first-turn history, and logs remain one aggregate call per task.

- [ ] **Step 1: Extend the fake provider for two distinct streamed replies**

Capture every request body and return deterministic Markdown keyed by the last user message. Do not capture or persist Authorization values.

- [ ] **Step 2: Write the failing two-turn E2E assertions**

The test must:

1. Save and select a real persisted OpenAI-compatible connection.
2. Submit turn one and observe partial then final Markdown.
3. Verify the composer remains fixed and becomes editable after completion.
4. Submit turn two from the same page.
5. Assert two different task IDs and one shared session ID.
6. Assert the provider's second request contains `user1 → assistant1 → user2` exactly once and uses the same model.
7. Assert the sidebar has one session item, not two task items.
8. Assert model logs contain one session, two tasks, and exactly one completed call per task.
9. Reload the window and assert the complete transcript returns without duplicate messages.
10. Assert interaction logs contain no access token, auth frame, `action-driver:log:list`, or per-delta model record.

- [ ] **Step 3: Run E2E and verify RED**

Run: `corepack pnpm test:e2e:local`

Expected: FAIL before the final integration fixes because the existing E2E covers one turn and Main still owns the socket at the start of the plan.

- [ ] **Step 4: Make only integration corrections exposed by E2E**

Fix wiring, ordering, and deterministic waits. Do not weaken assertions, reintroduce Main stream proxying, silently truncate context, or add Mock fallback.

- [ ] **Step 5: Run final verification**

Run:

```bash
corepack pnpm test:e2e:local
corepack pnpm check
openspec validate serve-runtime-over-http --strict
```

Expected: all commands exit 0; the unit suite has no failures; E2E completes two real local streamed turns; OpenSpec is valid.

- [ ] **Step 6: Update OpenSpec completion evidence**

Mark 0.4, 0.7, 0.10, and 0.11 complete only when every stated behavior is verified. Mark 0.9 complete only after all three final commands pass. Do not mark deferred unrelated groups complete.

- [ ] **Step 7: Commit Task 6**

```bash
git add apps/desktop/e2e openspec/changes/serve-runtime-over-http/tasks.md
git commit -m "test: verify direct websocket multi-turn flow"
```

## Self-Review Record

- Spec coverage: direct Renderer WebSocket, launch token boundary, server Ping/browser Pong, new-task-per-turn persistence, inherited model, complete history, busy/error paths, input states, composer position, conditional scrolling, session sidebar grouping, per-task logs, restart recovery, and credential exclusion are each owned by a task above.
- Placeholder scan: no `TBD`, `TODO`, “similar to”, or unspecified error-handling steps remain.
- Type consistency: `sessionId`, `RuntimeConnectionInfo`, `RendererStreamClient`, session repository method names, and `ConversationViewport.followKey` are defined once and reused consistently.
- Review focus coverage: concurrency is Task 2; model invalidation is Task 2; reload recovery and credential leakage are Tasks 3/6; long-conversation scroll behavior is Task 5.
