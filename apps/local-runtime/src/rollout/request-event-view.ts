import type { PersistedStreamRequest, RuntimeEventRecord } from '@action-driver/agent-runtime/ports'
import type { RolloutSessionState } from './fold'
import { deriveRolloutEvents, deriveRolloutEventsForLine } from './event-bridge'
import type { RolloutLine } from './model'

type View = {
  requestId: string
  sessionId: string
  identity: string
  source: readonly RolloutLine[]
  lastSeq: number
  bytes: number
  events: RuntimeEventRecord[]
}

const DEFAULT_MAX_REQUESTS = 8
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024

/** Disposable in-memory projection of request events. The rollout remains authoritative. */
export class RequestEventViews {
  private readonly views = new Map<string, View>()
  private readonly deferred = new Map<
    string,
    { source: readonly RolloutLine[]; identity: string; lastSeq: number }
  >()
  private readonly oversized = new Map<
    string,
    { source: readonly RolloutLine[]; identity: string; lastSeq: number }
  >()
  private bytes = 0
  private readonly maxRequests: number
  private readonly maxBytes: number

  constructor(options: { maxRequests?: number; maxBytes?: number } = {}) {
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  listAfter(
    request: PersistedStreamRequest,
    lines: readonly RolloutLine[],
    cursor: number,
    limit: number,
    deferFirstRead = false
  ): RuntimeEventRecord[] {
    if (limit <= 0) return []
    const lastSeq = lines.at(-1)?.seq ?? -1
    const identity = requestIdentity(request)
    const oversized = this.oversized.get(request.requestId)
    const isOversized =
      oversized?.source === lines && oversized.identity === identity && oversized.lastSeq <= lastSeq
    if (oversized && !isOversized) this.oversized.delete(request.requestId)
    let view = this.views.get(request.requestId)
    if (view && (view.identity !== identity || view.source !== lines || view.lastSeq !== lastSeq)) {
      this.delete(request.requestId)
      view = undefined
    }
    if (!view) {
      if (isOversized || this.maxRequests <= 0) {
        const events = deriveRolloutEvents(lines, request)
        const start = firstAfter(events, cursor)
        return events.slice(start, start + limit)
      }
      if (deferFirstRead) {
        const seen = this.deferred.get(request.requestId)
        if (
          !seen ||
          seen.source !== lines ||
          seen.identity !== identity ||
          seen.lastSeq !== lastSeq
        ) {
          this.deferred.delete(request.requestId)
          this.deferred.set(request.requestId, { source: lines, identity, lastSeq })
          if (this.deferred.size > this.maxRequests)
            this.deferred.delete(this.deferred.keys().next().value!)
          const events = deriveRolloutEvents(lines, request)
          return events.filter((event) => event.cursor > cursor).slice(0, limit)
        }
        this.deferred.delete(request.requestId)
      }
      const events = deriveRolloutEvents(lines, request)
      const bytes = serializedBytesUpTo(events, this.maxBytes)
      if (bytes === null) {
        this.oversized.delete(request.requestId)
        this.oversized.set(request.requestId, { source: lines, identity, lastSeq })
        if (this.oversized.size > this.maxRequests)
          this.oversized.delete(this.oversized.keys().next().value!)
        const start = firstAfter(events, cursor)
        return events.slice(start, start + limit)
      }
      view = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        identity,
        source: lines,
        lastSeq,
        bytes,
        events
      }
      this.add(view)
    } else {
      this.views.delete(request.requestId)
      this.views.set(request.requestId, view)
    }
    const start = firstAfter(view.events, cursor)
    // A repository read must not expose the view's mutable event wrappers to callers.
    return view.events.slice(start, start + limit).map((event) => ({ ...event }))
  }

  /** Called after folding a persisted line; a gap discards the derived view. */
  append(
    line: RolloutLine,
    stateAfter: RolloutSessionState,
    requestFor: (requestId: string) => PersistedStreamRequest | null
  ): void {
    for (const view of this.views.values()) {
      if (view.sessionId !== stateAfter.sessionId) continue
      const request = requestFor(view.requestId)
      if (!request || requestIdentity(request) !== view.identity || line.seq !== view.lastSeq + 1) {
        this.delete(view.requestId)
        continue
      }
      const added = deriveRolloutEventsForLine(line, request, stateAfter, view.events.length)
      const bytes = added.reduce(
        (total, event, index) =>
          total + eventBytes(event) + (view.events.length + index > 0 ? 1 : 0),
        0
      )
      if (this.bytes + bytes > this.maxBytes) {
        this.delete(view.requestId)
        continue
      }
      view.events.push(...added)
      view.bytes += bytes
      view.lastSeq = line.seq
      this.bytes += bytes
    }
  }

  clear(): void {
    this.views.clear()
    this.deferred.clear()
    this.oversized.clear()
    this.bytes = 0
  }

  private add(view: View): void {
    while (this.views.size >= this.maxRequests || this.bytes + view.bytes > this.maxBytes) {
      const oldest = this.views.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
    this.views.set(view.requestId, view)
    this.bytes += view.bytes
  }

  private delete(requestId: string): void {
    const view = this.views.get(requestId)
    if (!view) return
    this.bytes -= view.bytes
    this.views.delete(requestId)
  }
}

function requestIdentity(request: PersistedStreamRequest): string {
  return JSON.stringify([
    request.requestId,
    request.taskId,
    request.sessionId,
    request.responseId,
    request.streamId,
    request.messageId
  ])
}

function eventBytes(event: RuntimeEventRecord): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

function serializedBytesUpTo(
  events: readonly RuntimeEventRecord[],
  maxBytes: number
): number | null {
  let bytes = 2 // JSON array brackets.
  for (let index = 0; index < events.length; index += 1) {
    bytes += eventBytes(events[index]!) + (index > 0 ? 1 : 0)
    if (bytes > maxBytes) return null
  }
  return bytes > maxBytes ? null : bytes
}

function firstAfter(events: readonly RuntimeEventRecord[], cursor: number): number {
  let low = 0
  let high = events.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (events[middle]!.cursor <= cursor) low = middle + 1
    else high = middle
  }
  return low
}
