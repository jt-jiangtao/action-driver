# Action-Driver Local LangGraph Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用本地 Node.js/TypeScript + LangGraph Runtime 替代已回退的 Go/Eino 方案，并通过 InversifyJS 将 Renderer、Electron Main 和 Runtime 三层解耦，同时保持现有 UI 与 Mock Browser/Computer Skill 行为不变。

**Architecture:** Electron Main 使用 `utilityProcess.fork()` 启动 `apps/agent-runtime`，通过 MessagePort 上的版本化 Zod RPC 与 Runtime 双向通信。Runtime 使用 LangGraph、SQLite checkpointer 和本地业务仓储执行可中断、可恢复的任务；Renderer、Main、Runtime 分别拥有独立 InversifyJS composition root，React 组件只通过类型化 Context 消费领域服务。

**Tech Stack:** TypeScript 5.9.3、Electron 38.8.6、React 19.3.0、InversifyJS 8.2.3、LangGraph 1.4.16、LangChain Core 1.2.12、LangGraph SQLite Checkpoint 1.0.4、Zod 4.6.5、better-sqlite3 12.11.1、Vitest 3.2.7、Playwright 1.63.0、pnpm 12.4.1。

**Spec:** `openspec/changes/replace-agentd-with-local-langgraph-runtime/design.md`

## Global Constraints

- 仅支持 macOS；生产用户不得依赖 Docker、Node.js 开发环境或 Go。
- Renderer MUST NOT 获得 MessagePort、UtilityProcess、数据库路径、Node.js、Electron 原始 API 或通用 IPC。
- Renderer、Electron Main 和 Agent Runtime MUST 分别使用 InversifyJS composition root；React 页面不得导入 `Container` 或直接构造基础设施适配器。
- 历史会话、任务、事件和 LangGraph checkpoint MUST 只保存在客户端 SQLite；远程模型不拥有历史事实源。
- Browser Use 与 Computer Use MUST 保持独立 Skill Provider；本计划只实现 Mock Provider 传输，不实现真实网页或 macOS 动作。
- 不实现 Playwright/Chromium Fork、Action Graph、Node Handle、Page Memory、Procedure Memory、零 Token 重放或 Native Browser Engine。
- 现有首页、任务页、Slate 输入框、Ant Design Timeline 和三种浏览器占位布局不得发生视觉变化。
- 所有新行为先写失败测试，再写最小实现；每个任务结束时运行其完整验证命令并独立提交。

## Review Focus

- 收到未知消息类型、畸形 payload 或不兼容主版本时，必须在任何业务写入前拒绝；Task 1 的协议测试覆盖。
- Runtime 在 checkpoint 已提交但业务投影未写入时退出，重启必须补齐且不重复事件；Task 4 的 reconciliation 测试覆盖。
- 用户在不可立即取消的 Skill 执行中中断，Runtime 不得误报 cancelled 或继续下一动作；Task 5 的状态机测试覆盖。
- React 组件绕过 composition root 导入 `Container`、local adapter 或 Mock 实现时，架构测试必须失败；Task 2 覆盖。
- 打包产物缺少 Runtime 入口、SQLite 原生模块或架构不匹配时，生产构建必须失败且不得回退 Mock；Task 9 覆盖。

---

### Task 1: 建立版本化 Runtime Contracts

**Files:**

- Create: `packages/runtime-contracts/package.json`
- Create: `packages/runtime-contracts/tsconfig.json`
- Create: `packages/runtime-contracts/src/protocol.ts`
- Create: `packages/runtime-contracts/src/schemas.ts`
- Create: `packages/runtime-contracts/src/index.ts`
- Create: `packages/runtime-contracts/tests/protocol.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `RUNTIME_PROTOCOL_VERSION = { major: 1, minor: 0 }`.
- Produces: `RuntimeEnvelope`, `RuntimeCommandMap`, `RuntimeEvent`, `SkillExecuteRequest`, `parseRuntimeEnvelope(value: unknown): RuntimeEnvelope`.
- Consumes: serializable projections from `@action-driver/contracts`.

- [ ] **Step 1: Write the failing protocol tests**

```ts
import { describe, expect, it } from 'vitest'
import { parseRuntimeEnvelope, RUNTIME_PROTOCOL_VERSION } from '../src'

describe('runtime protocol', () => {
  it('accepts a compatible handshake', () => {
    expect(parseRuntimeEnvelope({
      type: 'handshake.request',
      requestId: 'request-1',
      version: RUNTIME_PROTOCOL_VERSION,
      payload: { appVersion: '0.1.0', capabilities: ['events.v1'] }
    }).type).toBe('handshake.request')
  })

  it.each([
    { type: 'unknown', requestId: 'request-1', version: RUNTIME_PROTOCOL_VERSION, payload: {} },
    { type: 'command.request', requestId: '', version: RUNTIME_PROTOCOL_VERSION, payload: {} },
    { type: 'command.request', requestId: 'request-1', version: { major: 2, minor: 0 }, payload: {} }
  ])('rejects malformed or incompatible envelopes', (value) => {
    expect(() => parseRuntimeEnvelope(value)).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/runtime-contracts/tests/protocol.test.ts`

Expected: FAIL because `@action-driver/runtime-contracts` does not exist.

- [ ] **Step 3: Add the package and concrete schemas**

Set `@action-driver/runtime-contracts` dependencies to `@action-driver/contracts: workspace:*` and `zod: 4.6.5`, then run `corepack pnpm install` once to update `pnpm-lock.yaml`.

```ts
// packages/runtime-contracts/src/protocol.ts
export const RUNTIME_PROTOCOL_VERSION = { major: 1, minor: 0 } as const

export type RuntimeCommandMap = {
  'task.submit': { request: { goal: string }; response: { taskId: string } }
  'task.interrupt': { request: { taskId: string }; response: { accepted: true } }
  'task.continue': { request: { taskId: string }; response: { accepted: true } }
  'task.provide-input': {
    request: { taskId: string; value: unknown }
    response: { accepted: true }
  }
  'task.get': { request: { taskId: string }; response: { task: unknown | null } }
}

export type SkillExecuteRequest = {
  invocationId: string
  requestedSkillId: string
  resolvedProviderId: string
  providerVersion: string
  input: unknown
}
```

```ts
// packages/runtime-contracts/src/schemas.ts
import { z } from 'zod'
import { RUNTIME_PROTOCOL_VERSION } from './protocol'

const versionSchema = z.object({
  major: z.literal(RUNTIME_PROTOCOL_VERSION.major),
  minor: z.number().int().nonnegative()
})

export const runtimeEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('handshake.request'),
    requestId: z.string().min(1),
    version: versionSchema,
    payload: z.object({ appVersion: z.string().min(1), capabilities: z.array(z.string()) })
  }),
  z.object({
    type: z.literal('command.request'),
    requestId: z.string().min(1),
    version: versionSchema,
    deadlineUnixMs: z.number().int().positive(),
    payload: z.object({ command: z.string().min(1), input: z.unknown() })
  }),
  z.object({
    type: z.literal('command.response'),
    requestId: z.string().min(1),
    version: versionSchema,
    payload: z.object({ ok: z.boolean(), value: z.unknown().optional(), error: z.unknown().optional() })
  }),
  z.object({
    type: z.literal('event.item'),
    requestId: z.string().min(1),
    version: versionSchema,
    payload: z.object({ cursor: z.number().int().nonnegative(), event: z.unknown() })
  }),
  z.object({
    type: z.literal('skill.execute'),
    requestId: z.string().min(1),
    version: versionSchema,
    deadlineUnixMs: z.number().int().positive(),
    payload: z.unknown()
  })
])

export type RuntimeEnvelope = z.infer<typeof runtimeEnvelopeSchema>

export function parseRuntimeEnvelope(value: unknown): RuntimeEnvelope {
  return runtimeEnvelopeSchema.parse(value)
}
```

- [ ] **Step 4: Verify protocol tests, typecheck, and serialization guard**

Add a test that calls `structuredClone(parseRuntimeEnvelope(fixture))` for every envelope fixture and asserts `isSerializableContract(fixture) === true`.

Run: `corepack pnpm install --frozen-lockfile && corepack pnpm vitest run packages/runtime-contracts packages/contracts && corepack pnpm --filter @action-driver/runtime-contracts typecheck`

Expected: PASS with no unknown envelope accepted.

- [ ] **Step 5: Commit the runtime contracts**

```bash
git add packages/runtime-contracts pnpm-lock.yaml
git commit -m "feat(protocol): add typed runtime message contracts"
```

### Task 2: Enforce Renderer InversifyJS Composition Root

**Files:**

- Create: `apps/desktop/src/renderer/src/di/services-context.tsx`
- Create: `apps/desktop/src/renderer/src/di/architecture.test.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.test.ts`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx`

**Interfaces:**

- Produces: `AppServicesProvider({ services, children })` and `useAppServices(): AppServices`.
- Produces: `createRendererContainer({ mode, desktopApi, ...overrides })` as the only frontend construction entry.
- Consumes: `AgentCommandService`, `AgentSessionRepository`, and `SkillGateway` from `@action-driver/contracts`.

- [ ] **Step 1: Write failing Context and architecture tests**

```tsx
it('provides services without exposing the container', () => {
  const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))
  render(
    <AppServicesProvider services={services}>
      <Probe />
    </AppServicesProvider>
  )
  expect(screen.getByTestId('service-name')).toHaveTextContent('MockAgentRuntime')
})
```

```ts
it('keeps Inversify and adapters outside React components', async () => {
  const sourceFiles = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true })
    return (await Promise.all(entries.map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
    }))).flat()
  }
  const componentFiles = [
    ...await sourceFiles('apps/desktop/src/renderer/src/components'),
    ...await sourceFiles('apps/desktop/src/renderer/src/pages')
  ]
  for (const file of componentFiles) {
    const source = await readFile(file, 'utf8')
    expect(source).not.toMatch(/from ['"]inversify['"]/)
    expect(source).not.toMatch(/services\/mock-|services\/desktop-/)
    expect(source).not.toMatch(/new Container\(/)
  }
})
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/di apps/desktop/src/renderer/src/App.test.tsx`

Expected: FAIL because the Context bridge and `mode` binding do not exist.

- [ ] **Step 3: Implement the Context bridge and explicit container mode**

```tsx
// services-context.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { AppServices } from './container'

const AppServicesContext = createContext<AppServices | null>(null)

export function AppServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext)
  if (!services) throw new Error('AppServicesProvider is missing')
  return services
}
```

Refactor `App` to call `useAppServices()` and remove the `services` prop. In `main.tsx`, resolve the Inversify container once and wrap `<App />` with `AppServicesProvider`.

- [ ] **Step 4: Preserve test overrides through the composition root**

Update test helpers to render:

```tsx
const services = resolveAppServices(createRendererContainer({ mode: 'mock', ...overrides }))
return render(<AppServicesProvider services={services}><App initialRoute={initialRoute} /></AppServicesProvider>)
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src`

Expected: all renderer tests pass and visual behavior remains unchanged.

- [ ] **Step 5: Commit frontend dependency injection**

```bash
git add apps/desktop/src/renderer/src
git commit -m "refactor(renderer): enforce inversify composition root"
```

### Task 3: Scaffold the Local TypeScript Agent Runtime

**Files:**

- Create: `apps/agent-runtime/package.json`
- Create: `apps/agent-runtime/tsconfig.json`
- Create: `apps/agent-runtime/src/di/types.ts`
- Create: `apps/agent-runtime/src/di/container.ts`
- Create: `apps/agent-runtime/src/domain/types.ts`
- Create: `apps/agent-runtime/src/model/model-gateway.ts`
- Create: `apps/agent-runtime/src/model/deterministic-model-gateway.ts`
- Create: `apps/agent-runtime/src/index.ts`
- Create: `apps/agent-runtime/tests/container.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `ModelGateway.invoke(request, signal): Promise<ModelResult>`.
- Produces: `createRuntimeContainer({ mode, databasePath, clock, idGenerator }): Container`.
- Produces: `RuntimeServices` without exporting the underlying container to graph nodes.
- Consumes: protocol types from `@action-driver/runtime-contracts`.

- [ ] **Step 1: Write failing Runtime composition tests**

```ts
it('resolves deterministic ports without credentials', async () => {
  const services = resolveRuntimeServices(createRuntimeContainer({
    mode: 'mock', databasePath: ':memory:', clock: () => new Date(0), idGenerator: () => 'id-1'
  }))
  await expect(services.modelGateway.invoke({ messages: [{ role: 'user', content: 'test' }] }, new AbortController().signal))
    .resolves.toEqual({ kind: 'finish', content: 'test' })
})
```

- [ ] **Step 2: Run the test and confirm package absence**

Run: `corepack pnpm vitest run apps/agent-runtime/tests/container.test.ts`

Expected: FAIL because `apps/agent-runtime` does not exist.

- [ ] **Step 3: Add package dependencies and explicit Inversify bindings**

Use exact dependencies:

```json
{
  "dependencies": {
    "@action-driver/contracts": "workspace:*",
    "@action-driver/runtime-contracts": "workspace:*",
    "@langchain/core": "1.2.12",
    "@langchain/langgraph": "1.4.16",
    "@langchain/langgraph-checkpoint-sqlite": "1.0.4",
    "better-sqlite3": "12.11.1",
    "inversify": "8.2.3",
    "zod": "4.6.5"
  }
}
```

Add `@types/better-sqlite3: 9.6.0` to devDependencies and run `corepack pnpm install` once to update the lockfile before the frozen install verification.

```ts
export const RUNTIME_TYPES = {
  modelGateway: Symbol.for('action-driver.runtime.model-gateway'),
  graphRunner: Symbol.for('action-driver.runtime.graph-runner'),
  taskRepository: Symbol.for('action-driver.runtime.task-repository'),
  eventRepository: Symbol.for('action-driver.runtime.event-repository'),
  skillRegistry: Symbol.for('action-driver.runtime.skill-registry'),
  clock: Symbol.for('action-driver.runtime.clock'),
  idGenerator: Symbol.for('action-driver.runtime.id-generator')
} as const
```

- [ ] **Step 4: Verify Runtime build and container**

Run: `corepack pnpm install --frozen-lockfile && corepack pnpm --filter @action-driver/agent-runtime typecheck && corepack pnpm vitest run apps/agent-runtime/tests/container.test.ts`

Expected: PASS without reading model environment variables.

- [ ] **Step 5: Commit the Runtime scaffold**

```bash
git add apps/agent-runtime pnpm-lock.yaml
git commit -m "feat(runtime): scaffold local typescript agent process"
```

### Task 4: Implement SQLite Persistence and LangGraph Checkpoints

**Files:**

- Create: `apps/agent-runtime/src/storage/schema.ts`
- Create: `apps/agent-runtime/src/storage/database.ts`
- Create: `apps/agent-runtime/src/storage/repositories.ts`
- Create: `apps/agent-runtime/src/storage/checkpointer.ts`
- Create: `apps/agent-runtime/src/storage/projection-service.ts`
- Create: `apps/agent-runtime/tests/storage.test.ts`
- Create: `apps/agent-runtime/tests/reconciliation.test.ts`
- Modify: `apps/agent-runtime/src/di/container.ts`

**Interfaces:**

- Produces: `RuntimeDatabase.open(path): RuntimeDatabase` and `close(): void`.
- Produces: `TaskRepository.saveTask`, `getTask`, `saveProjection`.
- Produces: `EventRepository.append`, `eventsAfter`, with monotonic cursor.
- Produces: `ProjectionService.applyCheckpoint(threadId, checkpointId, events)` with idempotency key.
- Consumes: `SqliteSaver` from `@langchain/langgraph-checkpoint-sqlite`.

- [ ] **Step 1: Write failing migration and transaction tests**

```ts
it('rolls back task and event together', () => {
  const db = openTemporaryDatabase()
  expect(() => db.transaction(() => {
    db.tasks.save({ id: 'task-1', status: 'running', goal: 'test' })
    db.events.append({ eventKey: 'task-1:created', taskId: 'task-1', type: 'task.created', payload: {} })
    throw new Error('rollback')
  })).toThrow('rollback')
  expect(db.tasks.get('task-1')).toBeNull()
  expect(db.events.after(0)).toEqual([])
})
```

Add a test that attempts to persist `{ node: document.body }` and raw `{ cookie: 'session=secret' }`; the repository must reject both before SQL execution.

- [ ] **Step 2: Run storage tests and confirm failure**

Run: `corepack pnpm vitest run apps/agent-runtime/tests/storage.test.ts`

Expected: FAIL because storage modules do not exist.

- [ ] **Step 3: Implement schema and repository transactions**

`schema.ts` must create these tables with stable primary keys and foreign keys:

```sql
CREATE TABLE tasks (id TEXT PRIMARY KEY, goal TEXT NOT NULL, status TEXT NOT NULL, thread_id TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), ordinal INTEGER NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, UNIQUE(task_id, ordinal));
CREATE TABLE steps (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), ordinal INTEGER NOT NULL, status TEXT NOT NULL, detail_json TEXT NOT NULL, UNIQUE(task_id, ordinal));
CREATE TABLE skill_invocations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), requested_skill_id TEXT NOT NULL, resolved_provider_id TEXT NOT NULL, provider_version TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE runtime_events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL, thread_id TEXT NOT NULL, checkpoint_id TEXT, type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
```

- [ ] **Step 4: Add SQLite checkpointer and reconciliation failure injection**

```ts
export function createCheckpointer(databasePath: string): SqliteSaver {
  return SqliteSaver.fromConnString(databasePath)
}

export async function reconcileThread(threadId: string): Promise<void> {
  const latest = await checkpointer.getTuple({ configurable: { thread_id: threadId } })
  if (!latest) return
  await projectionService.applyCheckpoint(threadId, latest.checkpoint.id, deriveEvents(latest))
}
```

The reconciliation test must:

1. save checkpoint `checkpoint-1`;
2. stop before `ProjectionService.applyCheckpoint`;
3. reopen the database;
4. run reconciliation twice;
5. assert exactly one business event exists for the checkpoint.

- [ ] **Step 5: Verify migrations, rollback, checkpoint recovery, and idempotency**

Run: `corepack pnpm vitest run apps/agent-runtime/tests/storage.test.ts apps/agent-runtime/tests/reconciliation.test.ts`

Expected: PASS with WAL and foreign keys enabled on every connection.

- [ ] **Step 6: Commit persistent Runtime storage**

```bash
git add apps/agent-runtime/src/storage apps/agent-runtime/tests apps/agent-runtime/src/di/container.ts
git commit -m "feat(storage): persist runtime history and checkpoints"
```

### Task 5: Implement Skill Registry and Cancellation Semantics

**Files:**

- Create: `apps/agent-runtime/src/skills/skill-registry.ts`
- Create: `apps/agent-runtime/src/skills/skill-invocation-service.ts`
- Create: `apps/agent-runtime/tests/skill-registry.test.ts`
- Create: `apps/agent-runtime/tests/skill-invocation.test.ts`
- Modify: `apps/agent-runtime/src/di/container.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

**Interfaces:**

- Produces: `SkillProviderDescriptor { skillId, contractVersion, providerId, providerVersion, capabilities }`.
- Produces: `SkillRegistry.register`, `unregister`, `resolve`.
- Produces: `SkillInvocationService.execute(request, signal)` and `cancel(invocationId)`.
- Consumes: a transport-neutral `SkillProviderClient` port implemented by Main later.

- [ ] **Step 1: Write failing independent-provider and traceability tests**

```ts
it('resolves browser without affecting computer use', () => {
  const registry = new SkillRegistry()
  registry.register({ skillId: 'browser-use', contractVersion: 1, providerId: 'browser-use.mock', providerVersion: '1.0.0', capabilities: [] })
  expect(registry.resolve('browser-use', 1).providerId).toBe('browser-use.mock')
  expect(() => registry.resolve('computer-use', 1)).toThrow('CAPABILITY_UNAVAILABLE')
})
```

```ts
expect(savedInvocation).toMatchObject({
  requestedSkillId: 'browser-use',
  resolvedProviderId: 'browser-use.mock',
  providerVersion: '1.0.0'
})
```

- [ ] **Step 2: Write the non-cancellable interruption regression test**

Create a fake provider whose execute Promise remains pending after `cancel()` is requested. Assert the invocation stays `running` with `cancelRequested: true`, no next action is dispatched, and only the provider's terminal `cancelled` result changes the invocation to `cancelled`.

- [ ] **Step 3: Implement Registry and legal lifecycle transitions**

Use these exact terminal and non-terminal states in contracts:

```ts
export type SkillExecutionState =
  | 'queued' | 'running' | 'paused' | 'waiting-user' | 'taken-over'
  | 'succeeded' | 'failed' | 'cancelled'
```

Reject transitions from terminal states and persist every accepted transition before publishing it.

- [ ] **Step 4: Verify Skill behavior**

Run: `corepack pnpm vitest run apps/agent-runtime/tests/skill-registry.test.ts apps/agent-runtime/tests/skill-invocation.test.ts packages/contracts/tests/contracts.test.ts`

Expected: PASS, including Browser/Computer isolation and delayed cancellation.

- [ ] **Step 5: Commit the Skill runtime**

```bash
git add apps/agent-runtime/src/skills apps/agent-runtime/tests packages/contracts
git commit -m "feat(skills): add provider registry and invocation lifecycle"
```

### Task 6: Build the LangGraph Agent Loop

**Files:**

- Create: `apps/agent-runtime/src/graph/state.ts`
- Create: `apps/agent-runtime/src/graph/nodes.ts`
- Create: `apps/agent-runtime/src/graph/build-graph.ts`
- Create: `apps/agent-runtime/src/runtime/agent-runtime.ts`
- Create: `apps/agent-runtime/tests/agent-runtime.test.ts`
- Create: `apps/agent-runtime/tests/interrupt-resume.test.ts`
- Modify: `apps/agent-runtime/src/di/container.ts`

**Interfaces:**

- Produces: `AgentRuntime.submitGoal`, `interruptTask`, `continueTask`, `provideInput`, `getTask`, `eventsAfter`.
- Produces: `buildAgentGraph({ checkpointer, modelGateway, skillInvocationService, projectionService })`.
- Consumes: repositories, `ModelGateway`, `SkillInvocationService`, and LangGraph checkpointer.

- [ ] **Step 1: Write the failing deterministic graph test**

```ts
it('runs one task through plan, skill, verify, and finish', async () => {
  const runtime = createTestRuntime({ modelResult: { kind: 'invoke-skill', skillId: 'browser-use', input: { action: 'open-url', url: 'https://example.com' } } })
  const task = await runtime.submitGoal('open example')
  expect(task.threadId).toBe(task.id)
  await runtime.drain(task.id)
  expect(runtime.getTask(task.id)?.status).toBe('succeeded')
  expect(runtime.eventsAfter(0).map((event) => event.type)).toEqual([
    'task.created', 'step.planned', 'skill.queued', 'skill.completed', 'task.completed'
  ])
})
```

- [ ] **Step 2: Write waiting-user and user-interrupt tests**

Waiting-user test: a node calls `interrupt({ reason: 'confirmation-required' })`, persists a checkpoint, and resumes with `new Command({ resume: { approved: true } })` under the same `thread_id`.

User-interrupt test: abort an active model call, assert no Skill call starts, persist task status `interrupted`, then call continue and assert execution restarts from the latest committed checkpoint.

- [ ] **Step 3: Implement typed state and graph routing**

```ts
export const AgentState = Annotation.Root({
  taskId: Annotation<string>(),
  threadId: Annotation<string>(),
  goal: Annotation<string>(),
  phase: Annotation<'planning' | 'invoking-skill' | 'verifying' | 'waiting-user' | 'finished' | 'failed'>(),
  pendingSkill: Annotation<SkillRequest | null>(),
  waitingReason: Annotation<string | null>(),
  lastError: Annotation<RuntimeError | null>()
})
```

Build only these nodes: `acceptGoal`, `plan`, `resolveSkill`, `invokeSkill`, `verifyOutcome`, `awaitUser`, `finish`, and `failed`. Do not import Browser, Playwright, Chromium, AXUIElement, or CGEvent implementations.

- [ ] **Step 4: Implement runtime commands with one active AbortController per task**

`interruptTask(taskId)` aborts the controller and prevents graph scheduling after the current node boundary. `continueTask(taskId)` creates a new controller and invokes the graph using `{ configurable: { thread_id: taskId } }`. `provideInput` uses `new Command({ resume: value })`.

- [ ] **Step 5: Verify graph execution and recovery**

Run: `corepack pnpm vitest run apps/agent-runtime/tests/agent-runtime.test.ts apps/agent-runtime/tests/interrupt-resume.test.ts`

Expected: PASS with no call to LangChain `createAgent`.

- [ ] **Step 6: Commit the LangGraph loop**

```bash
git add apps/agent-runtime/src/graph apps/agent-runtime/src/runtime apps/agent-runtime/tests apps/agent-runtime/src/di/container.ts
git commit -m "feat(runtime): add durable langgraph agent loop"
```

### Task 7: Implement MessagePort RPC and Runtime Server

**Files:**

- Create: `packages/runtime-contracts/src/port.ts`
- Create: `apps/agent-runtime/src/transport/runtime-server.ts`
- Create: `apps/agent-runtime/src/transport/parent-port-adapter.ts`
- Create: `apps/agent-runtime/tests/runtime-server.test.ts`
- Create: `apps/desktop/src/main/runtime/runtime-client.ts`
- Create: `apps/desktop/src/main/runtime/runtime-client.test.ts`
- Create: `apps/desktop/src/main/runtime/fake-port.ts`
- Modify: `apps/agent-runtime/src/index.ts`

**Interfaces:**

- Produces: `PortLike { postMessage(value): void; onMessage(listener): Unsubscribe; close(): void }`.
- Produces: `RuntimeClient.handshake`, `request`, `subscribe`, and `close`.
- Produces: `RuntimeServer.start(port)` and `shutdown()`.
- Consumes: `AgentRuntime` and `parseRuntimeEnvelope`.

- [ ] **Step 1: Write failing RPC handshake, validation, and timeout tests**

```ts
it('rejects an incompatible handshake before dispatch', async () => {
  const { clientPort, serverPort } = createFakePortPair()
  const dispatch = vi.fn()
  new RuntimeServer(serverPort, dispatch).start()
  await expect(new RuntimeClient(clientPort, { major: 2, minor: 0 }).handshake()).rejects.toMatchObject({ code: 'PROTOCOL_INCOMPATIBLE' })
  expect(dispatch).not.toHaveBeenCalled()
})
```

Add tests for invalid payload, deadline expiry, disconnect rejecting all pending requests, and a late response not resolving a reused request.

- [ ] **Step 2: Run focused transport tests and confirm failure**

Run: `corepack pnpm vitest run apps/agent-runtime/tests/runtime-server.test.ts apps/desktop/src/main/runtime/runtime-client.test.ts`

Expected: FAIL because RPC classes do not exist.

- [ ] **Step 3: Implement transport-neutral request correlation**

Use a `Map<string, { resolve, reject, timeout }>` in the client. Parse every inbound envelope before looking up handlers. Generate request ids through an injected `IdGenerator`, not `Date.now()`.

- [ ] **Step 4: Implement Runtime command dispatch and reverse Skill calls**

The server maps `task.submit`, `task.interrupt`, `task.continue`, `task.provide-input`, `task.get`, `events.subscribe`, and `runtime.shutdown` to `AgentRuntime`. Skill execution calls use the same port with a distinct `skill.execute` envelope and request id.

- [ ] **Step 5: Verify bidirectional RPC**

Run: `corepack pnpm vitest run apps/agent-runtime/tests/runtime-server.test.ts apps/desktop/src/main/runtime/runtime-client.test.ts packages/runtime-contracts/tests`

Expected: PASS with timeout handles cleared after every terminal result.

- [ ] **Step 6: Commit transport**

```bash
git add packages/runtime-contracts apps/agent-runtime/src/transport apps/agent-runtime/src/index.ts apps/agent-runtime/tests apps/desktop/src/main/runtime
git commit -m "feat(transport): connect runtime over typed message ports"
```

### Task 8: Supervise UtilityProcess and Bridge to the Renderer

**Files:**

- Create: `apps/desktop/src/main/runtime/runtime-supervisor.ts`
- Create: `apps/desktop/src/main/runtime/runtime-supervisor.test.ts`
- Create: `apps/desktop/src/main/runtime/runtime-process.ts`
- Create: `apps/desktop/src/main/runtime/skill-provider-host.ts`
- Create: `apps/desktop/src/main/runtime/skill-provider-host.test.ts`
- Create: `apps/desktop/src/main/agent-ipc.ts`
- Create: `apps/desktop/src/main/agent-ipc.test.ts`
- Modify: `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/preload/desktop-api.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/env.d.ts`

**Interfaces:**

- Produces: `RuntimeSupervisor.start(): Promise<RuntimeClient>` and `stop(): Promise<void>`.
- Produces: `DesktopApi.agent.submitGoal/getTask/interrupt/continueTask/provideInput/subscribe`.
- Produces: Main Inversify bindings for Supervisor, RuntimeClient, SkillProviderHost, Clock, ProcessFactory.
- Consumes: compiled `apps/agent-runtime/dist/index.js`.

- [ ] **Step 1: Write failing Supervisor state-machine tests**

Use injected fake process, clock, runtime client, and filesystem ports. Cover one shared process across multiple windows, ready timeout, exit during a request, three restarts in 60 seconds, fourth failure entering `failed`, graceful shutdown, and shutdown timeout calling `kill()`.

- [ ] **Step 2: Write failing Preload whitelist tests**

```ts
expect(Object.keys(api.agent).sort()).toEqual([
  'continueTask', 'getTask', 'interrupt', 'provideInput', 'submitGoal', 'subscribe'
])
expect(api).not.toHaveProperty('ipcRenderer')
expect(api).not.toHaveProperty('runtimePort')
expect(api).not.toHaveProperty('databasePath')
```

- [ ] **Step 3: Implement UtilityProcess and Main Inversify bindings**

`RuntimeProcessFactory` calls:

```ts
utilityProcess.fork(runtimeEntryPath, [], {
  env: { ACTION_DRIVER_DATABASE_PATH: databasePath },
  serviceName: 'Action-Driver Agent Runtime',
  stdio: 'pipe'
})
```

Create a `MessageChannelMain`, transfer one port with `child.postMessage({ type: 'runtime.port' }, [port])`, and keep the other inside `RuntimeClient`.

- [ ] **Step 4: Implement Mock SkillProviderHost only**

Register `browser-use.mock` and `computer-use.mock` descriptors. Route execute/cancel messages to deterministic providers. Do not add Playwright, Chromium, WebContentsView automation, AXUIElement, CGEvent, or ScreenCaptureKit code.

- [ ] **Step 5: Implement named Main IPC and Preload subscriptions**

Use explicit channels such as `agent:submit-goal`, `agent:get-task`, `agent:interrupt`, `agent:continue`, `agent:provide-input`, `agent:subscribe`, and `agent:unsubscribe`. Validate renderer inputs before calling `RuntimeClient`; return structured errors rather than raw thrown Electron errors.

- [ ] **Step 6: Verify Main, Preload, and lifecycle tests**

Run: `corepack pnpm vitest run apps/desktop/src/main apps/desktop/src/preload`

Expected: PASS with no Electron process created by unit tests.

- [ ] **Step 7: Commit desktop Runtime supervision**

```bash
git add apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/src/env.d.ts
git commit -m "feat(desktop): supervise and expose local agent runtime"
```

### Task 9: Bind the Renderer Local Adapters and Package the Runtime

**Files:**

- Create: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts`
- Create: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.test.ts`
- Modify: `apps/desktop/src/renderer/src/main.tsx`
- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/e2e/runtime.spec.ts`
- Modify: `apps/desktop/e2e/app.spec.ts`

**Interfaces:**

- Produces: `DesktopAgentAdapter` implementing `AgentCommandService`, `AgentSessionRepository`, and `SkillGateway` over `DesktopApi.agent`.
- Produces: `createRendererContainer({ mode: 'mock' | 'local', desktopApi })` with no component-level conditionals.
- Consumes: Preload `DesktopApi` and cached task projections.

- [ ] **Step 1: Write failing local-binding tests**

```ts
it('binds local adapters without changing React consumers', () => {
  const desktopApi = createFakeDesktopApi()
  const services = resolveAppServices(createRendererContainer({ mode: 'local', desktopApi }))
  expect(services.agentCommandService).toBeInstanceOf(DesktopAgentAdapter)
  expect(services.agentSessionRepository).toBe(services.agentCommandService)
  expect(services.skillGateway).toBe(services.agentCommandService)
})
```

Assert `mode: 'local'` without `desktopApi` throws during composition, while `mode: 'mock'` never reads `window.productDesktop`.

- [ ] **Step 2: Implement a cached Renderer adapter**

The adapter subscribes once through Preload, stores `TaskProjection` objects in a `Map`, keeps `getTask(taskId)` synchronous for existing React consumers, and publishes immutable projections to repository listeners. Command methods delegate to Preload and update the cache only from validated results/events.

- [ ] **Step 3: Configure build order and packaged Runtime entry**

Root build order must run `@action-driver/runtime-contracts`, `@action-driver/agent-runtime`, then `@action-driver/desktop`. Electron packaging must copy `apps/agent-runtime/dist/**` and the correct better-sqlite3 binary into application resources. `resolveRuntimeEntryPath()` must fail with `RUNTIME_ARTIFACT_MISSING` if the entry or native module is absent.

- [ ] **Step 4: Add packaged Runtime E2E**

Launch Electron with local mode and a temporary `userData` directory. Submit a goal through the visible Slate composer, wait for deterministic timeline events, interrupt, continue, close the app, relaunch with the same directory, and assert the task is restored from SQLite.

- [ ] **Step 5: Preserve current visual baselines**

Run: `corepack pnpm build && corepack pnpm test:e2e`

Expected: the existing home/split/expanded/collapsed screenshots remain within the current `0.02` pixel ratio, and the new Runtime E2E passes without real Browser or Computer actions.

- [ ] **Step 6: Commit Renderer local mode and packaging**

```bash
git add apps/desktop package.json pnpm-lock.yaml
git commit -m "feat(desktop): bind and package local langgraph runtime"
```

### Task 10: Complete CI, Documentation, and OpenSpec Verification

**Files:**

- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `.github/workflows/quality.yml`
- Create: `.github/workflows/macos-runtime.yml`
- Modify: `README.md`
- Modify: `openspec/changes/replace-agentd-with-local-langgraph-runtime/tasks.md`

**Interfaces:**

- Produces: repeatable `check:runtime` and packaged macOS Runtime smoke workflows.
- Consumes: all test/build commands from Tasks 1–9.

- [ ] **Step 1: Add CI commands with explicit platform separation**

Docker quality runs install, format check, typecheck, lint, Vitest, contracts, migrations, and Electron build without pretending to execute macOS packaging. The macOS workflow runs arm64 and x64 packaged Runtime smoke tests and verifies the better-sqlite3 binary architecture.

- [ ] **Step 2: Add forbidden-architecture checks**

Create a script assertion that fails if current production sources contain Go/Eino/gRPC/Protobuf Agent Runtime imports or if `apps/agent-runtime` imports Browser/Playwright/Chromium/AXUIElement/CGEvent implementations. Documentation references to the superseded OpenSpec history are allowed only when explicitly labeled superseded.

- [ ] **Step 3: Run fresh full verification**

Run:

```bash
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
openspec validate replace-agentd-with-local-langgraph-runtime --strict
docker compose build quality
docker compose run --rm quality
```

Expected: every command exits 0; local mode uses LangGraph and SQLite, current visual tests pass, and no real Browser/Computer action implementation exists.

- [ ] **Step 4: Mark OpenSpec tasks only after evidence exists**

Update each checkbox in `openspec/changes/replace-agentd-with-local-langgraph-runtime/tasks.md` only when its named verification command has passed in the implementing commit. Run `openspec status --change replace-agentd-with-local-langgraph-runtime` and confirm all implementation tasks are complete.

- [ ] **Step 5: Commit delivery verification**

```bash
git add Dockerfile compose.yaml .github README.md openspec/changes/replace-agentd-with-local-langgraph-runtime/tasks.md
git commit -m "ci: verify local langgraph runtime delivery"
```
