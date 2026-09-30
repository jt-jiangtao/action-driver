import type { ToolDetails, ToolPresentation } from '@action-driver/plugin-contracts'
import type { AgentMessageProjection } from './message-content'
import type { BrowserSkillProjection, SkillExecutionState } from './skill'

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
    imageGenerationSlotCount(tool) > 0 && !IMAGE_GENERATION_PENDING_STATUSES.includes(tool.status)
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

export type SessionCatalogProjection = RecentTaskProjection & {
  pinned: boolean
  archivedAt: string | null
}

export type SessionCatalogPageProjection = {
  items: SessionCatalogProjection[]
  nextCursor: string | null
}

/** A deliverable registered for one task; the bytes stay in the Runtime store. */
export type TaskOutputFileProjection = {
  fileId: string
  sessionId: string
  taskId: string
  /** Unified resource reference; the legacy identifier still resolves for old clients. */
  uri?: string
  name: string
  mimeType: string
  byteLength: number
  kind: 'document' | 'image'
}
