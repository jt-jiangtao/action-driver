import type {
  ModelLogQuery,
  SkillControlCommand,
  SkillExecutionEvent,
  SkillExecutionState
} from '@actiondriver/contracts'
import {
  RuntimeRpcError,
  RuntimeServer,
  type RuntimeEvent,
  type RuntimeMessageEndpoint
} from '@actiondriver/runtime-contracts'
import { createRuntimeContainer, RUNTIME_TYPES } from './composition-root'
import {
  buildModelLogSessionProjection,
  buildRecentTaskProjection,
  buildTaskProjection
} from './model-log-projection'
import type {
  EventRepository,
  GraphRunner,
  IdGenerator,
  MessageRepository,
  ModelCallRepository,
  RuntimeAdapters,
  RuntimeTaskRecord,
  TaskRepository
} from './ports'

const RUNTIME_CAPABILITIES = [
  'task.submit',
  'task.get',
  'task.list',
  'model-log.list',
  'model-log.get',
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
  options: {
    adapters: RuntimeAdapters
    messages: MessageRepository
    modelCalls: ModelCallRepository
  }
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

  async function projectModelLog(task: RuntimeTaskRecord) {
    const [messages, modelCalls] = await Promise.all([
      options.messages.listByTask(task.id),
      options.modelCalls.listByTask(task.id)
    ])
    return buildModelLogSessionProjection(task, messages, modelCalls)
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
          task: task ? buildTaskProjection(task, await options.messages.listByTask(task.id)) : null
        }
      }
      if (command === 'task.list') {
        const requestedLimit = (rawInput as { limit?: number }).limit ?? 20
        const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
        return {
          tasks: (await taskRepository.listRecent(limit)).map(buildRecentTaskProjection)
        }
      }
      if (command === 'model-log.list') {
        const query = rawInput as ModelLogQuery
        const tasks = await taskRepository.listRecent(100)
        const sessions = await Promise.all(tasks.map(projectModelLog))
        return { sessions: sessions.filter((session) => matchesModelLog(session, query)) }
      }
      if (command === 'model-log.get') {
        const { taskId } = rawInput as { taskId: string }
        const task = await taskRepository.get(taskId)
        return { session: task ? await projectModelLog(task) : null }
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

function matchesModelLog(
  session: ReturnType<typeof buildModelLogSessionProjection>,
  query: ModelLogQuery
): boolean {
  if (query.status && session.status !== query.status) return false
  const search = query.query?.trim().toLowerCase()
  if (!search) return true
  const task = session.tasks[0]
  return [
    session.id,
    session.name,
    task?.model.connectionId,
    task?.model.modelId,
    ...(task?.calls.flatMap((call) => [call.requestId, call.correlationId]) ?? [])
  ].some((value) => value?.toLowerCase().includes(search))
}
