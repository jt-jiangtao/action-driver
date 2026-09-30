import type { DocumentFileRef, ImageAssetRef } from '@action-driver/contracts'
import { blockRegion, type BlockKind, type BlockRegion, type RolloutLine, type ToolStatus } from './model'

export type RolloutBlockState = {
  blockId: string
  kind: BlockKind
  order: number
  slots: number
  status: 'pending' | 'streaming' | 'completed'
  region: BlockRegion
  firstSeq: number
  lastSeq: number
  text: string
  phase: 'pending' | 'process' | 'final' | null
  callId: string | null
  imageCount: number | null
  asset: ImageAssetRef | null
  generation: { callId: string; index: number } | null
  file: DocumentFileRef | null
  title: string | null
  titleRevision: number
}

export type RolloutToolState = {
  callId: string
  blockId: string
  itemIndex: number
  toolId: string
  modelName: string
  status: ToolStatus
  summary: string
  title: string | null
  argumentsHash: string
  imageCount: number | null
  durationMs: number
  resultSummary: string | null
  errorSummary: string | null
  rawInput: string | null
  input: unknown
  output: unknown
  presentation: unknown
  rawOutput: string | null
  rawOutputTruncated: boolean
  firstSeq: number
  lastSeq: number
}

export type RolloutTurnState = {
  turnId: string
  taskId: string
  goal: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  error: unknown | null
  finalContent: string
  /** Visible blocks in `order`, which is the only ordering in the turn. */
  blocks: RolloutBlockState[]
  tools: Map<string, RolloutToolState>
  /** Plain stored messages (user submissions and agent-mode replies). */
  messages: RolloutMessageState[]
}

export type RolloutMessageState = {
  messageId: string
  role: 'user' | 'assistant' | 'tool'
  content: unknown
  at: string
}

export type RolloutSessionState = {
  sessionId: string | null
  threadId: string | null
  model: { connectionId: string; modelId: string } | null
  cursor: number
  turns: RolloutTurnState[]
}

export function emptyRolloutState(): RolloutSessionState {
  return { sessionId: null, threadId: null, model: null, cursor: -1, turns: [] }
}

/** Next free slot: every block keeps the slots it reserved, so gaps never reopen. */
export function nextOrder(blocks: readonly Pick<RolloutBlockState, 'order' | 'slots'>[]): number {
  let next = 1
  for (const block of blocks) next = Math.max(next, block.order + block.slots)
  return next
}

export function nextOrderForTurn(state: RolloutSessionState, turnId: string): number {
  const turn = state.turns.find((candidate) => candidate.turnId === turnId)
  return turn ? nextOrder(turn.blocks) : 1
}

/** Applies one record to the accumulated state. Live streaming and replay share this. */
export function applyRolloutLine(state: RolloutSessionState, line: RolloutLine): RolloutSessionState {
  state.cursor = Math.max(state.cursor, line.seq)
  if (line.t === 'session_meta') {
    state.sessionId = line.sessionId
    state.threadId = line.threadId
    state.model = line.model
    return state
  }
  if (line.t === 'turn_begin') {
    if (!state.turns.some((turn) => turn.turnId === line.turnId)) {
      state.turns.push({
        turnId: line.turnId,
        taskId: line.taskId,
        goal: line.goal,
        status: 'running',
        startedAt: line.ts,
        completedAt: null,
        durationMs: null,
        error: null,
        finalContent: '',
        blocks: [],
        tools: new Map(),
        messages: []
      })
    }
    return state
  }
  const turn = state.turns.find((candidate) => candidate.turnId === line.turnId)
  if (!turn) return state
  if (line.t === 'message') {
    const existing = turn.messages.find((message) => message.messageId === line.messageId)
    if (existing) existing.content = line.content
    else
      turn.messages.push({
        messageId: line.messageId,
        role: line.role,
        content: line.content,
        at: line.ts
      })
    return state
  }
  if (line.t === 'turn_end') {
    turn.status = line.status
    turn.completedAt = line.ts
    turn.durationMs = line.durationMs ?? null
    turn.error = line.error ?? null
    if (line.content !== undefined) turn.finalContent = line.content
    return state
  }
  if (line.t === 'event') return state
  if (line.t === 'activity_text') return state
  if (line.t === 'block') {
    const existing = turn.blocks.find((block) => block.blockId === line.blockId)
    const region = blockRegion(line)
    if (!existing) {
      turn.blocks.push({
        blockId: line.blockId,
        kind: line.kind,
        order: line.order,
        slots: line.slots,
        status: line.status,
        region,
        firstSeq: line.seq,
        lastSeq: line.seq,
        text: line.text ?? line.delta ?? '',
        phase: line.phase ?? null,
        callId: line.callId ?? null,
        imageCount: line.imageCount ?? null,
        asset: line.asset ?? null,
        generation: line.generation ?? null,
        file: line.file ?? null,
        title: line.title ?? null,
        titleRevision: line.titleRevision ?? 0
      })
      sortBlocks(turn.blocks)
      return state
    }
    existing.status = line.status
    existing.lastSeq = line.seq
    // Text records are increments: the fold appends them in seq order, so replay
    // rebuilds the same text the live stream produced.
    if (line.delta !== undefined) existing.text += line.delta
    if (line.phase !== undefined) existing.phase = line.phase
    if (line.callId !== undefined) existing.callId = line.callId
    if (line.imageCount !== undefined) existing.imageCount = line.imageCount
    if (line.asset !== undefined) existing.asset = line.asset
    if (line.generation !== undefined) existing.generation = line.generation
    if (line.file !== undefined) existing.file = line.file
    if (line.title !== undefined) existing.title = line.title
    if (line.titleRevision !== undefined)
      existing.titleRevision = Math.max(existing.titleRevision, line.titleRevision)
    return state
  }
  const previous = turn.tools.get(line.callId)
  turn.tools.set(line.callId, {
    callId: line.callId,
    blockId: line.blockId,
    itemIndex: line.itemIndex,
    toolId: line.toolId,
    modelName: line.modelName,
    status: line.status,
    summary: line.summary ?? previous?.summary ?? '',
    title: line.title ?? previous?.title ?? null,
    argumentsHash: line.argumentsHash ?? previous?.argumentsHash ?? '',
    imageCount: line.imageCount ?? previous?.imageCount ?? null,
    durationMs: line.durationMs ?? previous?.durationMs ?? 0,
    resultSummary: line.resultSummary ?? previous?.resultSummary ?? null,
    errorSummary: line.errorSummary ?? previous?.errorSummary ?? null,
    rawInput: line.rawInput ?? previous?.rawInput ?? null,
    input: line.input ?? previous?.input ?? {},
    output: line.output ?? previous?.output ?? null,
    presentation: line.presentation ?? previous?.presentation ?? null,
    rawOutput: line.rawOutput ?? previous?.rawOutput ?? null,
    rawOutputTruncated: line.rawOutputTruncated ?? previous?.rawOutputTruncated ?? false,
    firstSeq: previous?.firstSeq ?? line.seq,
    lastSeq: line.seq
  })
  return state
}

/** Folds a whole log (or a prefix of it) into session state. */
export function foldRollout(lines: Iterable<RolloutLine>): RolloutSessionState {
  let state = emptyRolloutState()
  for (const line of lines) state = applyRolloutLine(state, line)
  return state
}

export function toolsInOrder(turn: RolloutTurnState): RolloutToolState[] {
  return [...turn.tools.values()].sort(
    (left, right) =>
      left.itemIndex - right.itemIndex ||
      left.firstSeq - right.firstSeq ||
      left.callId.localeCompare(right.callId)
  )
}

function sortBlocks(blocks: RolloutBlockState[]): void {
  blocks.sort((left, right) => left.order - right.order || left.firstSeq - right.firstSeq)
}
