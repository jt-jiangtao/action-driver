import type {
  AppApprovalDecision,
  AgentCommandService,
  AgentGoalRequest,
  AgentSessionRepository,
  BrowserSkillProjection,
  SkillCapability,
  SkillControlCommand,
  SkillExecutionEvent,
  SkillGateway,
  SkillId,
  SkillInvocation,
  TaskProjection
} from '@actiondriver/contracts'
import { AgentServiceError, isSerializableContract } from '@actiondriver/contracts'
import type { AgentControlApi } from './runtime-agent-http-api'
import { StreamTaskProjection } from './stream-task-projection'
import type { RendererStreamClient, RuntimeStreamListener } from './renderer-stream-client'
import type { DesktopApi } from '../../../preload/desktop-api'
import type { BrowserSessionEvent } from '../../../shared/browser-session-contract'

export class DesktopAgentAdapter implements AgentCommandService, AgentSessionRepository {
  /**
   * Last emitted snapshot per task. The stream projection owns the state of a
   * running task; this map only caches what was last handed to listeners so
   * `getTask` can answer without a round trip.
   */
  private readonly tasks = new Map<string, TaskProjection>()
  private readonly listeners = new Set<(task: TaskProjection) => void>()
  private readonly streamProjections = new Map<string, StreamTaskProjection>()
  /**
   * The projection created before the runtime named its task. Stream events for
   * an unknown task buffer inside that projection, so the adapter never needs a
   * second buffer of its own.
   */
  private pendingProjection: StreamTaskProjection | null = null
  private readonly browserSnapshots = new Map<string, BrowserSessionEvent['snapshot']>()

  constructor(
    private readonly api: AgentControlApi,
    private readonly streamClient: Pick<
      RendererStreamClient,
      'create' | 'cancel' | 'subscribe' | 'watchExisting'
    >,
    private readonly getSystemPrompt?: () => Promise<string>,
    browserSession?: DesktopApi['browserSession']
  ) {
    this.streamClient.subscribe((event) => this.handleStreamEvent(event))
    browserSession?.subscribe((event) => {
      if (event.snapshot) this.browserSnapshots.set(event.taskId, structuredClone(event.snapshot))
      else this.browserSnapshots.delete(event.taskId)
      const task = this.tasks.get(event.taskId)
      if (task) {
        const base = event.snapshot ? task : this.streamProjections.get(event.taskId)?.snapshot() ?? task
        const updated = event.snapshot ? this.withBrowser(base) : { ...base, browser: null }
        this.tasks.set(event.taskId, updated)
        this.emit(updated)
      }
    })
  }

  private withBrowser(task: TaskProjection): TaskProjection {
    const snapshot = this.browserSnapshots.get(task.id)
    if (!snapshot) return task
    const tab = snapshot.tabs.find((item) => item.id === snapshot.activeTabId)
    const browser: BrowserSkillProjection = {
      title: tab?.title ?? '', url: tab?.url ?? '', status: snapshot.status,
      target: null, sessionId: snapshot.sessionId, surface: snapshot.surface,
      activeTabId: snapshot.activeTabId, tabs: snapshot.tabs, error: snapshot.error
    }
    return { ...task, browser }
  }

  async submitGoal(request: AgentGoalRequest): Promise<TaskProjection> {
    let projection: StreamTaskProjection | null = null
    try {
      const systemPrompt = await this.getSystemPrompt?.()
      projection = new StreamTaskProjection({
        onChange: (task) => {
          const updated = this.withBrowser(task)
          this.tasks.set(task.id, updated)
          this.emit(updated)
        }
      })
      // Created before `create` resolves: everything the runtime streams for
      // this task is applied in order once the task snapshot is attached.
      this.pendingProjection = projection
      const accepted = await this.streamClient.create({
        ...request,
        ...(systemPrompt === undefined ? {} : { systemPrompt })
      })
      this.streamProjections.set(accepted.taskId, projection)
      if (this.pendingProjection === projection) this.pendingProjection = null

      const task = await this.api.get(accepted.taskId)
      if (!task) {
        throw new AgentServiceError(
          'invalid-response',
          `Runtime returned no task for ${accepted.taskId}`
        )
      }
      const mapped = mapTaskProjection(task)
      projection.attach(mapped)
      const snapshot = this.withBrowser(projection.snapshot() ?? mapped)
      this.tasks.set(accepted.taskId, snapshot)
      this.emit(snapshot)
      return structuredClone(snapshot)
    } catch (error) {
      if (this.pendingProjection === projection) this.pendingProjection = null
      throw mapAgentError(error)
    }
  }

  async interrupt(taskId: string): Promise<void> {
    try {
      if (this.streamProjections.has(taskId)) await this.streamClient.cancel(taskId)
      else await this.api.interrupt(taskId)
    } catch (error) {
      throw mapAgentError(error)
    }
  }

  async continueTask(taskId: string): Promise<void> {
    try {
      await this.api.continue(taskId)
    } catch (error) {
      throw mapAgentError(error)
    }
  }

  async provideInput(taskId: string, value: unknown): Promise<void> {
    try {
      await this.api.provideInput(taskId, value)
    } catch (error) {
      throw mapAgentError(error)
    }
  }

  async decideAppApproval(
    taskId: string,
    requestId: string,
    decision: AppApprovalDecision
  ): Promise<void> {
    try {
      await this.api.decideAppApproval(taskId, requestId, decision)
    } catch (error) {
      throw mapAgentError(error)
    }
  }

  getTask(taskId: string): TaskProjection | null {
    const task = this.tasks.get(taskId)
    return task ?? null
  }

  async restoreTaskStream(task: TaskProjection): Promise<void> {
    if (
      task.status !== 'running' ||
      !task.streamRequestId ||
      !task.streamResponseId ||
      this.streamProjections.has(task.id)
    )
      return
    const projection = new StreamTaskProjection({
      onChange: (updated) => {
        const projected = this.withBrowser(updated)
        this.tasks.set(updated.id, projected)
        this.emit(projected)
      }
    })
    projection.attach(task)
    this.streamProjections.set(task.id, projection)
    this.tasks.set(task.id, this.withBrowser(structuredClone(task)))
    try {
      await this.streamClient.watchExisting({
        requestId: task.streamRequestId,
        responseId: task.streamResponseId,
        taskId: task.id,
        cursor: task.streamCursor ?? 0,
        sequence: task.streamSequence ?? -1
      })
    } catch (error) {
      this.streamProjections.delete(task.id)
      throw mapAgentError(error)
    }
  }

  subscribe(listener: (task: TaskProjection) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private handleStreamEvent(event: Parameters<RuntimeStreamListener>[0]): void {
    if (!('taskId' in event)) return
    const projection = this.streamProjections.get(event.taskId)
    if (projection) {
      projection.apply(event)
      return
    }
    const pending = this.pendingProjection
    if (!pending) return
    pending.apply(event)
    if (event.type === 'request.accepted') {
      this.streamProjections.set(event.taskId, pending)
      this.pendingProjection = null
    }
  }

  private emit(task: TaskProjection): void {
    this.listeners.forEach((listener) => listener(task))
  }
}

export class DesktopSkillGateway implements SkillGateway {
  private readonly listeners = new Set<(event: SkillExecutionEvent) => void>()

  constructor(private readonly api: AgentControlApi) {}

  invoke(invocation: SkillInvocation): Promise<SkillExecutionEvent> {
    void invocation
    return Promise.reject(
      new AgentServiceError(
        'unavailable',
        'Renderer cannot invoke Skill providers directly; submit an Agent goal instead'
      )
    )
  }

  pause(invocationId: string): Promise<SkillExecutionEvent> {
    return this.control(invocationId, 'pause')
  }

  resume(invocationId: string): Promise<SkillExecutionEvent> {
    return this.control(invocationId, 'resume')
  }

  takeOver(invocationId: string): Promise<SkillExecutionEvent> {
    return this.control(invocationId, 'take-over')
  }

  getCapability<TSkillId extends SkillId>(skillId: TSkillId): SkillCapability<TSkillId> {
    return {
      skillId,
      invoke: () =>
        Promise.reject(
          new AgentServiceError(
            'unavailable',
            'Renderer cannot invoke Skill providers directly; submit an Agent goal instead'
          )
        ),
      transition: (invocationId, command) => this.control(invocationId, command)
    }
  }

  subscribe(listener: (event: SkillExecutionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async control(
    invocationId: string,
    command: SkillControlCommand
  ): Promise<SkillExecutionEvent> {
    try {
      const event = mapSkillEvent(await this.api.controlSkill(invocationId, command))
      this.listeners.forEach((listener) => listener(structuredClone(event)))
      return structuredClone(event)
    } catch (error) {
      throw mapAgentError(error)
    }
  }
}

const ERROR_CODE_MAP = {
  HANDSHAKE_REQUIRED: 'unavailable',
  HANDSHAKE_REJECTED: 'incompatible-runtime',
  DEADLINE_EXCEEDED: 'timeout',
  INVALID_MESSAGE: 'invalid-response',
  RUNTIME_DISCONNECTED: 'unavailable',
  REMOTE_ERROR: 'runtime-error',
  LATE_RESPONSE: 'invalid-response'
} as const

function mapAgentError(error: unknown): AgentServiceError {
  if (error instanceof AgentServiceError) return error
  if (isRecord(error)) {
    const code =
      typeof error.code === 'string'
        ? ERROR_CODE_MAP[error.code as keyof typeof ERROR_CODE_MAP]
        : undefined
    const message =
      typeof error.message === 'string' ? error.message : 'Agent Runtime request failed'
    return new AgentServiceError(code ?? 'runtime-error', message, error.details)
  }
  return new AgentServiceError(
    'runtime-error',
    error instanceof Error ? error.message : String(error)
  )
}

function mapTaskProjection(value: unknown): TaskProjection {
  if (!isSerializableContract(value) || !isTaskProjection(value)) {
    throw new AgentServiceError('invalid-response', 'Runtime returned an invalid task projection')
  }
  return structuredClone(value)
}

function mapSkillEvent(value: unknown): SkillExecutionEvent {
  if (!isSerializableContract(value) || !isRecord(value)) {
    throw new AgentServiceError('invalid-response', 'Runtime returned an invalid Skill event')
  }
  if (
    !isString(value.id) ||
    !isString(value.invocationId) ||
    !isString(value.skillId) ||
    !isSkillState(value.state) ||
    !isString(value.occurredAt)
  ) {
    throw new AgentServiceError('invalid-response', 'Runtime returned an invalid Skill event')
  }
  return structuredClone({
    id: value.id,
    invocationId: value.invocationId,
    skillId: value.skillId,
    state: value.state,
    occurredAt: value.occurredAt
  })
}

function isTaskProjection(value: unknown): value is TaskProjection {
  if (!isRecord(value)) return false
  if (!isString(value.id) || !isString(value.title) || !isSkillState(value.status)) return false
  if (!Array.isArray(value.messages) || !value.messages.every(isMessage)) return false
  if (!Array.isArray(value.steps) || !value.steps.every(isStep)) return false
  return value.browser === null || isBrowserProjection(value.browser)
}

function isMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    (value.role === 'user' || value.role === 'agent') &&
    isString(value.content)
  )
}

function isStep(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isString(value.detail) &&
    ['success', 'current', 'waiting', 'failed'].includes(String(value.state))
  )
}

function isBrowserProjection(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    isString(value.title) &&
    isString(value.url) &&
    isSkillState(value.status) &&
    (value.target === null || isBrowserTarget(value.target))
  )
}

function isBrowserTarget(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.label) &&
    [value.x, value.y, value.width, value.height].every(
      (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)
    )
  )
}

function isSkillState(value: unknown): value is TaskProjection['status'] {
  return [
    'queued',
    'running',
    'paused',
    'waiting-user',
    'taken-over',
    'succeeded',
    'failed'
  ].includes(String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
