import type { ToolDetails, ToolPresentation } from '@actiondriver/plugin-contracts'
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
  sessionId?: string
  surface?: 'embedded' | 'external-chrome'
  activeTabId?: string | null
  tabs?: Array<{ id: string; title: string; url: string; loading: boolean;
    canGoBack: boolean; canGoForward: boolean }>
  error?: string | null
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

/**
 * Monotonic position of a block inside the assistant transcript, mirroring the
 * ordinal Codex assigns to every streamed item. A block keeps its order for
 * life: nothing is reordered when the turn finishes.
 */
export type OrderedPart = { order?: number | undefined }

export type MessageContentPart = OrderedPart &
  (
    | { kind: 'text'; text: string }
    /** One tool activity group; anchors it between streamed text and images. */
    | { kind: 'activity'; activityId: string }
    | { kind: 'image-batch'; callId: string; imageCount: number }
    | {
        kind: 'image'
        asset: ImageAssetRef
        generation?: { callId: string; index: number } | undefined
      }
    | { kind: 'document'; file: DocumentFileRef }
  )

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

export function normalizeAssistantParts(
  parts: readonly MessageContentPart[]
): MessageContentPart[] {
  const normalized: MessageContentPart[] = []
  const seenBatches = new Set<string>()
  const seenImages = new Set<string>()
  const seenDocuments = new Set<string>()
  for (const part of sortPartsByOrder(parts)) {
    if (part.kind === 'text') {
      if (!part.text) continue
      const previous = normalized.at(-1)
      if (previous?.kind === 'text') previous.text += part.text
      else normalized.push({ ...part })
      continue
    }
    if (part.kind === 'activity') {
      if (currentActivityId(normalized) === part.activityId) continue
      normalized.push({ ...part })
      continue
    }
    if (part.kind === 'image-batch') {
      if (seenBatches.has(part.callId)) continue
      seenBatches.add(part.callId)
      normalized.push({ ...part })
      continue
    }
    if (part.kind === 'document') {
      if (seenDocuments.has(part.file.fileId)) continue
      seenDocuments.add(part.file.fileId)
      normalized.push({ ...part })
      continue
    }
    const key = part.generation
      ? `${part.generation.callId}:${part.generation.index}`
      : part.asset.assetId
    if (seenImages.has(key)) continue
    seenImages.add(key)
    normalized.push({ ...part })
  }
  return normalized
}

/**
 * Last order a block claims, including the image slots an image batch reserves
 * up front so a batch keeps the position it was created in even when the model
 * keeps streaming text before the images land.
 */
export function partOrder(part: MessageContentPart): number {
  const order = part.order ?? 0
  return part.kind === 'image-batch' ? order + part.imageCount : order
}

/** Next free order for a new block in the transcript. */
export function nextPartOrder(parts: readonly MessageContentPart[]): number {
  let maximum = 0
  for (const part of parts) maximum = Math.max(maximum, partOrder(part))
  return maximum + 1
}

/**
 * Parts in transcript order. Blocks without an order (transcripts stored before
 * the order contract) keep the position they were persisted in.
 */
export function sortPartsByOrder(parts: readonly MessageContentPart[]): MessageContentPart[] {
  if (!parts.some((part) => part.order !== undefined)) return [...parts]
  return parts
    .map((part, index) => ({ part, index }))
    .sort((left, right) => {
      const leftOrder = left.part.order ?? 0
      const rightOrder = right.part.order ?? 0
      return leftOrder - rightOrder || left.index - right.index
    })
    .map((entry) => entry.part)
}

/** Places a block at its order, which is how streamed parts stay ordered. */
export function insertPartByOrder(
  parts: MessageContentPart[],
  part: MessageContentPart
): MessageContentPart[] {
  const order = part.order
  if (order === undefined) {
    parts.push(part)
    return parts
  }
  // Parts stored before the order contract have no order and stay where they
  // are, ahead of everything the stream adds afterwards.
  const index = parts.findIndex((candidate) => (candidate.order ?? 0) > order)
  if (index < 0) parts.push(part)
  else parts.splice(index, 0, part)
  return parts
}

/** The tool group the transcript currently sits in, if any. */
export function currentActivityId(parts: readonly MessageContentPart[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!
    if (part.kind === 'activity') return part.activityId
  }
  return null
}

/**
 * Anchors a tool group where it starts in the stream. Repeats collapse into the
 * group already in progress, so one call keeps a single anchor no matter how
 * many tool events (proposed, queued, running, completed) arrive for it.
 */
export function appendActivityAnchor(
  parts: MessageContentPart[],
  activityId: string
): MessageContentPart[] {
  if (!activityId || currentActivityId(parts) === activityId) return parts
  insertPartByOrder(parts, { kind: 'activity', activityId, order: nextPartOrder(parts) })
  return parts
}

export interface ExecutionStepProjection {
  id: string
  title: string
  detail: string
  state: 'success' | 'current' | 'waiting' | 'failed'
}

export interface ToolInvocationProjection {
  details?: ToolDetails
  presentation?: ToolPresentation
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

/**
 * Id of the built-in image generation tool. The plugin catalog owns the
 * definition; every consumer (renderer, Runtime) reads the id from here so the
 * gallery, the activity area and the task page cannot drift apart.
 */
export const IMAGE_GENERATION_TOOL_ID = 'tools/local/image-generation/generate'

/** Statuses before the tool has produced its first gallery slot. */
const IMAGE_GENERATION_PENDING_STATUSES: readonly string[] = [
  'proposed',
  'waiting_approval',
  'queued'
]
/** Statuses that mean the image generator is still working on this call. */
const IMAGE_GENERATION_ACTIVE_STATUSES: readonly string[] = [
  ...IMAGE_GENERATION_PENDING_STATUSES,
  'running'
]

/** True when the tool is the built-in image generator. */
export function isImageGenerationTool(tool: { toolId: string }): boolean {
  return tool.toolId === IMAGE_GENERATION_TOOL_ID
}

/** True for the built-in image generator id, with or without an `@version` grant suffix. */
export function isImageGenerationToolId(toolId: string): boolean {
  return toolId === IMAGE_GENERATION_TOOL_ID || toolId.startsWith(`${IMAGE_GENERATION_TOOL_ID}@`)
}

/** How many gallery slots this call reserved, regardless of its current status. */
export function imageGenerationSlotCount(tool: ToolInvocationProjection): number {
  return isImageGenerationTool(tool) ? (tool.imageCount ?? 0) : 0
}

/** True once the call owns visible slots, so placeholders and results can render. */
export function hasImageGenerationGallery(tool: ToolInvocationProjection): boolean {
  return (
    imageGenerationSlotCount(tool) > 0 &&
    !IMAGE_GENERATION_PENDING_STATUSES.includes(tool.status)
  )
}

/** True while the call is queued or running, so progress indicators stay hidden. */
export function isImageGenerationRunning(tool: ToolInvocationProjection): boolean {
  return isImageGenerationTool(tool) && IMAGE_GENERATION_ACTIVE_STATUSES.includes(tool.status)
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

export type AppApprovalDecision = 'once' | 'session' | 'always' | 'deny'
export type AppApprovalRequest = {
  requestId: string
  taskId: string
  sessionId: string
  target: {
    bundleId: string
    displayName: string
    appPath: string
    risk: 'high' | 'low'
    warningSubtitle?: string | undefined
  }
  allowPersistentApproval: boolean
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
  pendingAppApproval?: AppApprovalRequest[]
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
  provideInput(taskId: string, value: unknown): Promise<void>
  decideAppApproval(taskId: string, requestId: string, decision: AppApprovalDecision): Promise<void>
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
