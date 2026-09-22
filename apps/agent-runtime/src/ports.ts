import type { ModelRef } from '@actiondriver/contracts'

export type RuntimeMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ModelSkillDescription = {
  skillId: string
  description: string
}

export type ModelRequest = {
  taskId: string
  requestId: string
  model: ModelRef
  messages: RuntimeMessage[]
  skills: ModelSkillDescription[]
  parameters: {
    temperature?: number
    maxTokens?: number
  }
}

export type ModelResult =
  | { kind: 'finish'; content: string }
  | { kind: 'invoke-skill'; skillId: string; input: unknown }

export interface ModelGateway {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>
}

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
  listRecent(limit: number): Promise<RuntimeTaskRecord[]>
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

export type PersistedMessage = {
  id: string
  taskId: string
  role: string
  content: unknown
  createdAt: string
}

export interface MessageRepository {
  save(message: PersistedMessage): Promise<void>
  listByTask(taskId: string): Promise<PersistedMessage[]>
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
      systemPrompt?: string
      skills?: ModelSkillDescription[]
    },
    signal?: AbortSignal
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
