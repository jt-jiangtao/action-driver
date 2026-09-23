import type { ModelRef } from '@actiondriver/contracts'
import type { ModelUsage } from '@actiondriver/model-connections'
import type {
  ModelInputMessage,
  ModelTerminal,
  ProviderToolCall
} from '@actiondriver/model-connections'
import type { ToolDefinition } from '@actiondriver/runtime-contracts'

export type RuntimeMessage = ModelInputMessage

export type ModelSkillDescription = {
  skillId: string
  description: string
}

export type ModelRequest = {
  taskId: string
  requestId: string
  model: ModelRef
  messages: RuntimeMessage[]
  tools?: ToolDefinition[]
  skills: ModelSkillDescription[]
  parameters: {
    temperature?: number
    maxTokens?: number
  }
}

export type ModelResult =
  | { kind: 'finish'; content: string }
  | { kind: 'invoke-skill'; skillId: string; input: unknown }
  | { kind: 'tool-calls'; calls: ProviderToolCall[] }

export type ModelGatewayEvent =
  | { kind: 'content'; delta: string }
  | {
      kind: 'end'
      result?: ModelTerminal
      content: string
      finishReason: string | null
      usage: ModelUsage | null
    }

export interface ModelGateway {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>
  /** Transitional compatibility for deterministic Skill fixtures; local production gateways provide it. */
  stream?(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelGatewayEvent>
}

export type ModelEventObserver = (event: ModelGatewayEvent) => void | Promise<void>

export type SkillProviderResult = {
  ok: true
  providerId: string
  input: unknown
  /**
   * Signals that the Agent must wait for the user before continuing. Skill providers report this
   * through the Runtime Skill boundary; the graph routes to `awaitUser` and checkpoints state.
   */
  needsUser?: boolean
}

export interface SkillProvider {
  readonly providerId: string
  readonly providerVersion: string
  readonly skillId: string
  readonly contractVersion: number
  execute(
    request: { invocationId: string; input: unknown },
    signal?: AbortSignal
  ): Promise<SkillProviderResult>
  cancel?(invocationId: string): Promise<void>
}

export interface SkillRegistry {
  resolve(skillId: string, contractVersion: number): SkillProvider
}

export type RuntimeTaskRecord = {
  id: string
  threadId: string
  sessionId: string
  goal: string
  model: ModelRef
  status: string
  error: unknown | null
  lastCheckpointId: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskRepository {
  get(taskId: string): Promise<RuntimeTaskRecord | null>
  getLatestBySession(sessionId: string): Promise<RuntimeTaskRecord | null>
  listBySession(sessionId: string): Promise<RuntimeTaskRecord[]>
  listRecent(limit: number): Promise<RuntimeTaskRecord[]>
  listRecentSessions(limit: number): Promise<RuntimeTaskRecord[]>
  save(task: RuntimeTaskRecord): Promise<void>
}

export type PersistedModelCall = {
  id: string
  taskId: string
  requestId: string
  correlationId: string
  model: ModelRef
  status: 'running' | 'completed' | 'failed'
  request: unknown
  response: unknown | null
  error: unknown | null
  startedAt: string
  completedAt: string | null
}

export interface ModelCallRepository {
  save(call: PersistedModelCall): Promise<void>
  listByTask(taskId: string): Promise<PersistedModelCall[]>
}

export type PersistedToolInvocation = {
  id: string
  providerCallId: string
  taskId: string
  toolId: string
  toolVersion: number
  argumentsHash: string
  decision: 'allow' | 'require_approval' | 'deny'
  status:
    | 'proposed'
    | 'waiting_approval'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
  input: unknown
  output: unknown | null
  error: unknown | null
  createdAt: string
  updatedAt: string
}

export interface ToolInvocationRepository {
  save(invocation: PersistedToolInvocation): Promise<void>
  listByTask(taskId: string): Promise<PersistedToolInvocation[]>
}

export interface ToolInvocationPersistence {
  commitToolInvocationWithEvent(
    invocation: PersistedToolInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord>
}

export type PersistedMessage = {
  id: string
  taskId: string
  role: string
  content: unknown
  createdAt: string
}

export type PersistedStreamRequest = {
  requestId: string
  idempotencyKey: string
  sessionId: string
  taskId: string
  responseId: string
  streamId: string
  messageId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  lastSequence: number
  createdAt: string
  updatedAt: string
}

export interface StreamRequestRepository {
  getByRequestId(requestId: string): Promise<PersistedStreamRequest | null>
  getByIdempotencyKey(idempotencyKey: string): Promise<PersistedStreamRequest | null>
}

export interface StreamSessionRepository {
  readonly tasks: Pick<TaskRepository, 'get' | 'getLatestBySession' | 'listBySession'>
  readonly messages: Pick<MessageRepository, 'listByTask' | 'listBySession'>
  readonly events: Pick<EventRepository, 'listAfter'>
  readonly streamRequests: StreamRequestRepository
  createStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    userMessage: PersistedMessage
    assistantMessage: PersistedMessage
    acceptedEvent: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<{ created: boolean; request: PersistedStreamRequest }>
  commitAssistantContentWithEvent(
    request: PersistedStreamRequest,
    message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord>
  finishStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    assistantMessage: PersistedMessage
    event: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<RuntimeEventRecord>
}

export interface MessageRepository {
  save(message: PersistedMessage): Promise<void>
  listByTask(taskId: string): Promise<PersistedMessage[]>
  listBySession(sessionId: string): Promise<PersistedMessage[]>
}

export type RuntimeEventRecord = {
  cursor: number
  taskId: string
  threadId: string
  checkpointId: string
  eventKey: string
  type: string
  payload: unknown
  occurredAt: string
  eventId?: string | null
  requestId?: string | null
  responseId?: string | null
  streamId?: string | null
  messageId?: string | null
  sequence?: number | null
}

export interface EventRepository {
  append(event: Omit<RuntimeEventRecord, 'cursor'>): Promise<RuntimeEventRecord>
  listAfter(cursor: number): Promise<RuntimeEventRecord[]>
}

export interface CheckpointStore {
  get(threadId: string): Promise<unknown | null>
  put(threadId: string, checkpoint: unknown): Promise<void>
}

export interface GraphRunner {
  run(
    request: {
      taskId: string
      goal: string
      model: ModelRef
      messages?: RuntimeMessage[]
      systemPrompt?: string
      skills?: ModelSkillDescription[]
      toolGrants?: string[]
    },
    signal?: AbortSignal,
    observer?: ModelEventObserver
  ): Promise<AgentGraphResult>
  interrupt(taskId: string): boolean
  continue(taskId: string): Promise<AgentGraphResult>
  provideInput(taskId: string, value: unknown): Promise<AgentGraphResult>
}

export type AgentGraphResult = {
  taskId: string
  threadId: string
  status: 'completed' | 'waiting-user' | 'interrupted' | 'failed'
  output: unknown
  error: string | null
  trace: string[]
}

export interface Clock {
  now(): string
}

export interface IdGenerator {
  next(prefix: string): string
}

export interface RuntimeAdapters {
  graphRunner: GraphRunner
  checkpointStore: CheckpointStore
  taskRepository: TaskRepository
  eventRepository: EventRepository
  modelGateway: ModelGateway
  skillRegistry: SkillRegistry
  clock: Clock
  idGenerator: IdGenerator
}
