import type { Logger } from 'pino'
import { encodeInteractionPayload } from './interaction-payload'

export type InteractionTransport = 'ipc' | 'http' | 'websocket'
export type InteractionState = 'pending' | 'completed' | 'incomplete'
export type InteractionKind = 'request-response' | 'one-way-event'
export type InteractionPayloadKind = 'json' | 'text' | 'binary-metadata' | 'empty'
export type InteractionDirection = 'renderer->service' | 'service->renderer' | 'service->skill'

export type InteractionPayloadInput =
  | { kind: 'json'; value: unknown; contentType?: string; secretPaths?: string[] }
  | { kind: 'text'; text: string; contentType?: string }
  | { kind: 'binary-metadata'; byteLength: number; contentType?: string; summary?: string }
  | { kind: 'empty' }

export type InteractionPayloadView = {
  kind: InteractionPayloadKind
  contentType: string | null
  byteLength: number
  truncated: boolean
  text: string | null
  unavailableReason: 'expired' | 'missing' | 'unsafe-to-persist' | null
}

export type InteractionLogSummary = {
  id: string
  correlationId: string
  time: number
  completedAt: number | null
  transport: InteractionTransport
  direction: InteractionDirection
  kind: InteractionKind
  state: InteractionState
  operation: string
  requestId?: string
  taskId?: string
  level: number
  levelLabel: string
  outcome?: string
  status?: number
  durationMs?: number
  requestBytes: number
  responseBytes: number
  requestAvailable: boolean
  responseAvailable: boolean
  requestTruncated: boolean
  responseTruncated: boolean
  requestUnavailableReason?: InteractionPayloadView['unavailableReason']
  responseUnavailableReason?: InteractionPayloadView['unavailableReason']
  errorCode?: string
  errorMessage?: string
}

export type InteractionLogDetail = InteractionLogSummary & {
  request: InteractionPayloadView | null
  response: InteractionPayloadView | null
}

export type InteractionLogQuery = {
  level?: string
  direction?: string
  transports?: InteractionTransport[]
  search?: string
  cursor?: string | null
  before?: Pick<InteractionLogSummary, 'time' | 'id'>
  limit?: number
}

export type InteractionLogPage = {
  records: InteractionLogSummary[]
  nextCursor: string | null
}

export type InteractionBeginRecord = Omit<
  InteractionLogSummary,
  | 'completedAt'
  | 'state'
  | 'kind'
  | 'level'
  | 'levelLabel'
  | 'requestBytes'
  | 'responseBytes'
  | 'requestAvailable'
  | 'responseAvailable'
  | 'requestTruncated'
  | 'responseTruncated'
> & {
  request: InteractionPayloadView
}

export type InteractionCompletionRecord = {
  completedAt: number
  outcome: string
  status?: number
  response: InteractionPayloadView | null
  error?: { code: string; message: string }
}

export type InteractionOneWayRecord = Omit<InteractionBeginRecord, 'request'> & {
  payload: InteractionPayloadView
}

export type InteractionPruneResult = { removedEvents: number; removedBytes: number }

export interface InteractionLogStore {
  begin(event: InteractionBeginRecord): Promise<void>
  complete(eventId: string, completion: InteractionCompletionRecord): Promise<void>
  recordOneWay(event: InteractionOneWayRecord): Promise<void>
  recoverIncomplete(before: number): Promise<number>
  list(query: InteractionLogQuery): Promise<InteractionLogPage>
  getDetail(eventId: string): Promise<InteractionLogDetail | null>
  prune(now: number): Promise<InteractionPruneResult>
}

export type InteractionLogIdFactory = {
  eventId(): string
  correlationId(): string
}

export type InteractionRecorderStart = {
  transport: InteractionTransport
  direction: InteractionDirection
  operation: string
  requestId?: string
  taskId?: string
  request: InteractionPayloadInput
  startedAt?: number
}

export type InteractionRecorderResult = {
  outcome: string
  status?: number
  response?: InteractionPayloadInput
  error?: { code: string; message: string }
  secretValues?: string[]
}

export type InteractionRecorderOneWay = Omit<InteractionRecorderStart, 'request'> & {
  payload: InteractionPayloadInput
}

export interface InteractionLogRecorder {
  start(
    input: InteractionRecorderStart
  ): Promise<(result: InteractionRecorderResult) => Promise<void>>
  recordOneWay(input: InteractionRecorderOneWay): Promise<void>
}

export function createInteractionLogRecorder(options: {
  store: InteractionLogStore
  ids: InteractionLogIdFactory
  clock?: () => number
  logger?: Logger
}): InteractionLogRecorder {
  const clock = options.clock ?? Date.now
  return {
    async start(input) {
      const time = input.startedAt ?? clock()
      const event: InteractionBeginRecord = {
        id: options.ids.eventId(),
        correlationId: options.ids.correlationId(),
        time,
        transport: input.transport,
        direction: input.direction,
        operation: input.operation,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        request: encodeInteractionPayload(input.request)
      }
      await options.store.begin(event)
      return async (result) => {
        const completedAt = clock()
        const safeError = result.error
          ? {
              code: result.error.code,
              message: redactKnownSecrets(result.error.message, result.secretValues ?? []) as string
            }
          : undefined
        await options.store.complete(event.id, {
          completedAt,
          outcome: result.outcome,
          ...(result.status === undefined ? {} : { status: result.status }),
          response: result.response
            ? encodeInteractionPayload(result.response, undefined, result.secretValues)
            : null,
          ...(safeError ? { error: safeError } : {})
        })
        const record = {
          transport: event.transport,
          direction: event.direction,
          operation: event.operation,
          correlationId: event.correlationId,
          outcome: result.outcome,
          durationMs: completedAt - event.time,
          ...(result.status === undefined ? {} : { status: result.status }),
          ...(safeError ? { errorCode: safeError.code, errorMessage: safeError.message } : {})
        }
        options.logger?.[safeError ? 'error' : 'info'](
          record,
          `${event.direction} ${event.operation} ${result.outcome}`
        )
      }
    },
    async recordOneWay(input) {
      await options.store.recordOneWay({
        id: options.ids.eventId(),
        correlationId: options.ids.correlationId(),
        time: clock(),
        transport: input.transport,
        direction: input.direction,
        operation: input.operation,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        payload: encodeInteractionPayload(input.payload)
      })
    }
  }
}

export class MemoryInteractionLogStore implements InteractionLogStore {
  private readonly records = new Map<string, InteractionLogDetail>()

  async begin(event: InteractionBeginRecord): Promise<void> {
    this.records.set(event.id, {
      ...summaryBase(event),
      completedAt: null,
      kind: 'request-response',
      state: 'pending',
      level: 30,
      levelLabel: 'info',
      requestBytes: event.request.byteLength,
      responseBytes: 0,
      requestAvailable: event.request.kind !== 'empty' && event.request.unavailableReason === null,
      responseAvailable: false,
      requestTruncated: event.request.truncated,
      responseTruncated: false,
      ...(event.request.unavailableReason
        ? { requestUnavailableReason: event.request.unavailableReason }
        : {}),
      request: event.request,
      response: null
    })
  }

  async complete(eventId: string, completion: InteractionCompletionRecord): Promise<void> {
    const current = this.records.get(eventId)
    if (!current) throw new Error(`INTERACTION_NOT_FOUND: ${eventId}`)
    if (current.state === 'completed') return
    const response = completion.response
    this.records.set(eventId, {
      ...current,
      completedAt: completion.completedAt,
      state: 'completed',
      outcome: completion.outcome,
      ...(completion.status === undefined ? {} : { status: completion.status }),
      durationMs: completion.completedAt - current.time,
      responseBytes: response?.byteLength ?? 0,
      responseAvailable: Boolean(
        response && response.kind !== 'empty' && response.unavailableReason === null
      ),
      responseTruncated: response?.truncated ?? false,
      ...(response?.unavailableReason
        ? { responseUnavailableReason: response.unavailableReason }
        : {}),
      response,
      ...(completion.error
        ? {
            level: 50,
            levelLabel: 'error',
            errorCode: completion.error.code,
            errorMessage: completion.error.message
          }
        : {})
    })
  }

  async recordOneWay(event: InteractionOneWayRecord): Promise<void> {
    this.records.set(event.id, {
      ...summaryBase(event),
      completedAt: event.time,
      kind: 'one-way-event',
      state: 'completed',
      level: 30,
      levelLabel: 'info',
      outcome: 'sent',
      durationMs: 0,
      requestBytes: event.payload.byteLength,
      responseBytes: 0,
      requestAvailable: event.payload.kind !== 'empty' && event.payload.unavailableReason === null,
      responseAvailable: false,
      requestTruncated: event.payload.truncated,
      responseTruncated: false,
      ...(event.payload.unavailableReason
        ? { requestUnavailableReason: event.payload.unavailableReason }
        : {}),
      request: event.payload,
      response: null
    })
  }

  async recoverIncomplete(before: number): Promise<number> {
    let recovered = 0
    for (const [id, record] of this.records) {
      if (record.state !== 'pending' || record.time >= before) continue
      this.records.set(id, { ...record, state: 'incomplete', outcome: 'incomplete' })
      recovered += 1
    }
    return recovered
  }

  async list(query: InteractionLogQuery): Promise<InteractionLogPage> {
    const limit = Math.max(1, query.limit ?? 200)
    const needle = query.search?.trim().toLowerCase()
    const filtered = [...this.records.values()]
      .filter(
        (record) =>
          !query.before ||
          record.time < query.before.time ||
          (record.time === query.before.time && record.id < query.before.id)
      )
      .filter((record) => !query.transports?.length || query.transports.includes(record.transport))
      .filter((record) => !query.direction || record.direction === query.direction)
      .filter((record) => !query.level || record.levelLabel === query.level)
      .filter(
        (record) =>
          !needle ||
          [
            record.operation,
            record.outcome,
            record.errorCode,
            record.taskId,
            record.requestId,
            record.correlationId
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle))
      )
      .sort((left, right) => right.time - left.time || right.id.localeCompare(left.id))
    const offset = decodeCursor(query.cursor)
    const records = filtered.slice(offset, offset + limit).map(withoutPayloads)
    const nextOffset = offset + records.length
    return {
      records,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null
    }
  }

  async getDetail(eventId: string): Promise<InteractionLogDetail | null> {
    const record = this.records.get(eventId)
    return record ? structuredClone(record) : null
  }

  async prune(now: number): Promise<InteractionPruneResult> {
    void now
    return { removedEvents: 0, removedBytes: 0 }
  }
}

function summaryBase(
  event: InteractionBeginRecord | InteractionOneWayRecord
): Pick<
  InteractionLogSummary,
  'id' | 'correlationId' | 'time' | 'transport' | 'direction' | 'operation'
> &
  Partial<Pick<InteractionLogSummary, 'requestId' | 'taskId'>> {
  return {
    id: event.id,
    correlationId: event.correlationId,
    time: event.time,
    transport: event.transport,
    direction: event.direction,
    operation: event.operation,
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.taskId ? { taskId: event.taskId } : {})
  }
}

function withoutPayloads(record: InteractionLogDetail): InteractionLogSummary {
  const { request, response, ...summary } = record
  void request
  void response
  return structuredClone(summary)
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0
  const parsed = Number(cursor)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export async function startBestEffortInteraction(
  interactions: InteractionLogRecorder | undefined,
  input: InteractionRecorderStart,
  onError?: (error: unknown) => void
): Promise<((result: InteractionRecorderResult) => Promise<void>) | null> {
  if (!interactions) return null
  try {
    const finish = await interactions.start(input)
    return async (result) => {
      try {
        await finish(result)
      } catch (error) {
        reportInteractionFailure(onError, error)
      }
    }
  } catch (error) {
    reportInteractionFailure(onError, error)
    return null
  }
}

function reportInteractionFailure(
  onError: ((error: unknown) => void) | undefined,
  error: unknown
): void {
  try {
    onError?.(error)
  } catch {
    // Observability must never change the business result, including if its diagnostic sink fails.
  }
}

function redactKnownSecrets(value: unknown, secrets: string[]): unknown {
  const usable = secrets.filter((secret) => secret.length > 0)
  if (usable.length === 0) return value
  if (typeof value === 'string') {
    return usable.reduce((text, secret) => text.split(secret).join('[redacted]'), value)
  }
  if (Array.isArray(value)) return value.map((entry) => redactKnownSecrets(entry, usable))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactKnownSecrets(entry, usable)])
    )
  }
  return value
}
