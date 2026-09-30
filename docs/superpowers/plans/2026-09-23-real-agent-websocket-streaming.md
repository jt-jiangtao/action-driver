# Real OpenAI-Compatible WebSocket Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one real Agent flow that selects a persisted OpenAI-compatible model, creates a real session over WebSocket, renders streamed Markdown, persists the terminal result, and exposes one correlated Request/Response log.

**Architecture:** Keep configuration and queries on the existing typed bridge, but add a single Main-process WebSocket client connected directly to the Runtime HTTP service. The Runtime owns a versioned stream protocol, an official OpenAI Node SDK adapter for the provider hop, durable stream events, assistant-message reconciliation, and aggregate model-call logging. Renderer receives typed stream events through the narrow Preload bridge, updates one cached assistant message, and reconciles with the persisted terminal snapshot.

**Tech Stack:** TypeScript 5.9, Electron 38, React 19, Vitest 3, Playwright 1.63, SQLite/better-sqlite3, LangGraph, Fetch/ReadableStream, `ws` 8, Zod 4, markdown-it 15, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-23-minimal-agent-openai-vertical-slice-design.md`

## Global Constraints

- The stream subprotocol is exactly `action-driver.stream.v1`; an accepted response follows exactly `response.start → response.content* → response.end`.
- Main owns the local WebSocket connection; Renderer only receives the whitelisted typed API and never sees the local service token or provider credential.
- Runtime remains the sole writer for connections, credentials, sessions, tasks, messages, events, model calls, and logs.
- Production never falls back to `DeterministicModelGateway`, fake upstreams, Mock catalogs, or example logs.
- Provider credentials never appear in WebSocket envelopes, commands, fixtures, screenshots, persisted payloads, logs, copied content, or errors.
- Stream deltas are user-visible assistant text only; hidden chain-of-thought is never emitted.
- Renderer renders the accumulated assistant string with markdown-it `html: false`; it never renders an isolated delta as a Markdown document.
- A provider call creates one aggregate interaction log. Provider chunks and `response.content` events never create individual interaction logs.
- No Browser/Computer data means no right panel, toggle, placeholder, or hidden fixed-width slot.
- Run only focused tests after Tasks 1–6. Run full repository gates only in Task 7. Do not validate Figma.

## Review Focus

- A content event arrives before `request.accepted` finishes crossing IPC: buffer by `taskId` and replay after the persisted task projection loads; never lose the first delta.
- WebSocket reconnect replays an already applied event: deduplicate by `eventId`, reject older `sequence`, and reconcile `response.end.content` without appending twice.
- OpenAI sends a successful HTTP response followed by malformed SSE, an error event, or no text: produce one failed terminal event and one failed aggregate log, not a hanging task.
- User cancels after `response.start`: abort the provider request, preserve partial text, persist `cancelled`, and emit exactly one `response.end`.
- Real model service is unavailable or out of quota: show the real failure and logs; never switch to the automated fake service or Mock response.

---

## File Structure

### Versioned stream contract

- Create `packages/runtime-contracts/src/stream-protocol.ts`: discriminated client/server event unions, Zod schemas, parser helpers, IDs, status/error/usage types.
- Create `packages/runtime-contracts/src/stream-lifecycle.ts`: pure lifecycle/ordering guard used by Runtime and client tests.
- Modify `packages/runtime-contracts/src/index.ts`: export the stream contract.
- Create `packages/runtime-contracts/tests/stream-protocol.test.ts` and `stream-lifecycle.test.ts`.

### Provider streaming

- Add the latest Node 20-compatible major of the official `openai` package to `packages/model-connections`; configure `baseURL`, `maxRetries: 0`, `logLevel: 'off'`, a 15-second timeout, and request-level cancellation.
- Modify `packages/model-connections/src/types.ts`, `provider-adapters.ts`, `service.ts`, and `index.ts`: replace completion-only execution with a credential-free streaming port.
- Modify focused tests under `packages/model-connections/tests/`.

### Runtime orchestration and durability

- Modify `apps/agent-runtime/src/database.ts`, `ports.ts`, and `repositories.ts`: migration 4, durable stream request identity, event metadata, assistant-message upsert, atomic message/event commits, replay and snapshot reads.
- Modify `apps/agent-runtime/src/model-connections/model-gateway.ts`: yield visible deltas while keeping exactly one pending/completed interaction and model-call record.
- Modify `apps/agent-runtime/src/agent-graph.ts`: consume the streaming gateway and notify an observer without changing the Agent-only graph outcome.
- Create `apps/agent-runtime/src/stream-session-service.ts`: idempotent create/cancel/resume, accepted/start/content/end production, snapshot, active abort controllers.
- Add focused Runtime tests for migration, repositories, gateway, graph, and session service.

### WebSocket transport

- Add `ws` and its typings to the Runtime and Desktop packages/lockfile.
- Create `apps/agent-runtime/src/service/websocket-service.ts`: same-port upgrade handling, subprotocol/auth, parsing, Ping/Pong, close codes, backpressure guard, event dispatch.
- Modify `apps/agent-runtime/src/service/http-service.ts` and `runtime-process.ts`: attach the WebSocket server to the HTTP server and shut it down first.
- Create `apps/agent-runtime/tests/service-websocket.test.ts`.

### Desktop client and Renderer

- Create `apps/desktop/src/main/runtime-stream-client.ts`: one `ws` client, auth, request correlation, listener fan-out, reconnect/backoff, cursor resume, event dedupe.
- Modify `local-runtime.ts`, `runtime-supervisor.ts`, `index.ts`, `agent-ipc.ts`, shared IPC contracts, Preload API, and tests: submit through WebSocket, retain query RPC, forward typed events.
- Create `apps/desktop/src/renderer/src/services/stream-task-projection.ts`: pure event reducer and 50–100ms view coalescer.
- Modify `desktop-agent-adapter.ts`, `App.tsx`, `AgentResponse.tsx`, `TaskPage.tsx`, and `styles/agent.css`: immediate real session, streaming message, terminal reconciliation, generating state, fluid Agent-only layout.
- Modify focused Renderer tests.

### End-to-end

- Create `apps/desktop/e2e/support/fake-openai-stream-server.ts`: deterministic `/models` and SSE `/chat/completions` with captured request and chunk controls.
- Replace obsolete Mock task cases in `apps/desktop/e2e/local-runtime.spec.ts` with the real streaming vertical slice.
- Add a documented live smoke section to this plan; it uses the user's saved connection through the UI and never exports credentials.

---

### Task 1: Define the WebSocket stream contract and lifecycle guard

**Files:**

- Create: `packages/runtime-contracts/src/stream-protocol.ts`
- Create: `packages/runtime-contracts/src/stream-lifecycle.ts`
- Modify: `packages/runtime-contracts/src/index.ts`
- Create: `packages/runtime-contracts/tests/stream-protocol.test.ts`
- Create: `packages/runtime-contracts/tests/stream-lifecycle.test.ts`

**Interfaces:**

- Produces: `STREAM_PROTOCOL = 'action-driver.stream.v1'`.
- Produces: `StreamClientEvent`, `StreamServerEvent`, `RequestAcceptedEvent`, `ResponseStartEvent`, `ResponseContentEvent`, `ResponseEndEvent`, `ResponseSnapshotEvent`.
- Produces: `parseStreamClientEvent(value)`, `parseStreamServerEvent(value)`, `StreamLifecycleGuard.apply(event)`.
- Consumes: existing `ModelRef` and serializable contract rules.

- [ ] **Step 1: Write failing schema tests**

```ts
const accepted = parseStreamServerEvent({
  type: 'request.accepted',
  protocol: 'action-driver.stream.v1',
  eventId: 'event-accepted',
  cursor: 1,
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'message-agent-1',
  occurredAt: '2026-09-23T00:00:00.000Z'
})
expect(accepted.type).toBe('request.accepted')
```

Also reject unknown fields, blank IDs, unsupported protocol, negative cursors/sequences, credentials in `request.create`, and `response.end` without final `content`.

- [ ] **Step 2: Run the tests and verify failure**

Run: `corepack pnpm exec vitest run packages/runtime-contracts/tests/stream-protocol.test.ts packages/runtime-contracts/tests/stream-lifecycle.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict discriminated schemas**

Use these stable payloads:

```ts
type RequestCreateEvent = {
  type: 'request.create'
  protocol: typeof STREAM_PROTOCOL
  eventId: string
  requestId: string
  idempotencyKey: string
  sessionId: string | null
  createdAt: string
  payload: {
    input: { role: 'user'; content: string }
    model: ModelRef
    systemPrompt?: string
    skills: []
  }
}

type ResponseContentEvent = StreamIdentity & {
  type: 'response.content'
  sequence: number
  delta: string
  contentIndex: number
  occurredAt: string
}

type ResponseEndEvent = StreamIdentity & {
  type: 'response.end'
  sequence: number
  status: 'completed' | 'failed' | 'cancelled'
  content: string
  finishReason: string | null
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null
  durationMs: number
  error: { code: string; message: string; retryable: boolean } | null
  occurredAt: string
}
```

`StreamIdentity` contains `protocol`, `eventId`, `cursor`, `requestId`, `sessionId`, `taskId`, `responseId`, `streamId`, and `messageId`.

- [ ] **Step 4: Implement the lifecycle guard**

Track `started`, `ended`, `lastSequence`, and applied `eventId` values per `responseId`. Return `'duplicate'` for an applied event, throw `StreamProtocolError('SEQUENCE_GAP')` for a gap, reject content before start and all events after end, and accept exactly one terminal event.

- [ ] **Step 5: Run focused tests**

Run: `corepack pnpm exec vitest run packages/runtime-contracts/tests/stream-protocol.test.ts packages/runtime-contracts/tests/stream-lifecycle.test.ts packages/runtime-contracts/tests/protocol.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-contracts
git commit -m "feat: define agent streaming protocol"
```

### Task 2: Stream the real OpenAI-compatible response

**Files:**

- Modify: `packages/model-connections/package.json`
- Modify: `packages/model-connections/src/types.ts`
- Modify: `packages/model-connections/src/provider-adapters.ts`
- Modify: `packages/model-connections/src/service.ts`
- Modify: `packages/model-connections/src/index.ts`
- Modify: `packages/model-connections/tests/provider-adapters.test.ts`
- Modify: `packages/model-connections/tests/model-connection-service.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `ModelCompletionEvent = { kind: 'content'; delta: string } | { kind: 'end'; content: string; finishReason: string | null; usage: ModelUsage | null; requestBody: unknown; responseBody: unknown; status: number }`.
- Produces: `ModelCompletionServicePort.stream(request, signal): AsyncIterable<ModelCompletionEvent>`.
- Consumes: exact `ModelRef`, persisted connection validation, provider error classification.

- [ ] **Step 1: Write failing SDK adapter tests**

Inject a fake OpenAI client factory whose `chat.completions.create({ stream: true })` result yields split visible deltas, a finish reason, and a final usage-only chunk. Assert that the adapter emits visible content events followed by one aggregate terminal event, configures the exact saved `baseURL`, sets `maxRetries: 0`, `logLevel: 'off'`, and the 15-second timeout, and forwards the caller `AbortSignal`. Add authentication, rate-limit, timeout, cancellation, blank-content, and early-end cases using SDK-shaped errors and streams.

- [ ] **Step 2: Run and verify failure**

Run: `corepack pnpm exec vitest run packages/model-connections/tests/provider-adapters.test.ts packages/model-connections/tests/model-connection-service.test.ts`

Expected: FAIL because the SDK streaming adapter APIs do not exist.

- [ ] **Step 3: Add and configure the official SDK**

Install the latest official `openai` major compatible with the repository's Node 20 baseline. Create the client only after connection/model validation and decryption. Configure `apiKey`, normalized `baseURL`, `maxRetries: 0`, `logLevel: 'off'`, and `timeout: 15_000`; pass the caller `AbortSignal` to the request. Keep the existing `HttpTransport.request()` path unchanged for discovery, connection tests, and model probes.

- [ ] **Step 4: Implement the SDK chunk adapter**

Iterate the SDK stream exactly once. Emit only non-empty `choices[0].delta.content`, aggregate visible content, record the last non-null `finish_reason`, normalize final usage, and produce one terminal event only after the iterator ends normally with a finish reason. Map SDK authentication, not-found/model-not-found, rate-limit, provider, connection, timeout, abort, malformed-stream, blank-content, and early-end failures into credential-free domain errors.

- [ ] **Step 5: Replace completion execution with streaming**

Send:

```ts
{
  model: modelId,
  messages,
  temperature,
  max_tokens,
  stream: true,
  stream_options: { include_usage: true }
}
```

Keep Anthropic execution rejected before network I/O. Resolve the selected connection by both IDs, decrypt only after validation, and never yield base URL, API key, or headers.

- [ ] **Step 6: Run focused tests**

Run: `corepack pnpm exec vitest run packages/model-connections/tests/http-transport.test.ts packages/model-connections/tests/provider-adapters.test.ts packages/model-connections/tests/model-connection-service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/model-connections
git commit -m "feat: stream openai compatible responses"
```

### Task 3: Persist and orchestrate a recoverable streaming task

**Files:**

- Modify: `apps/agent-runtime/src/database.ts`
- Modify: `apps/agent-runtime/src/ports.ts`
- Modify: `apps/agent-runtime/src/repositories.ts`
- Modify: `apps/agent-runtime/src/model-connections/model-gateway.ts`
- Modify: `apps/agent-runtime/src/agent-graph.ts`
- Create: `apps/agent-runtime/src/stream-session-service.ts`
- Modify: `apps/agent-runtime/src/index.ts`
- Modify: `apps/agent-runtime/tests/database.test.ts`
- Modify: `apps/agent-runtime/tests/repositories.test.ts`
- Modify: `apps/agent-runtime/tests/model-gateway.test.ts`
- Modify: `apps/agent-runtime/tests/agent-graph.test.ts`
- Create: `apps/agent-runtime/tests/stream-session-service.test.ts`

**Interfaces:**

- Produces: `ModelGateway.stream(request, signal): AsyncIterable<ModelGatewayEvent>`.
- Produces: `StreamSessionService.handle(clientEvent, emit): Promise<void>`.
- Produces: `StreamRequestRepository`, atomic `createStreamTask`, `commitAssistantContentWithEvent`, `finishStreamTask`, replay and snapshot reads.
- Consumes: Task 1 protocol and Task 2 model stream.

- [ ] **Step 1: Write migration/repository failures**

Migration 4 adds `stream_requests` with unique `idempotency_key`, stable request/session/task/response/stream/message IDs, status, last sequence and timestamps. Add nullable stream identity columns plus unique `event_id` to `runtime_events`. Test that a duplicate idempotency key returns the original record and that assistant content plus its event commit atomically.

- [ ] **Step 2: Run persistence tests and verify failure**

Run: `corepack pnpm exec vitest run apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts`

Expected: FAIL at migration version 4 and missing stream repositories.

- [ ] **Step 3: Implement migration and atomic repository methods**

Generate a distinct `sessionId` and store it in the existing task `thread_id`; do not equate it with `taskId`. On create, one transaction writes stream request, task, user message, empty assistant message, and accepted event. On each content event, one transaction upserts the assistant aggregate and appends the uniquely identified event. On end, one transaction writes final assistant content, task status/error, stream status, and terminal event.

- [ ] **Step 4: Write gateway and graph streaming failures**

Assert deltas are yielded before the provider completes, one model-call record changes `running → completed|failed`, and one interaction detail contains the aggregate response. Assert cancellation preserves partial text and no content chunk calls `interactions.start()`.

- [ ] **Step 5: Implement streaming gateway and graph observer**

Change the gateway to:

```ts
interface ModelGateway {
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelGatewayEvent>
}
```

`LangGraphRunner.run` accepts an optional `ModelEventObserver`; it consumes the stream, forwards content events, and returns the final aggregate as the existing Agent graph output. The gateway owns aggregate model-call/interaction persistence, while `StreamSessionService` owns task/message/event persistence.

- [ ] **Step 6: Implement `StreamSessionService`**

For `request.create`, validate `skills=[]`, resolve duplicate idempotency before network I/O, atomically create the durable projection, emit accepted, then run with an `AbortController`. Emit/persist start, ordered content, and exactly one end. `request.cancel` aborts the active controller. `request.resume(afterCursor)` replays stored events; when the cursor is outside retained history, emit a snapshot built from persisted task/messages.

- [ ] **Step 7: Run focused Runtime tests**

Run: `corepack pnpm exec vitest run apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts apps/agent-runtime/tests/model-gateway.test.ts apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/tests/stream-session-service.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/agent-runtime/src apps/agent-runtime/tests
git commit -m "feat: persist streaming agent sessions"
```

### Task 4: Serve the stream over one authenticated WebSocket

**Files:**

- Modify: `apps/agent-runtime/package.json`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/agent-runtime/src/service/websocket-service.ts`
- Modify: `apps/agent-runtime/src/service/http-service.ts`
- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Create: `apps/agent-runtime/tests/service-websocket.test.ts`
- Modify: `apps/agent-runtime/tests/service-http.test.ts`
- Modify: `apps/agent-runtime/tests/runtime-process.test.ts`

**Interfaces:**

- Produces: same-port `ws://127.0.0.1:<port>/stream` using `action-driver.stream.v1`.
- Produces: authenticated socket sessions backed by one `StreamSessionService`.
- Consumes: Task 1 parsing, Task 3 service, existing one-time service token and HTTP server.

- [ ] **Step 1: Install the WebSocket dependency**

Run:

```bash
corepack pnpm --filter @action-driver/agent-runtime add ws@8.21.3
corepack pnpm --filter @action-driver/desktop add ws@8.21.3
corepack pnpm --filter @action-driver/agent-runtime --filter @action-driver/desktop add -D @types/ws
```

Expected: both app manifests and `pnpm-lock.yaml` change; no other dependency is introduced.

- [ ] **Step 2: Write failing transport tests**

Cover wrong/missing subprotocol (1002), invalid auth event (1008), oversized JSON (1009), invalid event schema (1002), successful `session.ready`, create-to-end ordering, native Ping/Pong, and shutdown. Assert the auth payload and token do not reach the interaction log.

- [ ] **Step 3: Run and verify failure**

Run: `corepack pnpm exec vitest run apps/agent-runtime/tests/service-websocket.test.ts apps/agent-runtime/tests/service-http.test.ts`

Expected: FAIL because the upgrade handler does not exist.

- [ ] **Step 4: Attach `WebSocketServer({ noServer: true })` to the existing HTTP server**

Accept only path `/stream` and exact subprotocol. Require `auth` as the first parsed event, compare the token with the same digest/timing-safe check as HTTP, then emit `session.ready`. Delegate subsequent client events to `StreamSessionService`. Use `socket.bufferedAmount` to close overloaded clients with 1013 before unbounded queuing. Never pass auth messages to `InteractionLogRecorder`.

- [ ] **Step 5: Wire process lifecycle**

Create the session service from the existing repositories, graph runner, IDs, and clock; attach WebSocket before listening; include the stream path/protocol in Runtime readiness metadata; close sockets and abort active tasks before closing HTTP, SQLite, and logging.

- [ ] **Step 6: Run focused service tests**

Run: `corepack pnpm exec vitest run apps/agent-runtime/tests/service-websocket.test.ts apps/agent-runtime/tests/service-http.test.ts apps/agent-runtime/tests/runtime-process.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/agent-runtime apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat: expose runtime websocket stream"
```

### Task 5: Connect Electron Main directly and expose a narrow stream API

**Files:**

- Create: `apps/desktop/src/main/runtime-stream-client.ts`
- Create: `apps/desktop/src/main/runtime-stream-client.test.ts`
- Modify: `apps/desktop/src/main/local-runtime.ts`
- Modify: `apps/desktop/src/main/runtime-supervisor.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/agent-ipc.ts`
- Modify: `apps/desktop/src/main/agent-ipc.test.ts`
- Modify: `apps/desktop/src/shared/agent-ipc-contract.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/preload/desktop-api.test.ts`

**Interfaces:**

- Produces: `RuntimeStreamClient.connect({ baseUrl, token })`, `create(request)`, `cancel(taskId)`, `subscribe(listener)`, `close()`.
- Produces Preload methods: `agent.submit(request)`, `agent.cancel(taskId)`, `agent.subscribeStream(listener)`.
- Keeps existing RPC-backed `get`, `listTasks`, `listModelLogs`, and `getModelLog`.

- [ ] **Step 1: Write failing Main client tests**

Use an in-process `ws` server. Assert auth then `session.ready`, request correlation by `requestId`, event listener delivery, duplicate `eventId` suppression, cursor advancement only after delivery, reconnect with `request.resume`, exponential retry, and 1008 as a non-retryable auth failure.

- [ ] **Step 2: Run and verify failure**

Run: `corepack pnpm exec vitest run apps/desktop/src/main/runtime-stream-client.test.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/preload/desktop-api.test.ts`

Expected: FAIL because the stream client and API are missing.

- [ ] **Step 3: Implement the single Main-process client**

Convert the reported HTTP base URL to `ws://.../stream`, set the exact subprotocol, send auth after open, and wait for `session.ready`. Keep one connection for the application. Buffer no unbounded event history: retain only pending request resolvers, last applied cursor, lifecycle guards, and listener references. Reconnect retryable closes with bounded exponential backoff plus jitter and immediately send `request.resume(afterCursor)`.

- [ ] **Step 4: Route submit/cancel through WebSocket**

`AGENT_IPC_CHANNELS.submit` reads the current main prompt through the existing `getSystemPrompt` dependency, calls `RuntimeStreamClient.create` with that prompt, and returns the accepted IDs. Add one global stream-event channel; install the IPC listener before sending create so a fast first content event cannot race ahead of Renderer subscription. Keep legacy RPC submission code unreachable from local production and retain query RPCs.

- [ ] **Step 5: Connect after Runtime readiness and close before shutdown**

After `runtimeSupervisor.start()`, connect using the reported base URL and in-memory service token, then register agent IPC. On Runtime restart, reconnect to the new base URL. During app quit, close stream client before stopping the supervisor. Never expose `serviceUrl` or token through Preload.

- [ ] **Step 6: Run focused desktop-boundary tests**

Run: `corepack pnpm exec vitest run apps/desktop/src/main/runtime-stream-client.test.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/main/runtime-supervisor.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main apps/desktop/src/shared apps/desktop/src/preload
git commit -m "feat: bridge runtime websocket events"
```

### Task 6: Render one live Markdown response and reconcile terminal state

**Files:**

- Create: `apps/desktop/src/renderer/src/services/stream-task-projection.ts`
- Create: `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agent/AgentResponse.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Conversation.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/agent.css`

**Interfaces:**

- Produces: `StreamTaskProjection.apply(event)`, `attach(task)`, `flush()`, and immutable `TaskProjection` snapshots.
- Consumes: typed server events, async task query, existing `MarkdownContent`.

- [ ] **Step 1: Write failing pure projection tests**

Test content before accepted-query completion, two deltas that split a fenced code block, duplicate `eventId`, old sequence, sequence gap, failed/cancelled partial text, and terminal full-content replacement. Inject a fake scheduler and assert multiple deltas create one view notification within 75ms.

- [ ] **Step 2: Run and verify failure**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`

Expected: FAIL because the projection reducer does not exist.

- [ ] **Step 3: Implement buffering, coalescing, and reconciliation**

Subscribe to stream events before `api.submit`. After accepted, fetch the already-persisted task containing the user message and empty assistant message, attach it, then replay buffered events. Content mutates only the matching assistant `messageId`; schedule one immutable emit every 75ms. End replaces content with the terminal full string and sets `succeeded`/`failed`; cancelled maps to the existing `paused` projection with an explicit cancelled detail and never reports success.

- [ ] **Step 4: Update visible generating and Markdown states**

Render the accumulated full content through existing `MarkdownContent`. For an empty running assistant message render an accessible “正在生成” indicator; remove it when content arrives or the response ends. Preserve partial Markdown on failure/cancel. Do not introduce a second input box or HTML-enabled Markdown.

- [ ] **Step 5: Make Agent-only layout fluid**

For `data-mode='agent-only'`, use `grid-template-columns: minmax(0, 1fr)`; remove the 1192px fixed track from that state. Do not render `.browser-panel-slot` or any expand/collapse control when `task.browser === null`. Keep split/browser modes unchanged.

- [ ] **Step 6: Run focused Renderer tests**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts apps/desktop/src/renderer/src/components/Conversation.test.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx apps/desktop/src/renderer/src/App.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "feat: render streaming agent markdown"
```

### Task 7: Prove automated and real-service vertical slices

**Files:**

- Create: `apps/desktop/e2e/support/fake-openai-stream-server.ts`
- Modify: `apps/desktop/e2e/local-runtime.spec.ts`
- Modify: `apps/desktop/e2e/interaction-contracts.json` only if new user interactions require declarations
- Modify: `openspec/changes/serve-runtime-over-http/tasks.md` to check completed 0.x tasks after evidence exists

**Interfaces:**

- Consumes: the complete local production composition, isolated E2E profile, and user-owned real model connection for live smoke.
- Produces: deterministic automated evidence plus one real-provider smoke result.

- [ ] **Step 1: Build the deterministic SSE server**

Expose `GET /models` and `POST /chat/completions`. Capture model/messages, require `stream: true`, emit at least three delayed frames that split a Markdown code fence, include usage, then `[DONE]`. Provide test controls for disconnect and provider error without accepting or logging real credentials.

- [ ] **Step 2: Replace the obsolete Mock E2E path**

In an isolated profile, add/enable the fake connection through the real configuration API/UI, select it, submit, assert the real task page appears before final content, observe at least one partial render, then final Markdown. Assert there is no browser panel, task/list/detail survive restart, and interface/model logs expose exactly one correlated aggregate call with full final response and no `action-driver:log:*` recursion.

- [ ] **Step 3: Run task-level E2E**

Run: `corepack pnpm test:e2e:local`

Expected: PASS with the fake server receiving `stream: true`, final visible Markdown, one aggregate provider log, no Browser/Computer UI, and no credential text in persisted interaction files.

- [ ] **Step 4: Run the real model live smoke**

Launch the normal local app with the user's existing profile using `corepack pnpm dev`. In the UI:

1. Select an already enabled OpenAI-compatible model connection.
2. Send: `请用 Markdown 返回一个标题和两条项目符号，并在最后写“流式完成”。`
3. Confirm the task page opens immediately and content grows before completion.
4. Confirm the final rendered response contains a heading, two list items, and “流式完成”.
5. Open model-layer and interface-layer logs and confirm the same `taskId`/`requestId`/`correlationId`, one provider Request/Response, real final response, usage/finish status when supplied, and no per-chunk records.
6. Confirm no right panel opened and no secret appears in the UI or logs.

If the provider rejects, times out, or has no quota, record that exact real failure and fix only product defects; never substitute the fake server as live-smoke success.

- [ ] **Step 5: Run final verification once**

Run:

```bash
corepack pnpm check
corepack pnpm test:e2e:local
openspec validate serve-runtime-over-http --strict
```

Expected: all commands exit 0. Do not run Figma validation.

- [ ] **Step 6: Update OpenSpec completion evidence**

Check only the completed `0.1–0.9` items whose tests/live evidence succeeded; leave deferred groups untouched.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/e2e openspec/changes/serve-runtime-over-http/tasks.md
git commit -m "test: verify real streaming agent flow"
```
