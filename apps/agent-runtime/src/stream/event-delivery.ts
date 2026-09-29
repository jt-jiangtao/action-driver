import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import type {
  PersistedStreamRequest,
  RuntimeEventRecord,
  StreamSessionRepository
} from '../ports'
import type { SnapshotEvent } from './stream-snapshot'

export type Emit = (event: StreamServerEvent) => void | Promise<void>

/**
 * Owns per-request delivery state: the serialized publication queue and the cursor already
 * handed to a live connection. Event rows must be persisted before `publishThrough` runs.
 */
export class StreamEventDelivery {
  private readonly publicationTails = new Map<string, Promise<void>>()
  private readonly publishedCursors = new Map<string, number>()

  constructor(
    private readonly options: {
      repositories: Pick<StreamSessionRepository, 'events' | 'streamRequests'>
      toServerEvent(request: PersistedStreamRequest, record: RuntimeEventRecord): StreamServerEvent
      requestNotFoundEvent(requestId: string): StreamServerEvent
      hasPendingApprovals: boolean
      snapshot(requestId: string): Promise<SnapshotEvent>
      rebindLiveDelivery(requestId: string, emit: Emit): void
    }
  ) {}

  async publishThrough(
    request: PersistedStreamRequest,
    cursor: number,
    emit: Emit
  ): Promise<void> {
    const previous = this.publicationTails.get(request.requestId) ?? Promise.resolve()
    const current = previous.then(async () => {
      let last = this.publishedCursors.get(request.requestId) ?? 0
      while (last < cursor) {
        const records = await this.options.repositories.events.listForRequestAfter(
          request.requestId,
          last,
          256
        )
        if (records.length === 0) break
        for (const record of records) {
          if (record.cursor > cursor) return
          await emit(this.options.toServerEvent(request, record))
          last = record.cursor
          this.publishedCursors.set(request.requestId, last)
        }
      }
    })
    this.publicationTails.set(
      request.requestId,
      current.catch(() => undefined)
    )
    await current
  }

  /** Records a cursor already handed to the caller (for example the accepted event). */
  markPublished(requestId: string, cursor: number): void {
    this.publishedCursors.set(requestId, cursor)
  }

  /** Drops delivery state for a finished request so a later resume replays from persistence. */
  release(requestId: string): void {
    this.publicationTails.delete(requestId)
    this.publishedCursors.delete(requestId)
  }

  async replay(requestId: string, afterCursor: number, emit: Emit): Promise<void> {
    this.options.rebindLiveDelivery(requestId, emit)
    const request = await this.options.repositories.streamRequests.getByRequestId(requestId)
    if (!request) {
      await emit(this.options.requestNotFoundEvent(requestId))
      return
    }
    if (this.options.hasPendingApprovals) {
      // Approval waiters are process-local. Restore their live state together with the
      // authoritative task projection rather than briefly displaying historical requests.
      await emit(await this.options.snapshot(requestId))
      return
    }
    const first = (await this.options.repositories.events.listForRequestAfter(requestId, 0, 1))[0]
    const replayExpired =
      (!first && request.lastSequence >= 0) ||
      (first !== undefined && first.type !== 'request.accepted' && afterCursor < first.cursor)
    if (replayExpired) {
      await emit(await this.options.snapshot(request.requestId))
      return
    }
    let cursor = afterCursor
    while (true) {
      const events = await this.options.repositories.events.listForRequestAfter(
        requestId,
        cursor,
        256
      )
      if (events.length === 0) break
      for (const event of events) {
        await emit(this.options.toServerEvent(request, event))
        cursor = event.cursor
      }
    }
  }
}
