export type SkillExecutionState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting-user'
  | 'taken-over'
  | 'succeeded'
  | 'failed'

export const SKILL_IDS = {
  browser: 'browser-use',
  computer: 'computer-use'
} as const

export type SkillId = (typeof SKILL_IDS)[keyof typeof SKILL_IDS]

export interface SkillExecutionEvent {
  id: string
  invocationId: string
  skillId: string
  state: SkillExecutionState
  occurredAt: string
}

export interface BrowserTargetProjection {
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserSkillProjection {
  title: string
  url: string
  status: SkillExecutionState
  target: BrowserTargetProjection | null
}

export interface AgentMessageProjection {
  id: string
  role: 'user' | 'agent'
  content: string
  parts?: MessageContentPart[]
}

export type ImageAssetRef = {
  assetId: string
  sessionId: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteLength: number
  source: 'upload' | 'generated'
}

export type MessageContentPart =
  | { kind: 'text'; text: string }
  | { kind: 'image-batch'; callId: string; imageCount: number }
  | { kind: 'image'; asset: ImageAssetRef; generation?: { callId: string; index: number } | undefined }
  | { kind: 'document'; file: DocumentFileRef }

/** Metadata of an uploaded document; bytes never travel through messages. */
export type DocumentFileRef = {
  fileId: string
  sessionId: string
  taskId: string
  name: string
  mimeType: string
  byteLength: number
}

export type MessageContent = { text: string } | { parts: MessageContentPart[] }

export function readMessageContentParts(content: MessageContent): MessageContentPart[] {
  return 'parts' in content ? content.parts : [{ kind: 'text', text: content.text }]
}

export function normalizeAssistantParts(parts: readonly MessageContentPart[]): MessageContentPart[] {
  const normalized: MessageContentPart[] = []
  const seenBatches = new Set<string>()
  const seenImages = new Set<string>()
  const seenDocuments = new Set<string>()
  for (const part of parts) {
    if (part.kind === 'text') {
      if (!part.text) continue
      const previous = normalized.at(-1)
      if (previous?.kind === 'text') previous.text += part.text
      else normalized.push({ kind: 'text', text: part.text })
      continue
    }
    if (part.kind === 'image-batch') {
      if (seenBatches.has(part.callId)) continue
      seenBatches.add(part.callId)
      normalized.push(part)
      continue
    }
    if (part.kind === 'document') {
      if (seenDocuments.has(part.file.fileId)) continue
      seenDocuments.add(part.file.fileId)
      normalized.push(part)
      continue
    }
    const key = part.generation
      ? `${part.generation.callId}:${part.generation.index}`
      : part.asset.assetId
    if (seenImages.has(key)) continue
    seenImages.add(key)
    normalized.push(part)
  }
  return normalized
}

export interface ExecutionStepProjection {
  id: string
  title: string
  detail: string
  state: 'success' | 'current' | 'waiting' | 'failed'
}

export interface ToolInvocationProjection {
  callId: string
  toolId: string
  modelName: string
  summary: string
  title?: string
  argumentsHash: string
  activityId?: string | null
  rawInput?: string
  rawOutput?: string
  rawOutputTruncated?: boolean
  durationMs?: number
  resultSummary?: string
  errorSummary?: string
  imageCount?: number
  status:
    | 'proposed'
    | 'waiting_approval'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'unknown'
}

export interface ActivityTextProjection {
  id: string
  kind: 'text'
  content: string
  phase?: 'pending' | 'process' | 'final' | undefined
}

export interface ActivityToolProjection {
  id: string
  kind: 'tool'
  callId: string
}

export interface ActivityProjection {
  activityId: string
  title: string
  titleRevision: number
  status: 'running' | 'completed'
  items: Array<ActivityTextProjection | ActivityToolProjection>
}

export type TaskTimelineProjectionItem =
  | { id: string; kind: 'activity'; activityId: string }
  | { id: string; kind: 'tool'; callId: string }
  | {
      id: string
      kind: 'text'
      content: string
      phase?: 'pending' | 'process' | 'final' | undefined
    }

export interface PriorActivityTurnProjection {
  taskId: string
  userMessageId: string
  durationMs?: number
  tools: ToolInvocationProjection[]
  activities: ActivityProjection[]
  activityTimeline: TaskTimelineProjectionItem[]
  /** Deliverables registered by this earlier turn; kept per turn so history survives follow-ups. */
  outputFiles?: TaskOutputFileProjection[]
}

export interface TaskProjection {
  id: string
  sessionId: string
  title: string
  status: SkillExecutionState
  model: ModelRef
  messages: AgentMessageProjection[]
  steps: ExecutionStepProjection[]
  tools?: ToolInvocationProjection[]
  activities?: ActivityProjection[]
  activityTimeline?: TaskTimelineProjectionItem[]
  activityStartedAt?: string
  activityDurationMs?: number | undefined
  preparingToolName?: string
  outputFiles?: TaskOutputFileProjection[]
  streamRequestId?: string
  streamResponseId?: string
  priorActivityTurns?: PriorActivityTurnProjection[]
  streamCursor?: number
  streamSequence?: number
  browser: BrowserSkillProjection | null
}

export type ModelRef = {
  connectionId: string
  modelId: string
}

export type AgentGoalRequest =
  | {
      goal: string
      model: ModelRef
      sessionId?: never
      imageAssetIds?: string[]
      inputFileIds?: string[]
    }
  | {
      goal: string
      sessionId: string
      model?: never
      imageAssetIds?: string[]
      inputFileIds?: string[]
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

/** A deliverable registered for one task; the bytes stay in the Runtime store. */
export type TaskOutputFileProjection = {
  fileId: string
  sessionId: string
  taskId: string
  name: string
  mimeType: string
  byteLength: number
  kind: 'document' | 'image'
}

interface BaseSkillInvocation<TSkillId extends SkillId, TInput> {
  id: string
  taskId: string
  skillId: TSkillId
  input: TInput
}

export type BrowserSkillInput =
  | { action: 'open-url'; url: string }
  | { action: 'click'; nodeHandle: string }
  | { action: 'scroll'; deltaX: number; deltaY: number }
  | { action: 'type'; nodeHandle: string; text: string }

export type ComputerUseSkillInput =
  | { action: 'activate-app'; bundleId: string }
  | { action: 'click'; x: number; y: number }
  | { action: 'type'; text: string }

export type BrowserSkillInvocation = BaseSkillInvocation<
  typeof SKILL_IDS.browser,
  BrowserSkillInput
>
export type ComputerUseSkillInvocation = BaseSkillInvocation<
  typeof SKILL_IDS.computer,
  ComputerUseSkillInput
>
export type SkillInvocation = BrowserSkillInvocation | ComputerUseSkillInvocation

export type SkillControlCommand = 'pause' | 'resume' | 'take-over'

export interface SkillCapability<TSkillId extends SkillId> {
  readonly skillId: TSkillId
  invoke(invocation: Extract<SkillInvocation, { skillId: TSkillId }>): Promise<SkillExecutionEvent>
  transition(invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent>
}

export interface AgentSessionRepository {
  getTask(taskId: string): TaskProjection | null
  subscribe(listener: (task: TaskProjection) => void): () => void
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

export type AgentServiceErrorCode =
  | 'unavailable'
  | 'incompatible-runtime'
  | 'timeout'
  | 'invalid-response'
  | 'runtime-error'

export class AgentServiceError extends Error {
  constructor(
    readonly code: AgentServiceErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'AgentServiceError'
  }
}

export interface SkillGateway {
  invoke(invocation: SkillInvocation): Promise<SkillExecutionEvent>
  pause(invocationId: string): Promise<SkillExecutionEvent>
  resume(invocationId: string): Promise<SkillExecutionEvent>
  takeOver(invocationId: string): Promise<SkillExecutionEvent>
  getCapability<TSkillId extends SkillId>(skillId: TSkillId): SkillCapability<TSkillId>
  subscribe(listener: (event: SkillExecutionEvent) => void): () => void
}

export function isSerializableContract(value: unknown): boolean {
  const seen = new WeakSet<object>()

  const visit = (candidate: unknown): boolean => {
    if (candidate === null) return true
    if (['string', 'number', 'boolean'].includes(typeof candidate)) return true
    if (
      typeof candidate === 'undefined' ||
      typeof candidate === 'function' ||
      typeof candidate === 'symbol'
    ) {
      return false
    }
    if (typeof candidate !== 'object') return false
    if (seen.has(candidate)) return false
    seen.add(candidate)
    if (Array.isArray(candidate)) return candidate.every(visit)
    if (Object.getPrototypeOf(candidate) !== Object.prototype) return false
    return Object.values(candidate).every(visit)
  }

  return visit(value)
}
