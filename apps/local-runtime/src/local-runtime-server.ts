import type {
  SkillControlCommand,
  SkillExecutionEvent,
  SkillExecutionState,
  ToolInvocationProjection
} from '@action-driver/contracts'
import { type StreamServerEvent } from '@action-driver/runtime-contracts'
import { createRuntimeServices } from './composition-root'
import {
  buildRecentTaskProjection,
  buildTaskProjection,
  toOutputFileProjection
} from '@action-driver/agent-runtime/task-projection'
import type { MessageRepository, RuntimeAdapters, RuntimeTaskRecord } from '@action-driver/agent-runtime/ports'
import type { ComputerUseControlGate } from './computer-use/control-gate'
import {
  AppApprovalError,
  type AppApprovalBroker,
  type AppApprovalDecision
} from './computer-use/app-approval-broker'

export type LocalRuntimeServer = {
  close(): Promise<void>
  execute(command: string, input: unknown): Promise<unknown>
}

export function createLocalRuntimeServer(options: {
  adapters: RuntimeAdapters
  computerControl?: ComputerUseControlGate
  /** Persisted "always allow" application grants, managed from the settings page. */
  appApprovalStore?: { list(): string[]; remove(bundleId: string): void }
  appApprovals?: Pick<AppApprovalBroker, 'decide' | 'cancelTask'>
  messages: MessageRepository
  streamSnapshots?: {
    getTaskSnapshot(
      taskId: string
    ): Promise<Extract<StreamServerEvent, { type: 'response.snapshot' }> | null>
  }
  outputFiles?: (taskId: string) => Promise<
    Array<{
      fileId: string
      sessionId: string
      taskId: string
      name: string
      mimeType: string
      byteLength: number
    }>
  >
}): LocalRuntimeServer {
  const services = createRuntimeServices({ mode: 'local', adapters: options.adapters })
  const graphRunner = services.graphRunner
  const taskRepository = services.taskRepository
  const eventRepository = services.eventRepository
  const ids = services.idGenerator
  const active = new Map<string, Promise<void>>()
  const skillStates = new Map<string, SkillExecutionState>()

  async function publishTask(task: RuntimeTaskRecord, type: string): Promise<void> {
    await eventRepository.append({
      taskId: task.id,
      threadId: task.threadId,
      checkpointId: task.lastCheckpointId ?? `task:${task.id}`,
      eventKey: `${type}:${task.updatedAt}`,
      type,
      payload: { status: task.status },
      occurredAt: task.updatedAt
    })
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

  async function execute(command: string, rawInput: unknown): Promise<unknown> {
    if (command === 'task.submit') {
      const { goal, model, systemPrompt, skills } = rawInput as {
        goal: string
        model: RuntimeTaskRecord['model']
        systemPrompt?: string
        skills: []
      }
      if (skills.length !== 0) {
        throw new Error('INVALID_MESSAGE: Agent-only tasks require skills=[]')
      }
      const taskId = ids.next('task')
      const now = options.adapters.clock.now()
      const task: RuntimeTaskRecord = {
        id: taskId,
        threadId: taskId,
        sessionId: taskId,
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
      if (!task) return { task: null }
      const [sessionMessages, sessionTasks] = await Promise.all([
        options.messages.listBySession(task.sessionId),
        taskRepository.listBySession(task.sessionId)
      ])
      const currentIndex = sessionTasks.findIndex((turn) => turn.id === task.id)
      const visibleTaskIds = new Set(sessionTasks.slice(0, currentIndex + 1).map((turn) => turn.id))
      const projection = buildTaskProjection(
        task,
        sessionMessages.filter((message) => visibleTaskIds.has(message.taskId)),
        ((await options.outputFiles?.(task.id)) ?? []).map(toOutputFileProjection)
      )
      const priorActivityTurns = await Promise.all(
        sessionTasks.slice(0, currentIndex).map(async (turn) => {
          const userMessage = sessionMessages.find(
            (message) => message.taskId === turn.id && message.role === 'user'
          )
          if (!userMessage) return null
          const turnSnapshot = await options.streamSnapshots?.getTaskSnapshot(turn.id)
          const turnOutputs = ((await options.outputFiles?.(turn.id)) ?? []).map(
            toOutputFileProjection
          )
          const elapsed = Date.parse(turn.updatedAt) - Date.parse(turn.createdAt)
          const durationMs =
            turnSnapshot?.durationMs ??
            (turn.status !== 'running' && Number.isFinite(elapsed)
              ? Math.max(0, elapsed)
              : undefined)
          return {
            taskId: turn.id,
            userMessageId: userMessage.id,
            ...(durationMs === undefined ? {} : { durationMs }),
            activities: turnSnapshot?.activities ?? [],
            activityTimeline: turnSnapshot?.activityTimeline ?? [],
            tools: turnSnapshot?.tools?.map(toToolProjection) ?? [],
            ...(turnOutputs.length > 0 ? { outputFiles: turnOutputs } : {})
          }
        })
      )
      const snapshot = await options.streamSnapshots?.getTaskSnapshot(task.id)
      return {
        task: snapshot
          ? {
              ...projection,
              priorActivityTurns: priorActivityTurns.filter((turn) => turn !== null),
              activities: snapshot.activities ?? [],
              activityTimeline: snapshot.activityTimeline ?? [],
              streamCursor: snapshot.cursor,
              streamSequence: snapshot.sequence,
              pendingAppApproval: snapshot.pendingAppApproval ?? [],
              ...(task.status === 'running'
                ? {
                    streamRequestId: snapshot.requestId,
                    streamResponseId: snapshot.responseId
                  }
                : {}),
              tools: snapshot.tools?.map(toToolProjection) ?? [],
              ...(snapshot.preparingToolName
                ? { preparingToolName: snapshot.preparingToolName }
                : {}),
              ...(snapshot.durationMs === undefined
                ? {}
                : { activityDurationMs: snapshot.durationMs })
            }
          : {
              ...projection,
              priorActivityTurns: priorActivityTurns.filter((turn) => turn !== null)
            }
      }
    }
    if (command === 'task.list') {
      const requestedLimit = (rawInput as { limit?: number }).limit ?? 20
      const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      return {
        tasks: await Promise.all(
          (await taskRepository.listRecentSessions(limit)).map(async (task) => {
            const first = (await taskRepository.listBySession(task.sessionId))[0]
            return buildRecentTaskProjection(task, first?.goal ?? task.goal)
          })
        )
      }
    }
    if (command === 'task.interrupt') {
      const { taskId } = rawInput as { taskId: string }
      await options.appApprovals?.cancelTask(taskId)
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
    if (command === 'task.decide-app-approval') {
      const input = rawInput as Record<string, unknown>
      if (
        !input ||
        typeof input.taskId !== 'string' ||
        !input.taskId ||
        typeof input.requestId !== 'string' ||
        !input.requestId ||
        typeof input.decision !== 'string' ||
        !['once', 'session', 'always', 'deny'].includes(input.decision)
      ) {
        throw new AppApprovalError('INVALID_REQUEST', 'invalid application approval decision')
      }
      if (!options.appApprovals)
        throw new AppApprovalError('APPROVAL_STALE', 'no active application approval broker')
      await options.appApprovals.decide(
        input.taskId,
        input.requestId,
        input.decision as AppApprovalDecision
      )
      return { accepted: true }
    }
    if (command === 'skill.control') {
      const { invocationId, command: control } = rawInput as {
        invocationId: string
        command: SkillControlCommand
      }
      const state = control === 'pause' ? 'paused' : control === 'resume' ? 'running' : 'taken-over'
      skillStates.set(invocationId, state)
      const computerTask = options.computerControl ? await taskRepository.get(invocationId) : null
      if (computerTask && options.computerControl) {
        options.computerControl.set(invocationId, state)
        if (control === 'resume') {
          await active.get(invocationId)
          await saveStatus(invocationId, 'running')
          track(invocationId, runTask(invocationId, graphRunner.continue(invocationId)))
        } else {
          graphRunner.interrupt(invocationId)
          await saveStatus(invocationId, 'interrupted')
        }
      }
      const event: SkillExecutionEvent = {
        id: ids.next('skill-event'),
        invocationId,
        skillId: computerTask ? 'computer-use' : 'browser-use',
        state,
        occurredAt: new Date().toISOString()
      }
      return { event }
    }
    if (command === 'computer-use.always-allowed.list') {
      if (!options.appApprovalStore) throw new Error('COMPUTER_USE_UNAVAILABLE: no approval store')
      return { bundleIds: options.appApprovalStore.list() }
    }
    if (command === 'computer-use.always-allowed.remove') {
      if (!options.appApprovalStore) throw new Error('COMPUTER_USE_UNAVAILABLE: no approval store')
      const { bundleId } = rawInput as { bundleId?: unknown }
      if (typeof bundleId !== 'string' || bundleId.trim() === '')
        throw new Error('INVALID_MESSAGE: bundleId is required')
      options.appApprovalStore.remove(bundleId)
      return { bundleIds: options.appApprovalStore.list() }
    }
    throw new Error(`INVALID_MESSAGE: Unsupported Runtime command: ${command}`)
  }

  return {
    execute,
    async close() {
      for (const taskId of active.keys()) graphRunner.interrupt(taskId)
      await Promise.allSettled(active.values())
    }
  }
}

function toToolProjection(
  tool: NonNullable<Extract<StreamServerEvent, { type: 'response.snapshot' }>['tools']>[number]
): ToolInvocationProjection {
  return {
    callId: tool.callId,
    toolId: tool.toolId,
    modelName: tool.modelName,
    summary: tool.summary,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    argumentsHash: tool.argumentsHash,
    ...(tool.imageCount === undefined ? {} : { imageCount: tool.imageCount }),
    status: tool.status,
    durationMs: tool.durationMs,
    ...(tool.activityId === undefined ? {} : { activityId: tool.activityId }),
    ...(tool.resultSummary === undefined ? {} : { resultSummary: tool.resultSummary }),
    ...(tool.errorSummary === undefined ? {} : { errorSummary: tool.errorSummary }),
    ...(tool.rawInput === undefined ? {} : { rawInput: tool.rawInput }),
    ...(tool.rawOutput === undefined ? {} : { rawOutput: tool.rawOutput }),
    ...(tool.rawOutputTruncated === undefined
      ? {}
      : { rawOutputTruncated: tool.rawOutputTruncated }),
    ...(tool.details === undefined ? {} : { details: tool.details }),
    ...(tool.presentation === undefined ? {} : { presentation: tool.presentation })
  }
}
