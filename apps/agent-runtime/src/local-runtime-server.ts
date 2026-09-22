import type {
  SkillControlCommand,
  SkillExecutionEvent,
  SkillExecutionState,
  TaskProjection
} from '@actiondriver/contracts'
import {
  RuntimeRpcError,
  RuntimeServer,
  type RuntimeEvent,
  type RuntimeMessageEndpoint
} from '@actiondriver/runtime-contracts'
import { createRuntimeContainer, RUNTIME_TYPES } from './composition-root'
import { createLocalRuntimeAdapters } from './local-adapters'
import type {
  EventRepository,
  GraphRunner,
  IdGenerator,
  RuntimeTaskRecord,
  TaskRepository
} from './ports'

const RUNTIME_CAPABILITIES = [
  'task.submit',
  'task.get',
  'task.interrupt',
  'task.continue',
  'task.provide-input',
  'skill.control',
  'event.subscribe'
] as const

export type LocalRuntimeServer = {
  close(): Promise<void>
}

export function createLocalRuntimeServer(
  endpoint: RuntimeMessageEndpoint,
  databasePath: string
): LocalRuntimeServer {
  const serverRef: { current: RuntimeServer | null } = { current: null }

  function requireServer(): RuntimeServer {
    if (!serverRef.current) {
      throw new RuntimeRpcError(
        'RUNTIME_DISCONNECTED',
        'Local Agent Runtime is not ready for skill calls'
      )
    }
    return serverRef.current
  }

  const local = createLocalRuntimeAdapters(databasePath, (request) =>
    requireServer().requestSkill(request)
  )
  const container = createRuntimeContainer({ mode: 'local', adapters: local.adapters })
  const graphRunner = container.get<GraphRunner>(RUNTIME_TYPES.graphRunner)
  const taskRepository = container.get<TaskRepository>(RUNTIME_TYPES.taskRepository)
  const eventRepository = container.get<EventRepository>(RUNTIME_TYPES.eventRepository)
  const ids = container.get<IdGenerator>(RUNTIME_TYPES.idGenerator)
  const active = new Map<string, Promise<void>>()
  const skillStates = new Map<string, SkillExecutionState>()

  async function publishTask(task: RuntimeTaskRecord, type: string): Promise<void> {
    const record = await eventRepository.append({
      taskId: task.id,
      threadId: task.threadId,
      checkpointId: task.lastCheckpointId ?? `task:${task.id}`,
      eventKey: `${type}:${task.updatedAt}`,
      type,
      payload: { status: task.status },
      occurredAt: task.updatedAt
    })
    requireServer().publishEvent(toRuntimeEvent(record))
  }

  async function saveStatus(taskId: string, status: string): Promise<RuntimeTaskRecord | null> {
    const task = await taskRepository.get(taskId)
    if (!task) return null
    const updated = { ...task, status, updatedAt: new Date().toISOString() }
    await taskRepository.save(updated)
    await publishTask(updated, `task.${status}`)
    return updated
  }

  function track(taskId: string, operation: Promise<unknown>): void {
    const tracked = operation.then(() => undefined).finally(() => active.delete(taskId))
    active.set(taskId, tracked)
  }

  async function runTask(taskId: string, operation: Promise<{ status: string }>): Promise<void> {
    try {
      const result = await operation
      await saveStatus(taskId, result.status)
    } catch {
      await saveStatus(taskId, 'failed')
    }
  }

  const rpcServer = new RuntimeServer(endpoint, {
    runtimeVersion: '0.1.0',
    capabilities: RUNTIME_CAPABILITIES,
    async onCommand(command, rawInput) {
      if (command === 'task.submit') {
        const { goal, systemPrompt } = rawInput as { goal: string; systemPrompt?: string }
        const taskId = ids.next('task')
        const now = new Date().toISOString()
        const task: RuntimeTaskRecord = {
          id: taskId,
          threadId: taskId,
          goal,
          status: 'running',
          lastCheckpointId: null,
          createdAt: now,
          updatedAt: now
        }
        await taskRepository.save(task)
        await publishTask(task, 'task.submitted')
        track(
          taskId,
          runTask(
            taskId,
            graphRunner.run(
              systemPrompt === undefined ? { taskId, goal } : { taskId, goal, systemPrompt }
            )
          )
        )
        return { taskId }
      }
      if (command === 'task.get') {
        const task = await taskRepository.get((rawInput as { taskId: string }).taskId)
        return { task: task ? toTaskProjection(task) : null }
      }
      if (command === 'task.interrupt') {
        const { taskId } = rawInput as { taskId: string }
        graphRunner.interrupt(taskId)
        await saveStatus(taskId, 'interrupted')
        return { accepted: true }
      }
      if (command === 'task.continue') {
        const { taskId } = rawInput as { taskId: string }
        await saveStatus(taskId, 'running')
        track(taskId, runTask(taskId, graphRunner.continue(taskId)))
        return { accepted: true }
      }
      if (command === 'task.provide-input') {
        const { taskId, value } = rawInput as { taskId: string; value: unknown }
        await saveStatus(taskId, 'running')
        track(taskId, runTask(taskId, graphRunner.provideInput(taskId, value)))
        return { accepted: true }
      }
      if (command === 'skill.control') {
        const { invocationId, command: control } = rawInput as {
          invocationId: string
          command: SkillControlCommand
        }
        const state =
          control === 'pause' ? 'paused' : control === 'resume' ? 'running' : 'taken-over'
        skillStates.set(invocationId, state)
        const event: SkillExecutionEvent = {
          id: ids.next('skill-event'),
          invocationId,
          skillId: 'browser-use',
          state,
          occurredAt: new Date().toISOString()
        }
        return { event }
      }
      throw new RuntimeRpcError('INVALID_MESSAGE', `Unsupported Runtime command: ${command}`)
    },
    async readEvents(taskId, afterCursor) {
      return (await eventRepository.listAfter(afterCursor))
        .filter((event) => event.taskId === taskId)
        .map(toRuntimeEvent)
    }
  })
  serverRef.current = rpcServer

  return {
    async close() {
      for (const taskId of active.keys()) graphRunner.interrupt(taskId)
      await Promise.allSettled(active.values())
      local.close()
    }
  }
}

function toRuntimeEvent(event: {
  cursor: number
  taskId: string
  type: string
  payload: unknown
  occurredAt: string
}): RuntimeEvent {
  return {
    cursor: event.cursor,
    taskId: event.taskId,
    type: event.type,
    payload: event.payload,
    occurredAt: event.occurredAt
  }
}

function toTaskProjection(task: RuntimeTaskRecord): TaskProjection {
  const status = toProjectionStatus(task.status)
  return {
    id: task.id,
    title: task.goal,
    status,
    messages: [{ id: `message:${task.id}:user`, role: 'user', content: task.goal }],
    steps: [
      {
        id: `step:${task.id}:run`,
        title: '执行任务',
        detail:
          status === 'succeeded'
            ? '任务已完成'
            : status === 'failed'
              ? '任务执行失败'
              : 'Agent 正在执行',
        state: status === 'succeeded' ? 'success' : status === 'failed' ? 'failed' : 'current'
      }
    ],
    browser: {
      title: 'Browser Skill',
      url: 'about:blank',
      status,
      target: null
    }
  }
}

function toProjectionStatus(status: string): SkillExecutionState {
  if (status === 'completed') return 'succeeded'
  if (status === 'waiting-user') return 'waiting-user'
  if (status === 'interrupted') return 'paused'
  if (status === 'failed') return 'failed'
  return 'running'
}
