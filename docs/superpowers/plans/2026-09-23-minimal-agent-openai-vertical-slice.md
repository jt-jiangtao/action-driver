# Real OpenAI-Compatible Minimal Agent Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one real, restart-safe Agent flow from persisted model selection through a non-streaming OpenAI-compatible request to real task/session lists and correlated interface/model logs.

**Architecture:** Keep Electron Renderer behind the existing typed Preload/Main bridge while `apps/agent-runtime` remains the sole owner of model credentials, task data, model calls, and runtime events. A shared `ModelConnectionService` resolves `{ connectionId, modelId }`; a runtime gateway performs one real completion, persists its model call and messages, and records `service->model` interaction data. Renderer local composition consumes only runtime-backed projections, while mock composition remains explicit for unit and visual tests.

**Tech Stack:** TypeScript 5.9, Electron 38, React 19, Vitest 3, Playwright 1.63, SQLite/better-sqlite3, LangGraph, Node HTTP/fetch, Inversify, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-23-minimal-agent-openai-vertical-slice-design.md`

## Global Constraints

- Local production composition must never fall back to `DeterministicModelGateway`, `MockTaskCatalog`, mock model-log sessions, or a hard-coded default model.
- The selected model identity is exactly `{ connectionId: string; modelId: string }`; `modelId` alone is never authoritative.
- Only enabled, text-capable OpenAI-compatible models execute in this slice; Anthropic remains configurable but is disabled in Agent selection with the copy `Agent 调用暂未接入`.
- Execution is one non-streaming completion with `skills: []`; do not register or invoke Browser/Computer providers and do not render their panels.
- Runtime remains the sole writer for model connections, credentials, tasks, messages, model calls, and runtime events.
- API keys and service credentials must never appear in task contracts, stored task/model data, log summaries, log payloads, copied log content, or errors.
- Business bodies—system prompt, user input, model request, and model response—are stored as-is subject to existing log retention and size limits.
- Run targeted tests after each task; run the complete repository gates only after the vertical slice is complete. Do not perform Figma validation.

## Review Focus

- Two connections expose the same `modelId`: selection and execution must resolve the chosen `connectionId`, covered in Task 1 and Task 3 tests.
- A selected model is deleted or disabled between loading and submit: Runtime must reject before network I/O and UI must clear/disable submission, covered in Task 3 and Task 5 tests.
- Upstream returns 200 without usable assistant text: task must fail with `invalid-response`, not save an empty success message, covered in Task 2 and Task 3 tests.
- Application restarts after a success or failure: lists, messages, terminal state, and model logs must match persisted data, covered in Task 4 and Task 7 tests.
- Viewing or refreshing logs creates recursive `actiondriver:log:*` entries or leaks credentials: both must remain absent, covered in Task 4, Task 6, and Task 7 tests.

---

## File Structure

### Shared contracts

- Modify `packages/contracts/src/index.ts`: define `ModelRef`, `AgentGoalRequest`, real recent-task query types, and async query ports used by Renderer.
- Modify `packages/runtime-contracts/src/protocol.ts`: add model-aware submit plus `task.list`, `model-log.list`, and `model-log.get` commands.
- Modify `packages/runtime-contracts/src/schemas.ts`: validate the new request/response shapes at the RPC boundary.
- Modify contract tests under `packages/contracts/tests/` and `packages/runtime-contracts/tests/`.

### Model execution

- Modify `packages/model-connections/src/types.ts`: add internal completion request/result types without credentials.
- Modify `packages/model-connections/src/provider-adapters.ts`: implement non-streaming OpenAI-compatible completion parsing and error classification.
- Modify `packages/model-connections/src/service.ts`: resolve a persisted enabled model, decrypt internally, and execute completion.
- Modify tests in `packages/model-connections/tests/`.

### Runtime persistence and composition

- Modify `apps/agent-runtime/src/database.ts`: forward-only migration for task model/error fields and model-call records.
- Modify `apps/agent-runtime/src/ports.ts`: carry `ModelRef`, typed runtime failures, list methods, message/model-call repositories, and model log projections.
- Modify `apps/agent-runtime/src/repositories.ts`: implement task listing, messages, model calls, and restart-safe reads.
- Create `apps/agent-runtime/src/model-connections/model-gateway.ts`: bridge `ModelConnectionService` to `ModelGateway`, persistence, and `service->model` interaction recording.
- Modify `apps/agent-runtime/src/agent-graph.ts`: pass the exact model reference through the single model call.
- Modify `apps/agent-runtime/src/local-adapters.ts`: accept the real gateway and an empty skill registry; remove production deterministic/hosted providers.
- Modify `apps/agent-runtime/src/local-runtime-server.ts`: save user/assistant/error data and expose real task/model-log queries.
- Modify `apps/agent-runtime/src/runtime-process.ts`: construct one database, one model connection service, one interaction recorder, and one runtime composition.
- Modify runtime tests under `apps/agent-runtime/tests/`.

### Desktop bridge and Renderer

- Modify `apps/desktop/src/shared/agent-ipc-contract.ts`, `apps/desktop/src/main/agent-ipc.ts`, and `apps/desktop/src/preload/desktop-api.ts`: transport model-aware submit and real query commands.
- Modify `apps/desktop/src/renderer/src/models/model-selection.ts`: represent selection by `ModelRef | null`, disabled options, and empty/loading/error state.
- Modify `apps/desktop/src/renderer/src/models/task-catalog.ts`: make real task list/detail queries asynchronous.
- Modify `apps/desktop/src/renderer/src/models/model-logs.ts`: remove exported production fixtures and define the model-log service contract.
- Create `apps/desktop/src/renderer/src/services/desktop-task-catalog.ts`: runtime-backed recent task/detail adapter.
- Create `apps/desktop/src/renderer/src/services/desktop-model-logs.ts`: runtime-backed model-log adapter.
- Modify `apps/desktop/src/renderer/src/di/container.ts`: bind real adapters in local mode and mocks only in mock mode.
- Modify `apps/desktop/src/renderer/src/App.tsx`, model selector components, `TaskPage.tsx`, `LogsPage.tsx`, and `ModelLogsView.tsx`: load and render real states.
- Update focused Renderer tests and `apps/desktop/e2e/interaction-contracts.json` only where interactions change.

### End-to-end harness

- Create `apps/desktop/e2e/support/fake-openai-server.ts`: deterministic local `/models` and `/chat/completions` server with captured requests.
- Rewrite the minimal-flow cases in `apps/desktop/e2e/local-runtime.spec.ts`: add connection, select model, submit, inspect lists/logs, restart, and assert no credentials or Browser/Computer UI.

---

### Task 1: Make model identity and real query contracts explicit

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`
- Modify: `packages/runtime-contracts/src/protocol.ts`
- Modify: `packages/runtime-contracts/src/schemas.ts`
- Modify: `packages/runtime-contracts/tests/protocol.test.ts`
- Modify: `packages/runtime-contracts/tests/runtime-rpc.test.ts`

**Interfaces:**

- Produces: `ModelRef`, `AgentGoalRequest`, `RecentTaskProjection`, `ModelLogSessionProjection`, `ModelLogTaskProjection`, `ModelLogCallProjection`.
- Produces runtime commands: `task.submit`, `task.list`, `model-log.list`, `model-log.get`.
- Consumes: existing `TaskProjection`, `RuntimeCommandMap`, and RPC schema validation.

- [ ] **Step 1: Add failing shared-contract tests for exact model identity**

```ts
const request: AgentGoalRequest = {
  goal: '总结本周进展',
  model: { connectionId: 'connection-a', modelId: 'shared-model' }
}
expect(request.model).toEqual({ connectionId: 'connection-a', modelId: 'shared-model' })
expect(isSerializableContract(request)).toBe(true)
```

Also assert `RecentTaskProjection` carries `id`, `sessionId`, `title`, `status`, `model`, `createdAt`, and `updatedAt`, and that model-log calls carry `taskId`, `requestId`, and `correlationId`.

- [ ] **Step 2: Run the contract tests and verify failure**

Run: `pnpm exec vitest run packages/contracts/tests/contracts.test.ts packages/runtime-contracts/tests/protocol.test.ts`

Expected: FAIL because `AgentGoalRequest`, `ModelRef`, and the new runtime commands do not exist.

- [ ] **Step 3: Define the shared types and service signatures**

Add the following stable shapes to `packages/contracts/src/index.ts`:

```ts
export type ModelRef = { connectionId: string; modelId: string }

export type AgentGoalRequest = {
  goal: string
  model: ModelRef
}

export type RecentTaskProjection = {
  id: string
  sessionId: string
  title: string
  status: SkillExecutionState
  model: ModelRef
  createdAt: string
  updatedAt: string
}

export interface AgentCommandService {
  submitGoal(request: AgentGoalRequest): Promise<TaskProjection>
  interrupt(taskId: string): Promise<void>
  continueTask(taskId: string): Promise<void>
}

export interface TaskQueryService {
  listRecentTasks(): Promise<readonly RecentTaskProjection[]>
  getTask(taskId: string): Promise<TaskProjection | null>
}
```

Define model-log projections in the same package so Runtime and Renderer do not duplicate DTOs. Use `sessionId = threadId` for this one-task-per-session slice, while keeping `tasks: ModelLogTaskProjection[]` in the session contract.

- [ ] **Step 4: Extend and validate runtime commands**

Change `task.submit.request` to:

```ts
{
  goal: string
  model: ModelRef
  systemPrompt?: string
  skills: []
}
```

Add:

```ts
'task.list': { request: { limit?: number }; response: { tasks: RecentTaskProjection[] } }
'model-log.list': {
  request: { status?: 'completed' | 'running' | 'failed'; query?: string }
  response: { sessions: ModelLogSessionProjection[] }
}
'model-log.get': {
  request: { taskId: string }
  response: { session: ModelLogSessionProjection | null }
}
```

Update Zod/runtime validators to reject a blank `connectionId`, blank `modelId`, non-empty `skills`, and unknown command fields.

- [ ] **Step 5: Add RPC round-trip tests**

```ts
await expect(
  client.request('task.submit', {
    goal: 'hello',
    model: { connectionId: 'connection-a', modelId: 'shared-model' },
    skills: []
  })
).resolves.toEqual({ taskId: 'task-1' })
```

Add a rejection case for `{ model: { connectionId: '', modelId: 'x' } }` and a duplicate-model case proving the request preserves `connectionId`.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run packages/contracts/tests/contracts.test.ts packages/runtime-contracts/tests/protocol.test.ts packages/runtime-contracts/tests/runtime-rpc.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the contract boundary**

```bash
git add packages/contracts packages/runtime-contracts
git commit -m "feat: define real agent model contracts"
```

### Task 2: Add a real OpenAI-compatible completion operation

**Files:**

- Modify: `packages/model-connections/src/types.ts`
- Modify: `packages/model-connections/src/provider-adapters.ts`
- Modify: `packages/model-connections/src/service.ts`
- Modify: `packages/model-connections/src/index.ts`
- Modify: `packages/model-connections/tests/provider-adapters.test.ts`
- Modify: `packages/model-connections/tests/model-connection-service.test.ts`

**Interfaces:**

- Consumes: `ModelRef`, stored connections, `HttpTransport`, and existing provider failure codes.
- Produces: `ModelCompletionRequest`, `ModelCompletionOutcome`, and `ModelConnectionService.complete(request, signal)`.

- [ ] **Step 1: Write failing provider completion tests**

Use the existing fake `HttpTransport` test helper and assert the exact outgoing request:

```ts
expect(captured).toMatchObject({
  url: 'http://provider.test/v1/chat/completions',
  method: 'POST',
  headers: { authorization: 'Bearer secret-key' },
  body: {
    model: 'gpt-real',
    messages: [
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'user text' }
    ],
    temperature: 0,
    stream: false
  }
})
```

Return `{ choices: [{ message: { role: 'assistant', content: 'real answer' } }] }` and expect the parsed content. Add cases for 200 with missing/blank content, 401, 429, timeout, and an aborted signal.

- [ ] **Step 2: Run provider tests and verify failure**

Run: `pnpm exec vitest run packages/model-connections/tests/provider-adapters.test.ts`

Expected: FAIL because `complete` is not part of `ModelProviderAdapter`.

- [ ] **Step 3: Define completion request/result without credentials**

```ts
export type ModelCompletionRequest = {
  model: ModelRef
  requestId: string
  taskId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  parameters: { temperature?: number; maxTokens?: number }
}

export type ModelCompletionOutcome =
  | {
      ok: true
      value: {
        content: string
        providerProtocol: 'openai-compatible'
        requestBody: unknown
        responseBody: unknown
        status: number
      }
    }
  | {
      ok: false
      failure: ModelFailure & { retryable: boolean }
      requestBody: unknown
      responseBody: unknown | null
      status: number | null
    }
```

Do not include `baseUrl`, `apiKey`, or authorization headers in either exported result.

- [ ] **Step 4: Implement OpenAI-compatible parsing and exact error mapping**

Add `complete` to `ModelProviderAdapter`. For OpenAI-compatible requests set `stream: false`, include `max_tokens` only when supplied, and require the first choice's `message.content` to be a non-empty string. Return an unsuccessful `ModelCompletionOutcome` for malformed or blank success bodies, HTTP errors, network errors, timeouts, and cancellation; retain the safe request body and actual response body/status when they exist so the logging layer can diagnose failures. For the Anthropic adapter return an `invalid-request` outcome with `Agent 调用暂未接入`; do not send a network request.

- [ ] **Step 5: Write failing service resolution tests**

Persist two connections with the same model id and different encrypted secrets. Assert:

```ts
await service.complete({
  model: { connectionId: 'second', modelId: 'shared-model' },
  requestId: 'request-1',
  taskId: 'task-1',
  messages: [{ role: 'user', content: 'hello' }],
  parameters: { temperature: 0 }
})
expect(transport.lastRequest.headers.authorization).toBe('Bearer second-secret')
```

Add no-network assertions for missing connection, disabled model, failed/unsupported text model, and Anthropic protocol.

- [ ] **Step 6: Implement `ModelConnectionService.complete`**

Resolve by both IDs, require `connection.protocol === 'openai-compatible'`, `model.enabled === true`, and `model.testState === 'success'`, decrypt only after validation, then call the adapter. Return the adapter's `ModelCompletionOutcome` so Runtime can persist and log failed responses as well as successes. Keep the plaintext key in the smallest function scope and never attach it, request headers, or the endpoint object to returned outcomes or thrown error details.

- [ ] **Step 7: Run focused model-connection tests**

Run: `pnpm exec vitest run packages/model-connections/tests/provider-adapters.test.ts packages/model-connections/tests/model-connection-service.test.ts packages/model-connections/tests/http-transport.test.ts`

Expected: PASS, including blank-content and duplicate-model cases.

- [ ] **Step 8: Commit the completion capability**

```bash
git add packages/model-connections
git commit -m "feat: execute openai compatible completions"
```

### Task 3: Persist and run a real Agent task with no Skill fallback

**Files:**

- Modify: `apps/agent-runtime/src/database.ts`
- Modify: `apps/agent-runtime/src/ports.ts`
- Modify: `apps/agent-runtime/src/repositories.ts`
- Create: `apps/agent-runtime/src/model-connections/model-gateway.ts`
- Modify: `apps/agent-runtime/src/agent-graph.ts`
- Modify: `apps/agent-runtime/src/local-adapters.ts`
- Modify: `apps/agent-runtime/src/local-runtime-server.ts`
- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Modify: `apps/agent-runtime/tests/database.test.ts`
- Modify: `apps/agent-runtime/tests/repositories.test.ts`
- Modify: `apps/agent-runtime/tests/model-gateway.test.ts`
- Modify: `apps/agent-runtime/tests/local-adapters.test.ts`
- Modify: `apps/agent-runtime/tests/local-runtime-server.test.ts`
- Modify: `apps/agent-runtime/tests/runtime-process.test.ts`

**Interfaces:**

- Consumes: `ModelConnectionService.complete`, `ModelRef`, `InteractionLogRecorder`.
- Produces: restart-safe task/message/model-call data and a real `ConnectionModelGateway`.

- [ ] **Step 1: Write failing migration and repository tests**

Add migration version 3 expectations for:

```sql
ALTER TABLE tasks ADD COLUMN connection_id TEXT;
ALTER TABLE tasks ADD COLUMN model_id TEXT;
ALTER TABLE tasks ADD COLUMN error_json TEXT;
CREATE TABLE model_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
```

Assert `tasks.listRecent(20)`, `messages.listByTask(taskId)`, and `modelCalls.listByTask(taskId)` return stable persisted order after reopening the database.

- [ ] **Step 2: Run persistence tests and verify failure**

Run: `pnpm exec vitest run apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts`

Expected: FAIL because migration 3 and the list/model-call repositories do not exist.

- [ ] **Step 3: Implement migration and repository ports**

Extend `RuntimeTaskRecord` with `model: ModelRef`, `error: unknown | null`, and keep `threadId` as the session identity. Add:

```ts
export interface ModelCallRepository {
  save(call: PersistedModelCall): Promise<void>
  listByTask(taskId: string): Promise<PersistedModelCall[]>
}

export interface TaskRepository {
  get(taskId: string): Promise<RuntimeTaskRecord | null>
  listRecent(limit: number): Promise<RuntimeTaskRecord[]>
  save(task: RuntimeTaskRecord): Promise<void>
}
```

Use parameterized SQL and `assertPersistablePayload` for request, response, and error JSON.

- [ ] **Step 4: Write failing real gateway tests**

Construct `ConnectionModelGateway` with a fake completion service, in-memory model-call repository, interaction recorder, and deterministic ID/clock. Assert it:

```ts
await gateway.complete({
  taskId: 'task-1',
  requestId: 'plan:task-1',
  model: { connectionId: 'connection-1', modelId: 'gpt-real' },
  messages: [{ role: 'user', content: 'hello' }],
  skills: [],
  parameters: { temperature: 0 }
})
```

returns `{ kind: 'finish', content: 'real answer' }`, persists one completed call, and records one `service->model` event carrying `taskId`, `requestId`, and the same correlation ID. Add a failure case that persists the structured error and excludes `secret-key` from serialized records.

- [ ] **Step 5: Add `service->model` to observability contracts first**

Modify `packages/observability/src/interaction-store.ts`:

```ts
export type InteractionDirection =
  | 'renderer->service'
  | 'service->renderer'
  | 'service->skill'
  | 'service->model'
```

Update store/query/UI mapping tests to accept the new direction without changing the transport filter; the upstream call remains `transport: 'http'`.

- [ ] **Step 6: Implement `ConnectionModelGateway`**

The gateway starts an interaction with `direction: 'service->model'`, persists a running model call, invokes `ModelConnectionService.complete`, then completes both the model-call row and interaction event. It passes request/response bodies returned by the adapter but never headers or credentials. On failure it persists `{ code, message, retryable }`, completes the interaction as error, and rethrows a typed runtime error.

- [ ] **Step 7: Make GraphRunner model-aware and Skill-free for this slice**

Extend `ModelRequest` and `GraphRunner.run` with `taskId` and `model`. Pass them into the existing `plan` node. `skills` remains an empty array; a returned `invoke-skill` result is treated as `CAPABILITY_UNAVAILABLE` rather than resolving a provider.

Change `createLocalRuntimeAdapters` to accept the already-created repositories, checkpointer, and `ConnectionModelGateway`. Instantiate an empty `RuntimeSkillRegistry`; remove `DeterministicModelGateway` and both hosted mock provider registrations from local production composition. Keep `createMockRuntimeAdapters` unchanged for tests/visual composition.

- [ ] **Step 8: Refactor runtime process to share one service and database owner**

In `runtime-process.ts`, open the database once, create one `ModelConnectionService`, one interaction store/recorder, repositories, and `ConnectionModelGateway`, then pass them to both HTTP configuration service and local runtime server. Shutdown order is: stop accepting commands, await active tasks, close HTTP, close checkpointer/repositories/database, close logging.

- [ ] **Step 9: Save real user/assistant/error data in the command handler**

On submit, validate `skills.length === 0`, save the running task plus user message, and publish `task.submitted`. On successful graph completion, save the assistant message before committing `completed`. On error, save the typed error before committing `failed`. A model that becomes disabled after the UI loaded must fail before the transport request and remain visible as a failed persisted task.

- [ ] **Step 10: Run focused runtime and observability tests**

Run: `pnpm exec vitest run packages/observability/src/interaction-store.test.ts packages/observability/tests/interactions.test.ts apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts apps/agent-runtime/tests/model-gateway.test.ts apps/agent-runtime/tests/local-adapters.test.ts apps/agent-runtime/tests/local-runtime-server.test.ts apps/agent-runtime/tests/runtime-process.test.ts`

Expected: PASS; no deterministic gateway or Browser/Computer provider is present in local adapters.

- [ ] **Step 11: Commit the real runtime path**

```bash
git add packages/observability apps/agent-runtime
git commit -m "feat: run real persisted agent completions"
```

### Task 4: Expose real task and model-log projections through the desktop bridge

**Files:**

- Modify: `apps/agent-runtime/src/local-runtime-server.ts`
- Create: `apps/agent-runtime/src/model-log-projection.ts`
- Create: `apps/agent-runtime/tests/model-log-projection.test.ts`
- Modify: `apps/agent-runtime/tests/local-runtime-server.test.ts`
- Modify: `apps/desktop/src/shared/agent-ipc-contract.ts`
- Modify: `apps/desktop/src/main/agent-ipc.ts`
- Modify: `apps/desktop/src/main/agent-ipc.test.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/preload/desktop-api.test.ts`
- Modify: `apps/desktop/src/main/local-runtime.ts`

**Interfaces:**

- Consumes: real task/message/model-call repositories and Task 1 runtime commands.
- Produces: `AgentDesktopApi.listTasks`, `listModelLogs`, and `getModelLog`.

- [ ] **Step 1: Write failing projection tests for success, failure, and restart data**

Build persisted fixtures through repositories, not exported UI mocks. Assert a successful projection contains user and agent messages with `browser: null`, a failed projection contains the user message and failed step but no agent message, and model-log projection sections appear in this order:

```ts
;['system-prompt', 'user-input', 'model-request', 'model-response', 'metadata']
```

For failures, replace `model-response` with an error-bearing metadata section and keep the call status `failed`.

- [ ] **Step 2: Run projection tests and verify failure**

Run: `pnpm exec vitest run apps/agent-runtime/tests/model-log-projection.test.ts apps/agent-runtime/tests/local-runtime-server.test.ts`

Expected: FAIL because repository-backed projections and list commands do not exist.

- [ ] **Step 3: Implement repository-backed projections**

Create pure functions in `model-log-projection.ts` that receive task, messages, and model calls and return shared DTOs. Use `threadId` as `sessionId`, one task per session, timestamps from stored records, duration from `startedAt/completedAt`, and model label from the stored `ModelRef`. Never infer success content from events when the assistant message/model response is absent.

Replace `toTaskProjection` in `local-runtime-server.ts` with an async repository-backed builder. Its `steps` contain only the Agent execution step and its `browser` is always `null` in this slice.

- [ ] **Step 4: Implement runtime list commands**

Handle `task.list`, `model-log.list`, and `model-log.get`. Clamp task list limits to `1..100`; apply status/query filtering after real projection; return empty arrays for no data. Add capabilities to both Runtime server and client capability lists.

- [ ] **Step 5: Add typed Main/Preload forwarding**

Extend `AGENT_IPC_CHANNELS` with `list`, `modelLogList`, and `modelLogGet`. Main handlers forward the typed requests; Preload exposes:

```ts
listTasks(limit?: number): Promise<RecentTaskProjection[]>
listModelLogs(query?: ModelLogQuery): Promise<ModelLogSessionProjection[]>
getModelLog(taskId: string): Promise<ModelLogSessionProjection | null>
```

Keep these calls inside the existing narrow bridge; Renderer does not access SQLite or Runtime ports.

- [ ] **Step 6: Verify log-control exclusion and identifiers**

Add tests showing task/model-log query IPC carries `taskId`/request metadata where available, while `actiondriver:log:*` remains excluded by `startIpcInteraction`. Querying model logs may create a normal query interaction only if its channel is not under `actiondriver:log:*`; it must never recursively create model execution records.

- [ ] **Step 7: Run focused bridge tests**

Run: `pnpm exec vitest run apps/agent-runtime/tests/model-log-projection.test.ts apps/agent-runtime/tests/local-runtime-server.test.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/main/interaction-logging.test.ts`

Expected: PASS, including restart-backed projection fixtures.

- [ ] **Step 8: Commit the query bridge**

```bash
git add apps/agent-runtime apps/desktop/src/shared apps/desktop/src/main apps/desktop/src/preload
git commit -m "feat: expose real task and model log queries"
```

### Task 5: Replace local model selection and task catalog mocks in Renderer

**Files:**

- Modify: `apps/desktop/src/renderer/src/models/model-selection.ts`
- Modify: `apps/desktop/src/renderer/src/models/task-catalog.ts`
- Create: `apps/desktop/src/renderer/src/services/desktop-task-catalog.ts`
- Create: `apps/desktop/src/renderer/src/services/desktop-task-catalog.test.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.test.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.tsx`
- Modify: `apps/desktop/src/renderer/src/components/model-selector/ModelConnectionItem.tsx`
- Modify: `apps/desktop/src/renderer/src/components/model-selector/ModelOptionItem.tsx`
- Modify: `apps/desktop/src/renderer/src/components/model-selector/ModelSelectorTrigger.tsx`
- Modify: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/HomePage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx`

**Interfaces:**

- Consumes: `ModelConnectionsService.list`, `AgentDesktopApi.listTasks/get`, `AgentGoalRequest`.
- Produces: local Renderer with real loading/empty/error/disabled/selected states and Agent-only task detail.

- [ ] **Step 1: Write failing model-projection tests**

Add a pure mapper:

```ts
toModelSelectionProjection(connections, selected: ModelRef | null)
```

Test that successful enabled OpenAI models are selectable, Anthropic options have `{ disabled: true, disabledReason: 'Agent 调用暂未接入' }`, failed/unsupported/disabled models are not selectable, duplicate model IDs remain distinct by connection, and no connections produces `selected: null`.

- [ ] **Step 2: Write failing App tests for asynchronous real data**

Render local services whose model list and task list resolve asynchronously. Assert loading indicators first, then real connection/task labels. Reject each query and assert a retryable error state without any text from `defaultModelSelection` or `MockTaskCatalog`. Disable the selected model between renders and assert the send button becomes disabled and selection clears.

- [ ] **Step 3: Run Renderer tests and verify failure**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx apps/desktop/src/renderer/src/di/container.test.ts`

Expected: FAIL because App still reads hard-coded synchronous projections.

- [ ] **Step 4: Implement real model selection state**

Change the projection to:

```ts
type ModelSelectionProjection = {
  state: 'loading' | 'ready' | 'empty' | 'error'
  connections: readonly ModelConnectionOption[]
  selected: ModelRef | null
  error?: string
}
```

Each option carries `disabled` and `disabledReason`. `findSelectedModel` matches both IDs. Delete `defaultModelSelection` from production imports; move any fixture needed by tests to a test helper.

- [ ] **Step 5: Bind real task catalog only in local mode**

`DesktopTaskCatalog` calls `desktopApi.agent.listTasks()` and `desktopApi.agent.get()`. In `createRendererContainer`, local mode without an explicit override binds this adapter; mock mode binds `MockTaskCatalog`. Add a guard test that local mode's resolved service is not a `MockTaskCatalog`.

- [ ] **Step 6: Submit the exact model reference**

Update `DesktopAgentAdapter.submitGoal(request)` and Preload call sites to carry the complete `AgentGoalRequest`. In Main, merge only the current main prompt and force `skills: []`; do not call `getEnabledSkills` for this slice.

App loads model connections and recent tasks in effects, preserves request ordering to avoid stale results winning, and calls:

```ts
services.agentCommandService.submitGoal({ goal, model: selectedModel })
```

Submission remains disabled until `state === 'ready'` and `selected !== null`.

- [ ] **Step 7: Render Agent-only details and real terminal content**

Ensure `TaskPage` treats `task.browser === null` as a true Agent-only layout: no Browser panel, Browser mode controls, pause/resume/take-over buttons, or Browser status copy. Render the assistant message from persisted `task.messages`; failed tasks show the persisted diagnostic without inventing an answer.

- [ ] **Step 8: Run focused Renderer tests**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/services/desktop-task-catalog.test.ts apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts apps/desktop/src/renderer/src/di/container.test.ts apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx apps/desktop/src/renderer/src/pages/pages.test.tsx`

Expected: PASS; local composition contains no hard-coded model/task data.

- [ ] **Step 9: Commit the real selection and task UI**

```bash
git add apps/desktop/src/renderer apps/desktop/src/main/agent-ipc.ts apps/desktop/src/preload/desktop-api.ts
git commit -m "feat: render real models and agent tasks"
```

### Task 6: Replace model-log fixtures with the real model-log service

**Files:**

- Modify: `apps/desktop/src/renderer/src/models/model-logs.ts`
- Create: `apps/desktop/src/renderer/src/services/desktop-model-logs.ts`
- Create: `apps/desktop/src/renderer/src/services/desktop-model-logs.test.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.test.ts`
- Modify: `apps/desktop/src/renderer/src/pages/LogsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/LogsPage.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/logs/ModelLogsView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/logs/InterfaceLogsView.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/settings.css`

**Interfaces:**

- Consumes: `AgentDesktopApi.listModelLogs/getModelLog`, existing `InteractionLogService`.
- Produces: real model-log loading/list/empty/error/detail behavior and visible `service->model` interface direction.

- [ ] **Step 1: Write failing model-log adapter and page tests**

Assert `DesktopModelLogService.list({ status, query })` forwards both filters and returns cloned runtime data. In `LogsPage.test.tsx`, assert loading, empty, failure with retry, completed detail, and failed detail. Assert refreshing after a new task replaces the list from the service and does not append fixture sessions.

- [ ] **Step 2: Run log tests and verify failure**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/services/desktop-model-logs.test.ts apps/desktop/src/renderer/src/pages/LogsPage.test.tsx`

Expected: FAIL because `ModelLogsView` imports `mockModelLogSessions` directly.

- [ ] **Step 3: Define and bind `ModelLogService`**

```ts
export interface ModelLogService {
  list(query: ModelLogQuery): Promise<readonly ModelLogSessionProjection[]>
  detail(taskId: string): Promise<ModelLogSessionProjection | null>
}
```

Local mode binds `DesktopModelLogService`; mock mode may bind a fixture-backed test implementation. Remove production exports of `mockModelLogSessions` and move fixtures into test files.

- [ ] **Step 4: Convert `ModelLogsView` to asynchronous real data**

Pass `service` from `LogsPage`. Fetch on mount, status/search change, manual refresh, and auto-refresh interval. Preserve expanded sessions and selected detail when the referenced IDs still exist; close detail with a clear “记录已不存在” message when retention/removal makes it unavailable. List and detail must expose the actual system prompt, user input, model request, model response/error, metadata, model ID, and timing.

- [ ] **Step 5: Support `service->model` in interface logs**

Update direction labels and filters so the new direction is displayed as `服务 → 模型`; keep transport filtering on HTTP rather than adding OpenAI as a transport. Add a component test that selects an HTTP record with `service->model` and opens its Request and Response.

- [ ] **Step 6: Test recursive-log and credential boundaries**

Use an `InteractionLogService` spy while refreshing/opening details and assert no call writes data. At the storage/service test layer, serialize summaries/details and assert they contain system/user/model bodies but do not contain `Authorization`, `Bearer secret`, the configured API key, or `actiondriver:log:list`/`actiondriver:log:detail`.

- [ ] **Step 7: Run focused log tests**

Run: `pnpm exec vitest run apps/desktop/src/renderer/src/services/desktop-model-logs.test.ts apps/desktop/src/renderer/src/pages/LogsPage.test.tsx packages/observability/src/interaction-store.test.ts apps/desktop/src/main/interaction-logging.test.ts`

Expected: PASS for real list/detail states, new direction, and exclusion guards.

- [ ] **Step 8: Commit real model logs**

```bash
git add apps/desktop/src/renderer packages/observability apps/desktop/src/main/interaction-logging.test.ts
git commit -m "feat: render real model execution logs"
```

### Task 7: Prove the complete local vertical slice and close the OpenSpec task group

**Files:**

- Create: `apps/desktop/e2e/support/fake-openai-server.ts`
- Modify: `apps/desktop/e2e/local-runtime.spec.ts`
- Modify: `apps/desktop/e2e/interaction-contracts.json`
- Modify: `openspec/changes/serve-runtime-over-http/tasks.md`

**Interfaces:**

- Consumes: the complete real flow from Tasks 1–6.
- Produces: deterministic end-to-end acceptance evidence and completed OpenSpec task status for section 0 only.

- [ ] **Step 1: Create a controllable fake OpenAI-compatible server**

Export:

```ts
type CapturedCompletion = {
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

export async function startFakeOpenAiServer(): Promise<{
  baseUrl: string
  completions: CapturedCompletion[]
  setMode(mode: 'success' | 'unauthorized' | 'rate-limited' | 'blank'): void
  close(): Promise<void>
}>
```

Serve `GET /v1/models` with `gpt-e2e`, and `POST /v1/chat/completions` with deterministic JSON. Capture requests in memory only; never write the test API key to disk.

- [ ] **Step 2: Replace deterministic-gateway E2E assumptions with the real flow**

Launch the fake server before Electron and add the connection through `window.actionDriverDesktop.modelConnections.add`. Reload model selection, select `gpt-e2e`, submit `总结真实链路`, and assert the fake server received:

```ts
expect(server.completions[0]?.body).toMatchObject({
  model: 'gpt-e2e',
  stream: false,
  messages: expect.arrayContaining([
    expect.objectContaining({ role: 'user', content: '总结真实链路' })
  ])
})
```

Assert the task becomes succeeded and the exact assistant text appears.

- [ ] **Step 3: Verify real lists and both log layers**

Return home and assert the recent list contains the real goal/task. Open logs, verify interface layer has an HTTP `服务 → 模型` entry whose Request and Response contain the real bodies, then switch to model layer and verify the same task exposes system prompt, user input, model request, model response, and completed state.

- [ ] **Step 4: Verify restart recovery and no hidden fallback**

Close Electron, relaunch with the same user-data directory, and assert the task list, task detail, and model logs still contain the same IDs/content. Assert the page has no Browser/Computer panel or controls. Run unauthorized and blank-response submissions and assert failed persisted tasks with no assistant message.

- [ ] **Step 5: Verify secrets and log-control exclusion on disk**

Read the temporary SQLite/log files after shutdown and assert observable text does not contain the test API key, `Authorization`, `actiondriver:log:list`, or `actiondriver:log:detail`. It must contain the test goal and assistant response, confirming business bodies were retained.

- [ ] **Step 6: Run the targeted end-to-end test**

Run: `pnpm build:native:electron && pnpm --filter @actiondriver/agent-runtime build && pnpm --filter @actiondriver/desktop build && pnpm exec playwright test apps/desktop/e2e/local-runtime.spec.ts`

Expected: PASS for real success, failure, restart, task list, interface logs, model logs, no Skill UI, and no credential leakage.

- [ ] **Step 7: Run the complete gates once**

Run: `pnpm check`

Expected: typecheck, lint, unit tests, interaction declaration validation, and production build all PASS.

Run: `pnpm test:e2e:local`

Expected: all local desktop E2E tests PASS.

Run: `openspec validate serve-runtime-over-http --strict`

Expected: `Change 'serve-runtime-over-http' is valid` with no archive-blocking requirement warnings.

Do not run `pnpm test:e2e:visual`, Figma audit, or screenshot validation unless the user explicitly requests visual verification.

- [ ] **Step 8: Update only proven OpenSpec checkboxes**

Mark `0.1` through `0.8` complete only when their corresponding tests above have passed. Do not change the existing incomplete status or notes for `13.10` and `13.13` unless separate evidence closes those gaps.

- [ ] **Step 9: Commit the accepted vertical slice**

```bash
git add apps/desktop/e2e openspec/changes/serve-runtime-over-http/tasks.md
git commit -m "test: prove real minimal agent flow"
```

- [ ] **Step 10: Request final code review before claiming completion**

Run the `superpowers:requesting-code-review` workflow against the complete Task 1–7 diff. Resolve any blocking correctness, credential, persistence, or mock-fallback finding, rerun the affected targeted test, then rerun the complete gates if production code changed.
