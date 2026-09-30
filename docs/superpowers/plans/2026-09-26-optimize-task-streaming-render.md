# 流式渲染性能与任务状态下沉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模型流式输出时只重渲染变化的内容，流式更新不再让 App 与侧边栏重渲染。

**Architecture:** 任务快照改为冻结的不可变数据并在各层做结构共享（去掉深拷贝）；当前任务由按 services 实例创建的 zustand store 持有，App 只订阅少量派生字段，任务页通过 selector 订阅完整任务；消息、Markdown、工具行、活动组与历史轮次按引用跳过重渲染。

**Tech Stack:** React 19、zustand（vanilla store + `useStore`）、Vitest + Testing Library（jsdom）、TypeScript。

**Spec:** `openspec/changes/optimize-task-streaming-render/`（proposal.md、design.md、tasks.md、specs/agent-task-experience/spec.md）

## Global Constraints

- 运行时依赖只新增 `zustand`，由用户执行 `pnpm --filter @action-driver/desktop add zustand` 安装（Agent 无法访问 npm）。
- 不引入虚拟列表（用户裁决）。
- 不改变视觉、交互、IPC、Runtime 协议与 e2e 测试 id。
- 已发出的任务快照 MUST NOT 被修改；分发路径 MUST NOT 深拷贝整个任务。
- 迭代期只运行定向测试与 `pnpm typecheck`；全量 `pnpm typecheck && pnpm lint && pnpm test` 只在提交前运行一次（AGENTS.md）。
- Agent 的 shell 无法运行 macOS 版 `node_modules`：每个「Run」步骤由用户在 `~/coding/action-driver` 执行并回传输出。为减少往返，执行时可以把同一批任务的「红」「绿」运行合并为一次。

## Review Focus

- 渲染层或其他服务代码原地修改了已冻结的任务快照 → 期望：不会发生；一旦发生立即抛 TypeError 而不是静默污染。由 Task 3 的 App 级测试经真实 App + TaskPage 跑流式更新覆盖，并在 Task 1 做一次全局检索。
- 流式更新属于一个非当前任务（用户刚切换了任务） → 期望：被忽略，界面仍显示当前任务。由 Task 3 store 测试覆盖。
- 流式输出期间进入设置页再返回 → 期望：任务页直接显示最新内容。由 Task 3 App 测试覆盖。
- 当前任务变为运行中（打开一个仍在运行的历史任务） → 期望：仍会恢复其流。由 Task 3 App 测试覆盖。
- Computer Use 任务反复收到更新 → 期望：授权指引只触发一次。由 Task 3 App 测试覆盖。

---

## File Structure

| 文件 | 职责 | 变更 |
|---|---|---|
| `apps/desktop/src/renderer/src/services/stream-task-projection.ts` | 流事件 → 任务快照；新增 `freezeDeep` | 修改 |
| `apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts` | 缓存并分发快照 | 修改 |
| `packages/activity-projection/src/activity-projection.ts` | 活动时间线归约器 | 改为按需复制 |
| `apps/desktop/src/renderer/src/stores/task-store.ts` | zustand 当前任务 store 与仓库绑定 | 新建 |
| `apps/desktop/src/renderer/src/di/services-context.tsx` | 下发 store，提供 `useTaskStore` / `useTaskStoreApi` | 修改 |
| `apps/desktop/src/renderer/src/services/computer-use-guidance.ts` | 新增按任务 id 的 `useComputerUseGuidanceFor` | 修改 |
| `apps/desktop/src/renderer/src/App.tsx` | 改为读写 store，回调改为稳定引用，新增 `ActiveTaskPage` | 修改 |
| `apps/desktop/src/renderer/src/components/MarkdownContent.tsx` | `memo` + 按内容缓存 | 修改 |
| `apps/desktop/src/renderer/src/components/Conversation.tsx` | 常量空工具列表 | 修改 |
| `apps/desktop/src/renderer/src/components/agent/{AgentResponse,UserMessage,ToolGroup}.tsx` | `memo` | 修改 |
| `apps/desktop/src/renderer/src/components/agent/PriorTurn.tsx` | 记忆化的历史轮次 | 新建 |
| `apps/desktop/src/renderer/src/pages/TaskPage.tsx` | 使用 `PriorTurn`，常量空列表 | 修改 |

---

### Task 1: 冻结的不可变快照与结构共享

**Files:**
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts`
- Test: `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`
- Test: `apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`

**Interfaces:**
- Produces: `export function freezeDeep<T>(value: T): T`（位于 `stream-task-projection.ts`）；`StreamTaskProjection.snapshot()` 返回冻结对象；`DesktopAgentAdapter.getTask()` 与订阅回调收到同一个冻结对象。

- [ ] **Step 1: 写失败的测试（投影）**

在 `stream-task-projection.test.ts` 中，把现有的 `returns immutable snapshots` 用例替换为：

```ts
  it('returns frozen snapshots that cannot be mutated', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    const external = projection.snapshot()!
    expect(() => {
      external.messages[0]!.content = 'mutated'
    }).toThrow(TypeError)
    expect(projection.snapshot()?.messages[0]?.content).toBe('写代码')
  })

  it('shares unchanged parts between consecutive snapshots and never rewrites old ones', () => {
    const projection = new StreamTaskProjection({
      onChange: vi.fn(),
      schedule: () => 1,
      cancelScheduled: () => undefined
    })
    projection.attach(task())
    projection.apply(start())
    projection.apply(content(1, '第一段'))
    const first = projection.snapshot()!
    projection.apply(content(2, '，第二段'))
    const second = projection.snapshot()!

    expect(Object.isFrozen(first.messages[1]!)).toBe(true)
    expect(first.messages[1]!.content).toBe('第一段')
    expect(second.messages[1]!.content).toBe('第一段，第二段')
    expect(second.messages[0]).toBe(first.messages[0])
    expect(second.steps).toBe(first.steps)
  })
```

- [ ] **Step 2: 写失败的测试（适配器）**

在 `desktop-agent-adapter.test.ts` 的 `describe` 块内追加：

```ts
  it('hands listeners the cached frozen snapshot instead of a copy', async () => {
    const { adapter } = harness()
    const listener = vi.fn()
    adapter.subscribe(listener)
    await adapter.submitGoal({
      goal: 'Book a hotel',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    const emitted = listener.mock.lastCall![0] as TaskProjection
    expect(Object.isFrozen(emitted)).toBe(true)
    expect(adapter.getTask('task-1')).toBe(emitted)
  })
```

- [ ] **Step 3: 运行，确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`
Expected: 上述 3 个用例 FAIL（快照未冻结 / 引用不同）。

- [ ] **Step 4: 实现 `freezeDeep` 并让 `snapshot()` 返回冻结对象**

在 `stream-task-projection.ts` 中，`type ScheduledHandle = unknown` 之后加入：

```ts
/**
 * Freezes a projection in place. Frozen subtrees are skipped, so with structural sharing only the
 * objects created since the previous snapshot are walked.
 */
export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) freezeDeep(nested)
  return value
}
```

把 `snapshot()` 改为：

```ts
  snapshot(): TaskProjection | null {
    return this.task ? freezeDeep(this.task) : null
  }
```

- [ ] **Step 5: 修正唯一的原地修改**

在 `response.content` 分支中，把

```ts
      const last = parts.at(-1)
      if (last?.kind === 'text') last.text += event.delta
      else
```

替换为：

```ts
      const last = parts.at(-1)
      if (last?.kind === 'text') parts[parts.length - 1] = { ...last, text: last.text + event.delta }
      else
```

然后逐处核对本文件中每个 `delete this.task.preparingToolName`：它前面必须紧跟一次 `this.task = { ...this.task, ... }`（作用于新对象）。当前 7 处均满足；`tool.*` 分支与 `activity.*` 分支里的 `delete` 前面是 `this.task = { ...this.task, streamSequence: event.sequence }`，同样满足。

- [ ] **Step 6: 适配器改为分发同一个冻结对象**

在 `desktop-agent-adapter.ts` 中：

1. 顶部导入改为 `import { StreamTaskProjection, freezeDeep } from './stream-task-projection'`。
2. `submitGoal` 中把 `const snapshot = projection.snapshot() ?? mapped` 改为 `const snapshot = freezeDeep(projection.snapshot() ?? mapped)`（`return structuredClone(snapshot)` 保留：调用方可能修改返回值）。
3. `getTask` 改为：

```ts
  getTask(taskId: string): TaskProjection | null {
    return this.tasks.get(taskId) ?? null
  }
```

4. `restoreTaskStream` 中把 `this.tasks.set(task.id, structuredClone(task))` 改为 `this.tasks.set(task.id, freezeDeep(structuredClone(task)))`。
5. `emit` 改为：

```ts
  private emit(task: TaskProjection): void {
    this.listeners.forEach((listener) => listener(task))
  }
```

- [ ] **Step 7: 全局检索可能修改快照的代码**

Run: `grep -rnE "(task|projection|current|restored)\.[a-zA-Z]+(\.[a-zA-Z]+)* (=|\+=)[^=]" apps/desktop/src/renderer/src --include=*.ts --include=*.tsx | grep -v "\.test\."`
Expected: 只有 `stream-task-projection.ts` 中 `attach()` 对自身 `structuredClone` 结果的赋值。若出现其他命中，改为展开语法生成新对象。

- [ ] **Step 8: 运行，确认通过**

Run: `pnpm vitest run apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`
Expected: 全部 PASS。

---

### Task 2: activity 归约器只复制被改动的活动组

**Files:**
- Modify: `packages/activity-projection/src/activity-projection.ts`
- Test: `packages/activity-projection/tests/activity-projection.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `reduceActivityProjection(state, event)` 签名不变；未改动的 `activities[i]`、`timeline`、`toolActivityIds`、`textPhases` 保持原引用；永不修改入参。

- [ ] **Step 1: 写失败的测试**

在测试文件顶部 `function tool(` 之前加入：

```ts
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}
```

在 `describe` 块内追加：

```ts
  it('copies only the activity group an event changes and never mutates its input', () => {
    const started = [
      event(1, { type: 'activity.started', activityId: 'a', title: 'A', titleRevision: 1 }),
      event(2, { type: 'activity.started', activityId: 'b', title: 'B', titleRevision: 1 })
    ].reduce(reduceActivityProjection, emptyActivityTimelineState())
    deepFreeze(started)

    const withText = reduceActivityProjection(
      started,
      event(3, { type: 'activity.text', activityId: 'b', textId: 't', delta: '你好' })
    )
    expect(withText.activities[0]).toBe(started.activities[0])
    expect(withText.activities[1]).not.toBe(started.activities[1])
    expect(withText.activities[1]!.items).toEqual([
      { id: 'text:t', kind: 'text', content: '你好', phase: 'pending' }
    ])
    expect(withText.timeline).toBe(started.timeline)

    deepFreeze(withText)
    const appended = reduceActivityProjection(
      withText,
      event(4, { type: 'activity.text', activityId: 'b', textId: 't', delta: '世界' })
    )
    expect(appended.activities[1]!.items[0]).toEqual({
      id: 'text:t', kind: 'text', content: '你好世界', phase: 'pending'
    })
    const done = reduceActivityProjection(
      deepFreeze(appended),
      event(5, { type: 'activity.text.done', textId: 't', phase: 'final' })
    )
    expect(done.activities[1]!.items[0]).toMatchObject({ phase: 'final' })
    expect(done.activities[0]).toBe(started.activities[0])

    const withTool = reduceActivityProjection(deepFreeze(done), { ...tool(6, 'call-1'), activityId: 'a' } as StreamServerEvent)
    expect(withTool.activities[0]!.items).toEqual([{ id: 'tool:call-1', kind: 'tool', callId: 'call-1' }])
    expect(withTool.activities[1]).toBe(done.activities[1])
    expect(withTool.toolActivityIds).toEqual({ 'call-1': 'a' })
  })
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm vitest run packages/activity-projection/tests/activity-projection.test.ts`
Expected: 新用例 FAIL（`activities[0]` 不是同一个引用）；其余用例 PASS。

- [ ] **Step 3: 重写归约器**

把 `reduceActivityProjection` 整个函数替换为以下实现（`ActivityTimelineState`、`emptyActivityTimelineState` 不变），并在文件顶部导入中补充 `ActivityTextProjection`：

```ts
import type {
  ActivityProjection,
  ActivityTextProjection,
  TaskTimelineProjectionItem
} from '@action-driver/contracts'
```

```ts
type Item = { id: string; kind: string }

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, position) => (position === index ? value : item))
}

/** Appends to the text item `itemId`, or adds it; returns a new array. */
function appendText<T extends Item>(items: readonly T[], itemId: string, delta: string): T[] {
  const index = items.findIndex((item) => item.id === itemId)
  const existing = index < 0 ? undefined : items[index]
  if (existing?.kind === 'text') {
    const text = existing as unknown as ActivityTextProjection
    return replaceAt(items, index, { ...text, content: text.content + delta } as unknown as T)
  }
  return [...items, { id: itemId, kind: 'text', content: delta, phase: 'pending' } as unknown as T]
}

/** Sets the phase of the text item `itemId`; returns the same array when it is absent. */
function setTextPhase<T extends Item>(
  items: T[],
  itemId: string,
  phase: NonNullable<ActivityTextProjection['phase']>
): T[] {
  const index = items.findIndex((item) => item.id === itemId && item.kind === 'text')
  if (index < 0) return items
  return replaceAt(items, index, { ...items[index]!, phase } as T)
}

/** Call with one request's events in contiguous request-sequence order; cursor locates replay. */
export function reduceActivityProjection(
  state: ActivityTimelineState,
  event: StreamServerEvent
): ActivityTimelineState {
  if (!('cursor' in event) || event.cursor <= state.cursor) return state
  // Copy-on-write: untouched activity groups keep their references so the renderer can skip them.
  const next: ActivityTimelineState = { ...state, cursor: event.cursor }
  const updateActivity = (
    activityId: string | null | undefined,
    update: (activity: ActivityProjection) => ActivityProjection
  ): boolean => {
    const index = next.activities.findIndex((activity) => activity.activityId === activityId)
    if (index < 0) return false
    const current = next.activities[index]!
    const updated = update(current)
    if (updated !== current) next.activities = replaceAt(next.activities, index, updated)
    return true
  }

  if (event.type === 'activity.started') {
    if (!next.activities.some((activity) => activity.activityId === event.activityId)) {
      next.activities = [
        ...next.activities,
        {
          activityId: event.activityId,
          title: event.title,
          titleRevision: event.titleRevision,
          status: 'running',
          items: []
        }
      ]
      next.timeline = [
        ...next.timeline,
        { id: `activity:${event.activityId}`, kind: 'activity', activityId: event.activityId }
      ]
    }
    return next
  }
  if (event.type === 'activity.updated') {
    updateActivity(event.activityId, (activity) =>
      event.titleRevision > activity.titleRevision
        ? { ...activity, title: event.title, titleRevision: event.titleRevision }
        : activity
    )
    return next
  }
  if (event.type === 'activity.completed') {
    updateActivity(event.activityId, (activity) => ({ ...activity, status: 'completed' }))
    return next
  }
  if (event.type === 'activity.text') {
    const textId = event.textId ?? event.eventId
    const itemId = `text:${textId}`
    if (!(textId in next.textPhases)) next.textPhases = { ...next.textPhases, [textId]: 'pending' }
    const inActivity = updateActivity(event.activityId, (activity) => ({
      ...activity,
      items: appendText(activity.items, itemId, event.delta)
    }))
    if (!inActivity) next.timeline = appendText(next.timeline, itemId, event.delta)
    return next
  }
  if (event.type === 'activity.text.done') {
    next.textPhases = { ...next.textPhases, [event.textId]: event.phase }
    const itemId = `text:${event.textId}`
    let changed = false
    const activities = next.activities.map((activity) => {
      const items = setTextPhase(activity.items, itemId, event.phase)
      if (items === activity.items) return activity
      changed = true
      return { ...activity, items }
    })
    if (changed) next.activities = activities
    next.timeline = setTextPhase(next.timeline, itemId, event.phase)
    return next
  }
  if (event.type.startsWith('tool.') && 'callId' in event) {
    const callId = event.callId
    const itemId = `tool:${callId}`
    const activityId = 'activityId' in event ? event.activityId : null
    if (!(callId in next.toolActivityIds)) {
      next.toolActivityIds = { ...next.toolActivityIds, [callId]: activityId ?? null }
    }
    if (activityId) {
      updateActivity(activityId, (activity) =>
        activity.items.some((item) => item.id === itemId)
          ? activity
          : { ...activity, items: [...activity.items, { id: itemId, kind: 'tool', callId }] }
      )
    } else if (!next.timeline.some((item) => item.id === itemId)) {
      next.timeline = [...next.timeline, { id: itemId, kind: 'tool', callId }]
    }
  }
  return next
}
```

与旧实现的语义对照：`activity.text` 在 `activityId` 找不到活动组时写入顶层 `timeline`（旧实现 `activity?.items ?? next.timeline`）；`activity.text.done` 同时更新所有活动组与顶层中的同 id 文本；工具事件只在首次出现时登记 `toolActivityIds`。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm vitest run packages/activity-projection/tests/activity-projection.test.ts apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/agent-runtime/tests/stream-session-service.test.ts`
Expected: 全部 PASS（`stream-session-service` 测试文件若不存在，去掉该路径即可；Runtime 也使用该归约器）。

---

### Task 3: zustand 任务 store 与 App 接线

**Files:**
- Create: `apps/desktop/src/renderer/src/stores/task-store.ts`
- Create: `apps/desktop/src/renderer/src/stores/task-store.test.ts`
- Create: `apps/desktop/src/renderer/src/App.render-scope.test.tsx`
- Modify: `apps/desktop/src/renderer/src/di/services-context.tsx`
- Modify: `apps/desktop/src/renderer/src/services/computer-use-guidance.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: Task 1 的冻结快照（App 不再复制任务）。
- Produces:
  - `export type TaskStoreState = { activeTask: TaskProjection | null; setActiveTask(task: TaskProjection | null): void }`
  - `export type TaskStore = StoreApi<TaskStoreState>`
  - `export function createTaskStore(): TaskStore`
  - `export function bindTaskStoreToRepository(store: TaskStore, repository: AgentSessionRepository): () => void`
  - `export function useTaskStore<T>(selector: (state: TaskStoreState) => T): T` 与 `export function useTaskStoreApi(): TaskStore`（位于 `di/services-context.tsx`）
  - `export function useComputerUseGuidanceFor(taskId: string | null): void`

- [ ] **Step 1: 安装依赖（用户执行）**

Run: `pnpm --filter @action-driver/desktop add zustand`
Expected: `apps/desktop/package.json` 出现 `zustand`，`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 写失败的 store 测试**

创建 `stores/task-store.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRepository, TaskProjection } from '@action-driver/contracts'
import { bindTaskStoreToRepository, createTaskStore } from './task-store'

const task = (id: string, title = id): TaskProjection => ({
  id,
  sessionId: `${id}-session`,
  title,
  status: 'running',
  model: { connectionId: 'connection', modelId: 'model' },
  messages: [],
  steps: [],
  browser: null
})

function repository() {
  let listener: ((task: TaskProjection) => void) | undefined
  const repo: AgentSessionRepository = {
    getTask: () => null,
    subscribe: vi.fn((next: (task: TaskProjection) => void) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
  }
  return { repo, push: (next: TaskProjection) => listener?.(next), subscribed: () => !!listener }
}

describe('task store', () => {
  it('accepts repository updates only for the active task', () => {
    const store = createTaskStore()
    const { repo, push } = repository()
    bindTaskStoreToRepository(store, repo)

    push(task('a'))
    expect(store.getState().activeTask).toBeNull()

    store.getState().setActiveTask(task('a'))
    const update = task('a', '新标题')
    push(update)
    expect(store.getState().activeTask).toBe(update)

    push(task('b'))
    expect(store.getState().activeTask).toBe(update)
  })

  it('stops listening once unbound', () => {
    const store = createTaskStore()
    const { repo, subscribed } = repository()
    const unbind = bindTaskStoreToRepository(store, repo)
    expect(subscribed()).toBe(true)
    unbind()
    expect(subscribed()).toBe(false)
  })
})
```

- [ ] **Step 3: 写失败的 App 级测试**

创建 `App.render-scope.test.tsx`：

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskProjection } from '@action-driver/contracts'

const sidebarRenders = vi.hoisted(() => vi.fn())
vi.mock('./components/Sidebar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/Sidebar')>()
  return {
    ...actual,
    Sidebar: (props: Parameters<typeof actual.Sidebar>[0]) => {
      sidebarRenders()
      return actual.Sidebar(props)
    }
  }
})

import { App } from './App'
import { createRendererServices } from './di/container'
import { AppServicesProvider } from './di/services-context'

async function renderStreamingApp() {
  const services = createRendererServices({ mode: 'mock' })
  let push: ((task: TaskProjection) => void) | undefined
  services.agentSessionRepository = {
    getTask: () => null,
    subscribe: (listener) => {
      push = listener
      return () => {
        push = undefined
      }
    }
  }
  services.restoreTaskStream = vi.fn(async () => undefined)
  render(
    <AppServicesProvider services={services}>
      <App initialRoute="task" />
    </AppServicesProvider>
  )
  const page = await screen.findByTestId('e2e/tasks/detail/page#page')
  const current = (await services.taskCatalog.getTask(page.getAttribute('data-task-id')!))!
  await screen.findByRole('button', { name: /预订周末去杭州的酒店/ })
  return { services, current, push: (task: TaskProjection) => act(() => push!(task)) }
}

describe('App render scope', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => {
    sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('re-renders the task page but not the sidebar when the active task streams', async () => {
    const { current, push } = await renderStreamingApp()
    sidebarRenders.mockClear()
    push({ ...current, title: '流式更新后的标题' })
    expect(await screen.findByText('流式更新后的标题')).toBeVisible()
    expect(sidebarRenders).not.toHaveBeenCalled()
  })

  it('shows the latest task after returning from settings mid-stream', async () => {
    const user = userEvent.setup()
    const { current, push } = await renderStreamingApp()
    await user.click(screen.getByRole('button', { name: '设置' }))
    push({ ...current, title: '设置期间收到的更新' })
    await user.click(await screen.findByRole('button', { name: '返回应用' }))
    expect(await screen.findByText('设置期间收到的更新')).toBeVisible()
  })

  it('restores the stream once the active task is running', async () => {
    const { services, current, push } = await renderStreamingApp()
    const running = {
      ...current,
      status: 'running' as const,
      streamRequestId: 'request-1',
      streamResponseId: 'response-1'
    }
    push(running)
    await waitFor(() => expect(services.restoreTaskStream).toHaveBeenCalledWith(running))
    push({ ...running, title: '运行中的新标题' })
    await screen.findByText('运行中的新标题')
    expect(services.restoreTaskStream).toHaveBeenCalledTimes(1)
  })

  it('asks for Computer Use guidance once however often the task updates', async () => {
    const ensureGuidance = vi.fn(async () => true)
    vi.stubGlobal('productDesktop', { computerUse: { ensureGuidance } })
    const { current, push } = await renderStreamingApp()
    const computerTask = {
      ...current,
      tools: [{ callId: 'call-1', toolId: 'computer.observe', modelName: 'computer_observe',
        summary: '观察桌面', argumentsHash: 'hash', status: 'running' as const }]
    }
    push(computerTask)
    push({ ...computerTask, title: '再次更新' })
    await waitFor(() => expect(ensureGuidance).toHaveBeenCalledOnce())
  })
})
```

- [ ] **Step 4: 运行，确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/stores/task-store.test.ts apps/desktop/src/renderer/src/App.render-scope.test.tsx`
Expected: store 测试因模块不存在 FAIL；`re-renders the task page but not the sidebar` FAIL（侧边栏被重渲染）。其余 App 用例可能已通过，它们用于防回归。

- [ ] **Step 5: 实现 store**

创建 `stores/task-store.ts`：

```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AgentSessionRepository, TaskProjection } from '@action-driver/contracts'

export type TaskStoreState = {
  /** The task the task page shows; a frozen, structurally shared projection. */
  activeTask: TaskProjection | null
  setActiveTask(task: TaskProjection | null): void
}

export type TaskStore = StoreApi<TaskStoreState>

export function createTaskStore(): TaskStore {
  return createStore<TaskStoreState>()((set) => ({
    activeTask: null,
    setActiveTask: (task) => set({ activeTask: task })
  }))
}

/** Streams repository updates into the store, keeping only those for the active task. */
export function bindTaskStoreToRepository(
  store: TaskStore,
  repository: AgentSessionRepository
): () => void {
  return repository.subscribe((projection) => {
    if (store.getState().activeTask?.id === projection.id) store.setState({ activeTask: projection })
  })
}
```

（设计中写的 `open / present / clear` 三个动作由单个 `setActiveTask` 覆盖：打开与呈现都是设置当前任务，清除即设为 `null`；路由与最近任务列表仍由 App 负责。）

- [ ] **Step 6: 下发 store**

把 `di/services-context.tsx` 替换为：

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useStore } from 'zustand'
import type { AppServices } from './container'
import {
  bindTaskStoreToRepository,
  createTaskStore,
  type TaskStore,
  type TaskStoreState
} from '../stores/task-store'

const AppServicesContext = createContext<AppServices | null>(null)
const TaskStoreContext = createContext<TaskStore | null>(null)

export function AppServicesProvider({
  services,
  children
}: {
  services: AppServices
  children: ReactNode
}) {
  const [queryClient] = useState(() => new QueryClient())
  const [taskStore] = useState(createTaskStore)
  const repository = services.agentSessionRepository
  // Bound in an effect so StrictMode's mount/unmount/mount cycle leaves exactly one subscription.
  useEffect(() => bindTaskStoreToRepository(taskStore, repository), [taskStore, repository])
  return (
    <QueryClientProvider client={queryClient}>
      <AppServicesContext.Provider value={services}>
        <TaskStoreContext.Provider value={taskStore}>{children}</TaskStoreContext.Provider>
      </AppServicesContext.Provider>
    </QueryClientProvider>
  )
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext)
  if (!services) throw new Error('AppServicesProvider is missing')
  return services
}

export function useTaskStoreApi(): TaskStore {
  const store = useContext(TaskStoreContext)
  if (!store) throw new Error('AppServicesProvider is missing')
  return store
}

/** Subscribes to one slice of the task store; the component re-renders only when it changes. */
export function useTaskStore<T>(selector: (state: TaskStoreState) => T): T {
  return useStore(useTaskStoreApi(), selector)
}
```

- [ ] **Step 7: 按任务 id 的授权指引 hook**

把 `services/computer-use-guidance.ts` 中的 `useComputerUseGuidance` 替换为：

```ts
/** Asks Main once per task id; pass `null` while the task does not use Computer Use. */
export function useComputerUseGuidanceFor(taskId: string | null): void {
  const ensured = useRef(new Set<string>())
  useEffect(() => {
    if (!taskId || ensured.current.has(taskId)) return
    ensured.current.add(taskId)
    const api = window.productDesktop?.computerUse
    if (!api?.ensureGuidance) return
    void api.ensureGuidance().catch(() => undefined)
  }, [taskId])
}

export function useComputerUseGuidance(task: TaskProjection | null | undefined): void {
  useComputerUseGuidanceFor(task && taskUsesComputerUse(task) ? task.id : null)
}
```

（保留原有文档注释；`useComputerUseGuidance` 的既有测试不变。）

- [ ] **Step 8: App 改为读写 store**

在 `App.tsx` 中依次修改：

1. 导入：

```tsx
import type { ComponentProps } from 'react'
import { useAppServices, useTaskStore, useTaskStoreApi } from './di/services-context'
import { taskUsesComputerUse, useComputerUseGuidanceFor } from './services/computer-use-guidance'
```

（删除原来的 `useAppServices` 与 `useComputerUseGuidance` 导入。）

2. 把

```tsx
  const [task, setTask] = useState<TaskProjection | null>(null)
  useComputerUseGuidance(task)
```

替换为：

```tsx
  const taskStore = useTaskStoreApi()
  const setTask = taskStore.getState().setActiveTask
  // App subscribes to derived fields only, so streaming updates never re-render the shell.
  const hasTask = useTaskStore((state) => state.activeTask !== null)
  const computerTaskId = useTaskStore((state) =>
    state.activeTask && taskUsesComputerUse(state.activeTask) ? state.activeTask.id : null
  )
  useComputerUseGuidanceFor(computerTaskId)
  const runningStreamKey = useTaskStore((state) => {
    const active = state.activeTask
    return active?.status === 'running' && active.streamRequestId && active.streamResponseId
      ? `${active.id}\u0000${active.streamRequestId}\u0000${active.streamResponseId}`
      : null
  })
```

3. 删除整个订阅副作用（store 已在 provider 中绑定）：

```tsx
  useEffect(
    () =>
      services.agentSessionRepository.subscribe((projection) =>
        setTask((current) => (current?.id === projection.id ? projection : current))
      ),
    [services]
  )
```

4. 把恢复运行中任务流的副作用替换为：

```tsx
  useEffect(() => {
    if (!runningStreamKey) return
    const running = taskStore.getState().activeTask
    if (!running) return
    void services.restoreTaskStream?.(running).catch((error: unknown) => {
      console.error('Failed to restore running task stream', error)
    })
  }, [services, taskStore, runningStreamKey])
```

5. 在 `loadRecentTasks` 与 `presentSubmittedTask` 的 `useCallback` 依赖数组中加入 `setTask`（分别变为 `[initialRoute, queryClient, services, setTask]` 与 `[setTask]`）。

6. `submitContinuation` 改为在调用时读取当前任务：把函数体开头的 `if (!task) return` 替换为

```tsx
      const task = taskStore.getState().activeTask
      if (!task) return
```

并把依赖数组中的 `task` 换成 `taskStore`。

7. 在 `submitContinuation` 之后、`const mainRoute` 之前加入稳定回调：

```tsx
  const controlTarget = useCallback(() => {
    const active = taskStore.getState().activeTask
    return active?.tools?.some((tool) => tool.toolId.startsWith('computer.'))
      ? active.id
      : 'browser-invocation'
  }, [taskStore])
  const pauseTask = useCallback(
    () => services.skillGateway.pause(controlTarget()),
    [services, controlTarget]
  )
  const resumeTask = useCallback(
    () => services.skillGateway.resume(controlTarget()),
    [services, controlTarget]
  )
  const takeOverTask = useCallback(
    () => services.skillGateway.takeOver(controlTarget()),
    [services, controlTarget]
  )
  const decideComputerAction = useCallback(
    (approved: boolean, providerCallId: string) => {
      const active = taskStore.getState().activeTask
      if (!active) return
      return services.agentCommandService.provideInput(active.id, { approved, providerCallId })
    },
    [services, taskStore]
  )
  const interruptTask = useCallback(() => {
    const active = taskStore.getState().activeTask
    if (active) void services.agentCommandService.interrupt(active.id)
  }, [services, taskStore])
  const selectModel = useCallback(
    (selected: ModelRef) => setModelSelection((current) => ({ ...current, selected })),
    []
  )
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), [])
```

8. 把渲染中的 `) : task ? (` 分支整体替换为：

```tsx
      ) : hasTask ? (
        <ActiveTaskPage
          onOpenModelSettings={openSettings}
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={expandSidebar}
          mode={mode}
          modelSelection={modelSelection}
          onSelectModel={selectModel}
          onModeChange={setMode}
          onPause={pauseTask}
          onResume={resumeTask}
          onTakeOver={takeOverTask}
          onComputerDecision={decideComputerAction}
          onInterrupt={interruptTask}
          readImage={services.imageAssets ? readImage : undefined}
          readOutputFile={services.outputFiles ? readOutputFile : undefined}
          onSubmit={submitContinuation}
        />
      ) : null}
```

9. 在 `function readActiveTaskId()` 之前加入：

```tsx
/** The only component that subscribes to the whole task, so each stream update renders here. */
function ActiveTaskPage(props: Omit<ComponentProps<typeof TaskPage>, 'task'>) {
  const task = useTaskStore((state) => state.activeTask)
  return task ? <TaskPage {...props} task={task} /> : null
}
```

`openSettings` 仍是普通函数：设置页打开期间 App 会重渲染，这是预期行为；流式更新不会触发它。

- [ ] **Step 9: 运行，确认通过**

Run: `pnpm vitest run apps/desktop/src/renderer/src/stores/task-store.test.ts apps/desktop/src/renderer/src/App.render-scope.test.tsx apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/services/computer-use-guidance.test.tsx && pnpm --filter @action-driver/desktop typecheck`
Expected: 全部 PASS，typecheck 无错误。

---

### Task 4: 渲染层按引用跳过

**Files:**
- Create: `apps/desktop/src/renderer/src/components/agent/PriorTurn.tsx`
- Create: `apps/desktop/src/renderer/src/pages/TaskPage.render.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/MarkdownContent.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Conversation.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agent/AgentResponse.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agent/UserMessage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agent/ToolGroup.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`

**Interfaces:**
- Consumes: Task 1 的结构共享（未变化的消息保持引用）。
- Produces: `export const EMPTY_TOOLS: ToolInvocationProjection[]`（`Conversation.tsx`）；`export const PriorTurn`（props：`user`、`replies`、`activity`、`shell`、`readImage?`、`readOutputFile?`）；`export type TaskShell = Pick<TaskProjection, 'sessionId' | 'title' | 'model' | 'steps' | 'browser'>`（`PriorTurn.tsx`）。

- [ ] **Step 1: 写失败的渲染次数测试**

创建 `pages/TaskPage.render.test.tsx`：

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentMessageProjection, TaskProjection } from '@action-driver/contracts'

const markdownRenders = vi.hoisted(() => vi.fn<(source: string) => void>())
vi.mock('markdown-it', async (importOriginal) => {
  const actual = await importOriginal<typeof import('markdown-it')>()
  const MarkdownIt = actual.default
  class CountingMarkdownIt extends MarkdownIt {
    override render(source: string, env?: unknown): string {
      markdownRenders(source)
      return super.render(source, env as never)
    }
  }
  return { ...actual, default: CountingMarkdownIt }
})

import { TaskPage } from './TaskPage'
import { mockModelSelection } from '../testing/model-selection-fixture'

function history(): AgentMessageProjection[] {
  return Array.from({ length: 50 }, (_, index): AgentMessageProjection[] => [
    { id: `user-${index}`, role: 'user', content: `问题 ${index}` },
    { id: `agent-${index}`, role: 'agent', content: `历史回答 ${index}` }
  ]).flat()
}

const props = {
  mode: 'split' as const,
  modelSelection: mockModelSelection,
  onSelectModel: vi.fn(),
  onModeChange: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onTakeOver: vi.fn(),
  onInterrupt: vi.fn(),
  onSubmit: vi.fn()
}

describe('TaskPage streaming render scope', () => {
  it('re-renders markdown only for the streaming message in a long conversation', () => {
    let task: TaskProjection = {
      id: 'task-long',
      sessionId: 'session-long',
      title: '长对话',
      status: 'running',
      model: { connectionId: 'connection', modelId: 'model' },
      messages: [
        ...history(),
        { id: 'user-now', role: 'user', content: '当前问题' },
        { id: 'agent-now', role: 'agent', content: '' }
      ],
      steps: [],
      browser: null
    }
    const view = render(<TaskPage {...props} task={task} />)
    markdownRenders.mockClear()

    for (let index = 1; index <= 50; index += 1) {
      const streaming = task.messages.at(-1)!
      // Mirrors the projection: only the streaming message is replaced.
      task = {
        ...task,
        messages: [
          ...task.messages.slice(0, -1),
          { ...streaming, content: `${streaming.content}片段${index} ` }
        ]
      }
      view.rerender(<TaskPage {...props} task={task} />)
    }

    const sources = markdownRenders.mock.calls.map(([source]) => source)
    expect(sources.length).toBeGreaterThan(0)
    expect(sources.length).toBeLessThanOrEqual(50)
    expect(sources.every((source) => source.startsWith('片段'))).toBe(true)
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm vitest run apps/desktop/src/renderer/src/pages/TaskPage.render.test.tsx`
Expected: FAIL，`sources` 中包含「历史回答」开头的内容。

- [ ] **Step 3: MarkdownContent 记忆化**

把 `components/MarkdownContent.tsx` 替换为：

```tsx
import { memo, useMemo, useRef } from 'react'
import MarkdownIt from 'markdown-it'
import { useScrollFade } from './scroll-fade'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

function MarkdownContentView({ content, className }: { content: string; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Code blocks and wide tables scroll horizontally inside a message.
  useScrollFade(rootRef, { selector: 'pre, table', deps: [content] })
  const html = useMemo(() => markdown.render(content), [content])
  return (
    <div
      ref={rootRef}
      className={className}
      data-testid="e2e/tasks/detail/markdown#section"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Renders markdown once per distinct content; unchanged messages skip rendering entirely. */
export const MarkdownContent = memo(MarkdownContentView)
```

- [ ] **Step 4: 消息与工具组件记忆化**

1. `components/agent/AgentResponse.tsx`：导入改为 `import { memo, type ReactNode } from 'react'`；在导入之后加入 `const NO_TOOLS: ToolInvocationProjection[] = []`；把 `export function AgentResponse({` 改为 `function AgentResponseView({`，把其参数默认值 `tools = [],` 改为 `tools = NO_TOOLS,`；在文件末尾加入：

```tsx

export const AgentResponse = memo(AgentResponseView)
```

2. `components/agent/UserMessage.tsx`：顶部加入 `import { memo } from 'react'`；把 `export function UserMessage({` 改为 `function UserMessageView({`；在文件末尾加入：

```tsx

export const UserMessage = memo(UserMessageView)
```

3. `components/agent/ToolGroup.tsx`：导入改为 `import { memo, useRef } from 'react'`；把

```tsx
export function ActivityGroup({
  activity,
  tools
}: {
  activity: ActivityProjection
  tools: Map<string, ToolInvocationProjection>
}) {
```

替换为：

```tsx
type ActivityGroupProps = {
  activity: ActivityProjection
  tools: Map<string, ToolInvocationProjection>
}

function ActivityGroupView({ activity, tools }: ActivityGroupProps) {
```

把 `export function ToolRow({ tool }: { tool: ToolInvocationProjection | undefined }) {` 改为 `function ToolRowView({ tool }: { tool: ToolInvocationProjection | undefined }) {`；在文件末尾（最后一个 `}` 之后，先补一个换行）加入：

```tsx

/** A group re-renders only when its activity or one of its own tools changes. */
function sameActivityGroup(previous: ActivityGroupProps, next: ActivityGroupProps): boolean {
  if (previous.activity !== next.activity) return false
  return previous.activity.items.every(
    (item) => item.kind !== 'tool' || previous.tools.get(item.callId) === next.tools.get(item.callId)
  )
}

export const ActivityGroup = memo(ActivityGroupView, sameActivityGroup)
export const ToolRow = memo(ToolRowView)
```

4. `components/Conversation.tsx`：在导入之后加入

```tsx
/** Shared empty list so memoized messages see a stable `tools` prop. */
export const EMPTY_TOOLS: ToolInvocationProjection[] = []
```

把参数默认值 `tools = [],` 改为 `tools = EMPTY_TOOLS,`，把 `tools={message.id === lastAgentId ? tools : []}` 改为 `tools={message.id === lastAgentId ? tools : EMPTY_TOOLS}`。

- [ ] **Step 5: 抽出 PriorTurn**

创建 `components/agent/PriorTurn.tsx`：

```tsx
import { memo, useMemo } from 'react'
import type {
  AgentMessageProjection,
  PriorActivityTurnProjection,
  TaskOutputFileProjection,
  TaskProjection
} from '@action-driver/contracts'
import { ActivityTimeline } from '../ActivityTimeline'
import { ConversationMessages, EMPTY_TOOLS } from '../Conversation'
import type { ImageReader } from './ConversationImage'
import { TaskOutputFiles, type OutputFileReader } from './TaskOutputFiles'
import { activityOwnedText, dedupeAssistantText } from './activity-mirror'

/** The task fields an earlier turn's activity view needs; stable while a newer turn streams. */
export type TaskShell = Pick<TaskProjection, 'sessionId' | 'title' | 'model' | 'steps' | 'browser'>

type PriorTurnProps = {
  user: AgentMessageProjection
  replies: AgentMessageProjection[]
  activity: PriorActivityTurnProjection | undefined
  shell: TaskShell
  readImage?: ImageReader | undefined
  readOutputFile?: OutputFileReader | undefined
}

const NO_FILES: TaskOutputFileProjection[] = []

function PriorTurnView({ user, replies, activity, shell, readImage, readOutputFile }: PriorTurnProps) {
  const activityTask = useMemo<TaskProjection | null>(
    () =>
      activity
        ? {
            ...shell,
            id: activity.taskId,
            status: 'succeeded',
            activityDurationMs: activity.durationMs,
            activities: activity.activities,
            activityTimeline: activity.activityTimeline,
            // The turn's own messages decide whether its groups are anchored in the transcript.
            messages: replies,
            tools: activity.tools
          }
        : null,
    [activity, replies, shell]
  )
  const visibleReplies = useMemo(() => {
    const activityText = activityTask ? activityOwnedText(activityTask) : ''
    return replies.map((message) => dedupeAssistantText(message, activityText))
  }, [activityTask, replies])
  const users = useMemo(() => [user], [user])
  return (
    <>
      <ConversationMessages messages={users} readImage={readImage} />
      {activityTask ? <ActivityTimeline task={activityTask} /> : null}
      <ConversationMessages
        messages={visibleReplies}
        tools={activity?.tools ?? EMPTY_TOOLS}
        readImage={readImage}
      />
      <TaskOutputFiles files={activity?.outputFiles ?? NO_FILES} readOutputFile={readOutputFile} />
    </>
  )
}

function samePriorTurn(previous: PriorTurnProps, next: PriorTurnProps): boolean {
  return (
    previous.user === next.user &&
    previous.activity === next.activity &&
    previous.shell === next.shell &&
    previous.readImage === next.readImage &&
    previous.readOutputFile === next.readOutputFile &&
    previous.replies.length === next.replies.length &&
    previous.replies.every((message, index) => message === next.replies[index])
  )
}

/** An earlier turn of the session; it re-renders only when its own messages or activity change. */
export const PriorTurn = memo(PriorTurnView, samePriorTurn)
```

- [ ] **Step 6: TaskPage 使用 PriorTurn**

在 `pages/TaskPage.tsx` 中：

1. 导入改为：

```tsx
import { useMemo, useState } from 'react'
import { ConversationMessages, EMPTY_TOOLS, TaskHeader } from '../components/Conversation'
import { PriorTurn, type TaskShell } from '../components/agent/PriorTurn'
```

（删除 `Fragment` 导入；`activityOwnedText` 与 `dedupeAssistantText` 仍被当前轮使用，保留。）

2. 在 `const hasBrowser = task.browser !== null` 之后加入：

```tsx
  const shell = useMemo<TaskShell>(
    () => ({
      sessionId: task.sessionId,
      title: task.title,
      model: task.model,
      steps: task.steps,
      browser: task.browser
    }),
    [task.sessionId, task.title, task.model, task.steps, task.browser]
  )
```

3. 把 `{precedingTurns.map((turn) => { ... })}` 整段（从 `{precedingTurns.map((turn) => {` 到对应的 `})}`）替换为：

```tsx
              {precedingTurns.map((turn) => (
                <PriorTurn
                  key={turn.user.id}
                  user={turn.user}
                  replies={turn.replies}
                  activity={priorActivityByUserId.get(turn.user.id)}
                  shell={shell}
                  readImage={readImage}
                  readOutputFile={readOutputFile}
                />
              ))}
```

4. 把当前轮的 `tools={task.tools ?? []}` 改为 `tools={task.tools ?? EMPTY_TOOLS}`。

- [ ] **Step 7: 运行，确认通过**

Run: `pnpm vitest run apps/desktop/src/renderer/src/pages apps/desktop/src/renderer/src/components && pnpm --filter @action-driver/desktop typecheck`
Expected: 全部 PASS（含新的渲染次数测试与既有 `pages.test.tsx`、`ActivityTimeline.test.tsx`、`Conversation.test.tsx`），typecheck 无错误。

---

### Task 5: 收尾验证与记录

**Files:**
- Modify: `openspec/changes/optimize-task-streaming-render/tasks.md`

- [ ] **Step 1: 定向回归（用户执行）**

Run: `pnpm vitest run apps/desktop/src/renderer packages/activity-projection apps/agent-runtime/tests && pnpm typecheck`
Expected: 全部 PASS。

- [ ] **Step 2: 手动验证（用户执行）**

在 `pnpm dev` 中打开一个有 20 轮以上历史的会话继续提问，确认流式输出流畅、历史内容与活动组显示无回归、暂停/继续/接管与 Computer Use 确认按钮可用。

- [ ] **Step 3: 更新 OpenSpec 记录**

把 `tasks.md` 中已完成的任务勾选为 `[x]`，并在文末追加一段「验证记录」，写明 Step 1 的命令与通过/失败数量，以及 Step 5 中「单个 `setActiveTask` 覆盖 open/present/clear」这一实现细节。

- [ ] **Step 4: 提交前全量验证与提交（用户确认后执行）**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部 PASS（已知且与本次无关的失败写进提交信息）。

```bash
git add apps/desktop/package.json pnpm-lock.yaml \
  apps/desktop/src/renderer/src/services/stream-task-projection.ts \
  apps/desktop/src/renderer/src/services/stream-task-projection.test.ts \
  apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts \
  apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts \
  packages/activity-projection \
  apps/desktop/src/renderer/src/stores \
  apps/desktop/src/renderer/src/di/services-context.tsx \
  apps/desktop/src/renderer/src/services/computer-use-guidance.ts \
  apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.render-scope.test.tsx \
  apps/desktop/src/renderer/src/components/MarkdownContent.tsx \
  apps/desktop/src/renderer/src/components/Conversation.tsx \
  apps/desktop/src/renderer/src/components/agent \
  apps/desktop/src/renderer/src/pages/TaskPage.tsx apps/desktop/src/renderer/src/pages/TaskPage.render.test.tsx \
  openspec/changes/optimize-task-streaming-render docs/superpowers/plans/2026-09-26-optimize-task-streaming-render.md
git commit -m "perf(renderer): render only what changes while a task streams"
```

注意：工作区里还有此前 Computer Use 相关的未提交改动，不属于本次提交，`git add` 只列本次文件。
