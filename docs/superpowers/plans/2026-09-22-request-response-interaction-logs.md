# Request/Response Interaction Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record inspectable Request/Response bodies for real IPC and HTTP interactions, expose protocol filtering and lazy detail loading in the existing interface-log page, and provide the same recorder boundary for the planned WebSocket service.

**Architecture:** `@actiondriver/observability` owns transport-neutral event types, an `InteractionLogStore` port, the recorder state machine, credential-boundary sanitation, and a local file adapter. Electron Main and Agent Runtime each write a separate namespace under the same `userData/logs/interactions` root; Main merges summaries and routes detail reads by source-prefixed event ID. Renderer list calls receive summaries only, while a separate detail call loads one payload on demand.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `zlib`, Pino, Electron IPC/Preload, React, Vitest, Testing Library, Playwright.

**Spec:** `openspec/changes/serve-runtime-over-http/specs/interaction-log-viewer/spec.md`; architecture decisions are in `openspec/changes/serve-runtime-over-http/design.md` section 8.

## Global Constraints

- Business bodies are stored unchanged except for explicitly declared credential locations; Authorization, Proxy-Authorization, Cookie, Set-Cookie, X-API-Key, service tokens, and model API keys never persist.
- List/filter/refresh paths return summaries only and never read payload files.
- Local defaults are 256 MiB total, 7 days, and 4 MiB per text payload; binary data stores metadata only.
- Current real transports are IPC and HTTP. The generic WebSocket recorder and tests ship now; real WebSocket call-site wiring remains blocked on OpenSpec tasks 3.1–3.7 because no WebSocket service exists yet.
- Preserve the current settings sidebar, Codex-style white layout, existing interface/model log split, and unrelated dirty workspace files.
- Every implementation task follows RED -> GREEN and ends with a scope-specific commit on `main`.

## Review Focus

- A completion racing its asynchronous begin write must still produce one completed event, never a missing or permanently pending event; Task 1 tests ordered serialization.
- A payload file may disappear between summary listing and detail loading; Task 2 and Task 5 test `payload-unavailable` without closing the inspector.
- Model connection requests contain nested API keys while user bodies may contain ordinary text mentioning “token”; Task 2 tests path-scoped removal rather than recursive keyword deletion.
- Auto-refresh can replace summaries while detail is loading; Task 5 tests event-ID-stable selection and ignores stale detail responses.
- Main and Runtime write concurrently under one root; Task 2 tests namespace isolation and Task 4 tests merged chronological pagination without event-ID collisions.

---

### Task 1: Interaction event contracts and recorder state machine

**Files:**
- Create: `packages/observability/src/interaction-store.ts`
- Create: `packages/observability/src/interaction-store.test.ts`
- Modify: `packages/observability/src/interactions.ts`
- Modify: `packages/observability/src/index.ts`

**Interfaces:**
- Consumes: existing Pino `Logger` and the current `InteractionStart` routing fields.
- Produces: `InteractionLogStore`, `InteractionLogRecorder`, `InteractionLogSummary`, `InteractionLogDetail`, `InteractionLogQuery`, `InteractionPayloadInput`, and `createInteractionLogRecorder()`.

- [ ] **Step 1: Write failing contract and state tests**

```ts
it('serializes begin and completion into one correlated event', async () => {
  const store = new MemoryInteractionLogStore()
  const recorder = createInteractionLogRecorder({ store, id: sequentialIds() })
  const finish = await recorder.start({
    transport: 'ipc',
    direction: 'renderer->service',
    operation: 'actiondriver:agent:submit',
    request: { kind: 'json', value: { goal: 'summarise' } }
  })

  await finish({ outcome: 'ok', response: { kind: 'json', value: { taskId: 'task-1' } } })

  expect((await store.list({ limit: 20 })).records[0]).toMatchObject({
    id: 'main:1',
    correlationId: 'correlation:1',
    state: 'completed',
    requestBytes: expect.any(Number),
    responseBytes: expect.any(Number)
  })
})

it('keeps pending, recovers incomplete, and records one-way events without fake responses', async () => {
  // Assert pending -> incomplete recovery and responseAvailable === false for one-way-event.
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `corepack pnpm vitest run packages/observability/src/interaction-store.test.ts`

Expected: FAIL because the store types and recorder do not exist.

- [ ] **Step 3: Define the exact transport-neutral types and port**

```ts
export type InteractionTransport = 'ipc' | 'http' | 'websocket'
export type InteractionState = 'pending' | 'completed' | 'incomplete'
export type InteractionKind = 'request-response' | 'one-way-event'
export type InteractionPayloadKind = 'json' | 'text' | 'binary-metadata' | 'empty'

export type InteractionPayloadView = {
  kind: InteractionPayloadKind
  contentType: string | null
  byteLength: number
  truncated: boolean
  text: string | null
  unavailableReason: 'expired' | 'missing' | 'unsafe-to-persist' | null
}

export interface InteractionLogStore {
  begin(event: InteractionBeginRecord): Promise<void>
  complete(eventId: string, completion: InteractionCompletionRecord): Promise<void>
  recordOneWay(event: InteractionOneWayRecord): Promise<void>
  recoverIncomplete(before: number): Promise<number>
  list(query: InteractionLogQuery): Promise<InteractionLogPage>
  getDetail(eventId: string): Promise<InteractionLogDetail | null>
  prune(now: number): Promise<InteractionPruneResult>
}
```

- [ ] **Step 4: Implement the recorder with ordered per-event completion**

```ts
export function createInteractionLogRecorder(options: RecorderOptions): InteractionLogRecorder {
  return {
    async start(input) {
      const event = buildPendingEvent(input, options.id, options.clock())
      await options.store.begin(event)
      return async (result) => {
        await options.store.complete(event.id, buildCompletion(result, options.clock()))
        options.logger?.info(toConsoleRecord(event, result), `${event.direction} ${event.operation}`)
      }
    },
    async recordOneWay(input) {
      await options.store.recordOneWay(buildOneWayEvent(input, options.id, options.clock()))
    }
  }
}
```

- [ ] **Step 5: Run focused and existing observability tests**

Run: `corepack pnpm vitest run packages/observability/src/interaction-store.test.ts packages/observability/tests/interactions.test.ts packages/observability/tests/logger.test.ts`

Expected: PASS with the legacy console-summary behavior preserved.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/observability/src/interaction-store.ts packages/observability/src/interaction-store.test.ts packages/observability/src/interactions.ts packages/observability/src/index.ts
git commit -m "feat: define structured interaction log events"
```

### Task 2: Credential-safe local payload store and retention

**Files:**
- Create: `packages/observability/src/local-interaction-store.ts`
- Create: `packages/observability/src/local-interaction-store.test.ts`
- Create: `packages/observability/src/interaction-payload.ts`
- Create: `packages/observability/src/interaction-payload.test.ts`
- Modify: `packages/observability/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `InteractionLogStore` records and `InteractionPayloadInput`.
- Produces: `createLocalInteractionLogStore(options)`, `encodeInteractionPayload(input)`, and `sanitizeCredentialPaths(value, paths)`.

- [ ] **Step 1: Write failing payload-boundary tests**

```ts
it('removes declared credential paths but keeps ordinary business text', () => {
  const result = sanitizeCredentialPaths(
    { draft: { apiKey: 'secret' }, prompt: { token: 'explain this token' } },
    ['draft.apiKey']
  )
  expect(result).toEqual({ draft: {}, prompt: { token: 'explain this token' } })
  expect(JSON.stringify(result)).not.toContain('secret')
})

it('fails closed when a declared path cannot be sanitized', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(() => sanitizeCredentialPaths(cyclic, ['self.apiKey'])).toThrow('UNSAFE_TO_PERSIST')
})
```

- [ ] **Step 2: Write failing persistence and retention tests**

```ts
it('lists summaries without opening payload files and loads one detail lazily', async () => {
  const fs = new TrackingFileSystem(tempDirectory)
  const store = createLocalInteractionLogStore({ rootDirectory: tempDirectory, source: 'main', fs })
  await seedCompletedInteraction(store)
  fs.resetReads()

  await store.list({ transports: ['ipc'], limit: 20 })
  expect(fs.payloadReads).toBe(0)
  await store.getDetail('main:event-1')
  expect(fs.payloadReads).toBe(1)
})

it('prunes oldest events atomically by age and total bytes', async () => {
  // Seed old/current summaries and payloads, prune, then assert both files for the oldest event go.
})
```

- [ ] **Step 3: Run Task 2 tests and confirm RED**

Run: `corepack pnpm vitest run packages/observability/src/interaction-payload.test.ts packages/observability/src/local-interaction-store.test.ts`

Expected: FAIL because the local adapter and sanitizers do not exist.

- [ ] **Step 4: Implement path-scoped sanitation and bounded payload encoding**

```ts
export const DEFAULT_INTERACTION_RETENTION = {
  maxTotalBytes: 256 * 1024 * 1024,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxTextPayloadBytes: 4 * 1024 * 1024
} as const

export function encodeInteractionPayload(input: InteractionPayloadInput): EncodedPayload {
  if (input.kind === 'binary') return binaryMetadata(input)
  const text = input.kind === 'json' ? JSON.stringify(input.value, null, 2) : input.text
  return truncateUtf8(text, DEFAULT_INTERACTION_RETENTION.maxTextPayloadBytes)
}
```

- [ ] **Step 5: Implement source-isolated atomic persistence**

```text
<root>/main/index.ndjson
<root>/main/payloads/<event-id>.request.json.gz
<root>/main/payloads/<event-id>.response.json.gz
<root>/service/index.ndjson
<root>/service/payloads/...
```

Write payloads to `<name>.tmp`, `fsync`, then rename. Prefix public IDs with the source namespace. Treat missing/corrupt payloads as `payload-unavailable`; never fail the summary list.

- [ ] **Step 6: Implement restart recovery and idempotent pruning**

Run pruning after initialization and after completed writes using one serialized maintenance queue. Convert stale pending summaries to incomplete. Remove orphan `.tmp` and unreferenced payload files without touching another source namespace.

- [ ] **Step 7: Run focused tests**

Run: `corepack pnpm vitest run packages/observability/src/interaction-payload.test.ts packages/observability/src/local-interaction-store.test.ts packages/observability/src/interaction-store.test.ts`

Expected: PASS, including namespace collision, missing payload, corrupt line, 4 MiB truncation, binary metadata, and cleanup interruption cases.

- [ ] **Step 8: Commit Task 2**

```bash
git add packages/observability/src/local-interaction-store.ts packages/observability/src/local-interaction-store.test.ts packages/observability/src/interaction-payload.ts packages/observability/src/interaction-payload.test.ts packages/observability/src/index.ts
git commit -m "feat: persist bounded interaction payloads"
```

### Task 3: Capture real IPC and HTTP traffic

**Files:**
- Modify: `apps/desktop/src/main/logging.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/agent-ipc.ts`
- Modify: `apps/desktop/src/main/model-ipc.ts`
- Modify: `apps/desktop/src/main/agent-files-ipc.ts`
- Modify: `apps/desktop/src/main/logs-ipc.ts`
- Modify: `apps/desktop/src/main/interaction-logging.test.ts`
- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Modify: `apps/agent-runtime/src/service/http-service.ts`
- Modify: `apps/agent-runtime/tests/service-http.test.ts`
- Create: `apps/agent-runtime/src/service/websocket-interaction-recorder.ts`
- Create: `apps/agent-runtime/tests/websocket-interaction-recorder.test.ts`

**Interfaces:**
- Consumes: Task 1 recorder and Task 2 local store.
- Produces: real Main IPC and Runtime HTTP records plus `WebSocketInteractionRecorder` for future OpenSpec transport tasks 3.1–3.7.

- [ ] **Step 1: Write failing IPC capture tests**

```ts
it('captures request and response with one correlation id', async () => {
  const recorder = createMemoryRecorder()
  registerAgentIpcHandlers(ipc, runtime, recorder)
  await invokeRegistered('actiondriver:agent:submit', { goal: 'inspect logs' })
  expect(await recorder.store.getDetail(recorder.onlyEventId())).toMatchObject({
    transport: 'ipc',
    request: { text: expect.stringContaining('inspect logs') },
    response: { text: expect.stringContaining('taskId') }
  })
})
```

Add model-connection coverage asserting `draft.apiKey` is absent while non-secret fields remain.

Add a control-plane exclusion test asserting `actiondriver:log:list`, `actiondriver:log:detail`, and any future `actiondriver:log:*` channel do not call the interaction recorder. Keep the prefix rule centralized at the IPC capture boundary so automatic refresh cannot generate self-observation noise.

- [ ] **Step 2: Run IPC tests and confirm RED**

Run: `corepack pnpm vitest run apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/model-ipc.test.ts apps/desktop/src/main/agent-files-ipc.test.ts apps/desktop/src/main/interaction-logging.test.ts`

Expected: FAIL because handlers only emit response-size summaries.

- [ ] **Step 3: Pass request payload and declared secret paths through every IPC wrapper**

```ts
const finish = await interactions.start({
  transport: 'ipc',
  direction: 'renderer->service',
  operation: channel,
  request: { kind: 'json', value: input, secretPaths }
})
try {
  const value = await operation()
  await finish({ outcome: 'ok', response: { kind: 'json', value } })
  return { ok: true, value }
} catch (error) {
  await finish({ outcome: 'error', error: serialize(error) })
  throw error
}
```

- [ ] **Step 4: Write failing Runtime HTTP capture tests**

Assert authorized success, rejected authorization, JSON error, and binary/text response paths. Assert headers contain no Authorization value and request/response share one event ID.

Run: `corepack pnpm vitest run apps/agent-runtime/tests/service-http.test.ts`

Expected: FAIL because HTTP currently writes independent Pino lines with no body store.

- [ ] **Step 5: Instantiate source-specific stores and capture HTTP bodies**

Main uses `source: 'main'` and Runtime uses `source: 'service'` under the same resolved logs root. `sendJson()` returns the serialized response value to the recorder so status and body are completed exactly once. Health probes may record summaries without bodies.

- [ ] **Step 6: Define and test the WebSocket capture adapter without claiming a nonexistent call-site hookup**

```ts
export interface WebSocketInteractionRecorder {
  startCommand(message: WsCommand): Promise<(response: WsResponse) => Promise<void>>
  recordEvent(message: WsEvent): Promise<void>
}
```

The test pins `requestId`, `taskId`, request/response pairing, and one-way event semantics. Add an explicit module comment that real wiring is performed when `apps/agent-runtime` gains its WebSocket server under OpenSpec tasks 3.1–3.7.

- [ ] **Step 7: Run Task 3 tests**

Run: `corepack pnpm vitest run apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/model-ipc.test.ts apps/desktop/src/main/agent-files-ipc.test.ts apps/desktop/src/main/interaction-logging.test.ts apps/agent-runtime/tests/service-http.test.ts apps/agent-runtime/tests/websocket-interaction-recorder.test.ts`

Expected: PASS with no persisted credential values.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/desktop/src/main/logging.ts apps/desktop/src/main/index.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/model-ipc.ts apps/desktop/src/main/agent-files-ipc.ts apps/desktop/src/main/logs-ipc.ts apps/desktop/src/main/interaction-logging.test.ts apps/agent-runtime/src/runtime-process.ts apps/agent-runtime/src/service/http-service.ts apps/agent-runtime/src/service/websocket-interaction-recorder.ts apps/agent-runtime/tests/service-http.test.ts apps/agent-runtime/tests/websocket-interaction-recorder.test.ts
git commit -m "feat: capture IPC and HTTP request response logs"
```

### Task 4: Summary/detail query contract and merged local sources

**Files:**
- Modify: `apps/desktop/src/shared/log-ipc-contract.ts`
- Modify: `apps/desktop/src/main/logs-ipc.ts`
- Modify: `apps/desktop/src/main/interaction-logging.test.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/preload/desktop-api.test.ts`
- Modify: `apps/desktop/src/renderer/src/models/interaction-logs.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-interaction-logs.ts`
- Create: `apps/desktop/src/renderer/src/services/desktop-interaction-logs.test.ts`

**Interfaces:**
- Consumes: `InteractionLogStore.list()` and `getDetail()` from Tasks 1–2.
- Produces: `LOG_IPC_CHANNELS.list`, `LOG_IPC_CHANNELS.detail`, `LogsDesktopApi.detail(eventId)`, and Renderer `InteractionLogService.detail(eventId)`.

- [ ] **Step 1: Write failing contract tests for transport filtering and lazy detail**

```ts
expect(await api.logs.list({ transports: ['ipc', 'websocket'], limit: 50 })).toEqual({
  records: expect.any(Array),
  nextCursor: expect.anything(),
  files: expect.any(Array)
})
expect(await api.logs.detail('service:event-1')).toMatchObject({ id: 'service:event-1' })
```

Assert serialized list records have no `request`, `response`, or body text keys.

- [ ] **Step 2: Run contract tests and confirm RED**

Run: `corepack pnpm vitest run apps/desktop/src/main/interaction-logging.test.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/renderer/src/services/desktop-interaction-logs.test.ts`

Expected: FAIL because only the old list channel exists.

- [ ] **Step 3: Replace file-tail DTOs with typed summary/detail DTOs**

```ts
export const LOG_IPC_CHANNELS = {
  list: 'actiondriver:logs:list',
  detail: 'actiondriver:logs:detail'
} as const

export type LogListRequest = {
  level?: string
  direction?: string
  transports?: Array<'ipc' | 'http' | 'websocket'>
  search?: string
  cursor?: string
  limit?: number
}
```

- [ ] **Step 4: Implement merged chronological pagination and detail routing**

Merge Main and Service summary pages by `(time, id)`, apply a stable cursor, and route `main:*`/`service:*` detail IDs only to their owning store. Reject unknown prefixes as `invalid-event-id`.

- [ ] **Step 5: Run Task 4 tests**

Run: `corepack pnpm vitest run apps/desktop/src/main/interaction-logging.test.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/renderer/src/services/desktop-interaction-logs.test.ts`

Expected: PASS, including list-without-body, two-source ordering, cursor stability, unknown ID, and missing payload.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/desktop/src/shared/log-ipc-contract.ts apps/desktop/src/main/logs-ipc.ts apps/desktop/src/main/interaction-logging.test.ts apps/desktop/src/preload/desktop-api.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/renderer/src/models/interaction-logs.ts apps/desktop/src/renderer/src/services/desktop-interaction-logs.ts apps/desktop/src/renderer/src/services/desktop-interaction-logs.test.ts
git commit -m "feat: query interaction summaries and details"
```

### Task 5: Protocol filters and lazy Request/Response inspector

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/logs/InterfaceLogsView.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/LogsPage.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/settings.css`
- Modify: `apps/desktop/e2e/interaction-contracts.json`

**Interfaces:**
- Consumes: Task 4 `InteractionLogService.list()` and `detail()`.
- Produces: multi-select transport filtering and a stable lazy-loaded inspector with explicit event states.

- [ ] **Step 1: Write failing UI tests for protocol filtering**

```ts
await user.click(screen.getByTestId('e2e/settings/logs/transport#button'))
await user.click(screen.getByRole('menuitemcheckbox', { name: 'IPC' }))
await user.click(screen.getByRole('menuitemcheckbox', { name: 'WebSocket' }))
expect(list).toHaveBeenLastCalledWith(
  expect.objectContaining({ transports: ['ipc', 'websocket'] })
)
expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()
```

- [ ] **Step 2: Write failing lazy-detail and stale-response tests**

```ts
await user.click(screen.getByTestId('e2e/settings/logs/entries/0#button'))
expect(detail).toHaveBeenCalledWith('main:event-1')
expect(await screen.findByText('Request')).toBeVisible()
expect(screen.getByText('载荷已过期')).toBeVisible() // payload-unavailable fixture
```

Add a deferred detail promise, select a second event, resolve the first promise, and assert the first payload never replaces the second inspector.

- [ ] **Step 3: Run LogsPage tests and confirm RED**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/pages/LogsPage.test.tsx`

Expected: FAIL because transport filtering and `detail()` do not exist.

- [ ] **Step 4: Implement a compact transport multi-select without changing the shell**

Use the existing dropdown/menu visual language. The trigger text is `全部传输`, one selected label, or `已选 N 项`; options are IPC, HTTP, WebSocket. Selection updates `transports`, resets page 1, and composes with level/direction/search.

- [ ] **Step 5: Implement event-ID-stable detail loading**

Track `{ eventId, state: 'loading' | 'ready' | 'error', detail }`. Ignore a completed promise when its ID no longer matches the selected ID. Keep the inspector open across summary refresh; if the event disappears, retain the loaded detail until close, and show `载荷已过期` when the detail response reports expiration.

- [ ] **Step 6: Render truthful payload states and copying**

Render Request and Response independently for pending, incomplete, one-way, truncated, binary metadata, expired/missing, and JSON/text. Copy buttons copy the exact stored text only; unavailable and binary payloads have no body-copy action. Keep long text inside scrollable `<pre>` with wrapping disabled for JSON and enabled for plain text.

- [ ] **Step 7: Register every new interaction state**

Add stable IDs for transport trigger/options, Request/Response toggles, body copy, retry detail, and close. Update `interaction-contracts.json` so `pnpm validate:e2e-interactions` maps every control to the new tests.

- [ ] **Step 8: Run component and interaction validation**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/pages/LogsPage.test.tsx && corepack pnpm validate:e2e-interactions`

Expected: PASS with no overflow at long operation names or 4 MiB metadata fixtures.

- [ ] **Step 9: Commit Task 5**

```bash
git add apps/desktop/src/renderer/src/components/logs/InterfaceLogsView.tsx apps/desktop/src/renderer/src/pages/LogsPage.test.tsx apps/desktop/src/renderer/src/styles/settings.css apps/desktop/e2e/interaction-contracts.json
git commit -m "feat: inspect request response logs by protocol"
```

### Task 6: Integration, performance, security, and OpenSpec evidence

**Files:**
- Modify: `apps/desktop/e2e/local-runtime.spec.ts`
- Create: `packages/observability/tests/interaction-performance.test.ts`
- Modify: `openspec/changes/serve-runtime-over-http/tasks.md`
- Modify: `.superpowers/sdd/tasks-serve-runtime-over-http/progress.md` if this ignored ledger exists

**Interfaces:**
- Consumes: all previous tasks.
- Produces: end-to-end evidence and accurate OpenSpec task state; no new product API.

- [ ] **Step 1: Add a real local E2E before changing acceptance state**

Launch with an isolated user-data directory, exercise model connection list/test and an agent submit, open interface logs, filter IPC then HTTP, open one event, expand Request/Response, pause/resume refresh, and verify closing detail preserves filters. Inspect the generated payload files and assert the E2E token/API key fixtures do not appear.

- [ ] **Step 2: Add storage performance and boundary tests**

```ts
it('lists 100000 summaries without reading payloads', async () => {
  await seedSummaries(store, 100_000)
  const started = performance.now()
  const page = await store.list({ transports: ['http'], limit: 50 })
  expect(page.records).toHaveLength(50)
  expect(fs.payloadReads).toBe(0)
  expect(performance.now() - started).toBeLessThan(1_000)
})
```

Also verify a 4 MiB stored text payload loads only on detail and a larger payload is marked truncated with its original byte count.

- [ ] **Step 3: Run targeted integration and E2E checks**

Run: `corepack pnpm vitest run packages/observability/tests/interaction-performance.test.ts apps/desktop/src/renderer/src/pages/LogsPage.test.tsx apps/desktop/src/main/interaction-logging.test.ts apps/agent-runtime/tests/service-http.test.ts`

Run: `corepack pnpm test:e2e:local`

Expected: all targeted tests and local Electron E2E pass.

- [ ] **Step 4: Run the full project gate**

Run: `corepack pnpm check`

Expected: typecheck, interaction validation, lint, all Vitest tests, and production build exit 0.

- [ ] **Step 5: Update OpenSpec evidence truthfully**

Mark only completed log tasks. Keep WebSocket real call-site task 12.3/12.12 incomplete until the actual WebSocket service exists; record that the adapter and contract tests are complete but call-site integration is blocked by tasks 3.1–3.7.

- [ ] **Step 6: Validate OpenSpec and inspect the scoped diff**

Run: `openspec validate serve-runtime-over-http --strict`

Run: `git diff --check && git status --short`

Expected: strict validation passes; unrelated `design/actual/*.png` and `openspec/specs/desktop-shell/spec.md` remain unstaged.

- [ ] **Step 7: Commit Task 6**

```bash
git add apps/desktop/e2e/local-runtime.spec.ts packages/observability/tests/interaction-performance.test.ts openspec/changes/serve-runtime-over-http/tasks.md
git commit -m "test: verify request response interaction logs"
```

## Execution Handoff

Execution method is already selected: Native execution in the current task, directly on `main`, using TDD and scope-specific commits. Before implementation, the user reviews this plan and confirms it captures the approved design.
