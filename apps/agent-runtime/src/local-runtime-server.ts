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
import type {
  EventRepository,
  GraphRunner,
  IdGenerator,
  MessageRepository,
  RuntimeAdapters,
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
  options: { adapters: RuntimeAdapters; messages: MessageRepository }
): LocalRuntimeServer {
  const serverRef: { current: RuntimeServer | null } = { current: null }
  function requireServer(): RuntimeServer {
    if (!serverRef.current) {
      throw new RuntimeRpcError('RUNTIME_DISCONNECTED', 'Local Agent Runtime is not ready')
    }
    return serverRef.current
  }
  const container = createRuntimeContainer({ mode: 'local', adapters: options.adapters })
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

  async function saveStatus(
    taskId: string,
    status: string,
    error: unknown | null = null
  ): Promise<RuntimeTaskRecord | null> {
    const task = await taskRepository.get(taskId)
    if (!task) return null
    const updated = { ...task, status, error, updatedAt: options.adapters.clock.now() }
    await taskRepository.save(updated)
    await publishTask(updated, `task.${status}`)
    return updated
  }

  function track(taskId: string, operation: Promise<unknown>): void {
    const tracked = operation.then(() => undefined).finally(() => active.delete(taskId))
    active.set(taskId, tracked)
  }

  async function runTask(
    taskId: string,
    operation: Promise<{ status: string; output: unknown; error: string | null }>
  ): Promise<void> {
    try {
      const result = await operation
      if (result.status === 'completed' && typeof result.output === 'string') {
        await options.messages.save({
          id: ids.next('message'),
          taskId,
          role: 'assistant',
          content: result.output,
          createdAt: options.adapters.clock.now()
        })
      }
      await saveStatus(
        taskId,
        result.status,
        result.error ? { code: 'MODEL_GATEWAY_ERROR', message: result.error } : null
      )
    } catch (error) {
      await saveStatus(taskId, 'failed', {
        code: 'RUNTIME_ERROR',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const rpcServer = new RuntimeServer(endpoint, {
    runtimeVersion: '0.1.0',
    capabilities: RUNTIME_CAPABILITIES,
    async onCommand(command, rawInput) {
      if (command === 'task.submit') {
        const { goal, model, systemPrompt, skills } = rawInput as {
          goal: string
          model: RuntimeTaskRecord['model']
          systemPrompt?: string
          skills: []
        }
        if (skills.length !== 0) {
          throw new RuntimeRpcError('INVALID_MESSAGE', 'Agent-only tasks require skills=[]')
        }
        const taskId = ids.next('task')
        const now = options.adapters.clock.now()
        const task: RuntimeTaskRecord = {
          id: taskId,
          threadId: taskId,
          goal,
          model,
          status: 'running',
          error: null,
          lastCheckpointId: null,
          createdAt: now,
          updatedAt: now
        }
        await taskRepository.save(task)
        await options.messages.save({
          id: ids.next('message'),
          taskId,
          role: 'user',
          content: goal,
          createdAt: now
        })
        await publishTask(task, 'task.submitted')
        track(
          taskId,
          runTask(
            taskId,
            graphRunner.run({
              taskId,
              goal,
              model,
              ...(systemPrompt === undefined ? {} : { systemPrompt }),
              skills
            })
          )
        )
        return { taskId }
      }
      if (command === 'task.get') {
        const task = await taskRepository.get((rawInput as { taskId: string }).taskId)
        return {
          task: task ? toTaskProjection(task, await options.messages.listByTask(task.id)) : null
        }
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

function toTaskProjection(
  task: RuntimeTaskRecord,
  messages: Awaited<ReturnType<MessageRepository['listByTask']>>
): TaskProjection {
  const status = toProjectionStatus(task.status)
  return {
    id: task.id,
    title: task.goal,
    status,
    messages: messages.flatMap((message) => {
      if (typeof message.content !== 'string') return []
      if (message.role !== 'user' && message.role !== 'assistant') return []
      return [
        {
          id: message.id,
          role: message.role === 'assistant' ? ('agent' as const) : ('user' as const),
          content: message.content
        }
      ]
    }),
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
    browser: null
  }
}

function toProjectionStatus(status: string): SkillExecutionState {
  if (status === 'completed') return 'succeeded'
  if (status === 'waiting-user') return 'waiting-user'
  if (status === 'interrupted') return 'paused'
  if (status === 'failed') return 'failed'
  return 'running'
}
