import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'
import { DEFAULT_INTERACTION_RETENTION } from './interaction-payload'
import type {
  InteractionBeginRecord,
  InteractionCompletionRecord,
  InteractionLogDetail,
  InteractionLogPage,
  InteractionLogQuery,
  InteractionLogStore,
  InteractionLogSummary,
  InteractionOneWayRecord,
  InteractionPayloadView,
  InteractionPruneResult
} from './interaction-store'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

type Retention = {
  maxTotalBytes: number
  maxAgeMs: number
  maxTextPayloadBytes: number
}

export async function createLocalInteractionLogStore(options: {
  rootDirectory: string
  source: string
  retention?: Retention
  clock?: () => number
  readOnly?: boolean
}): Promise<InteractionLogStore> {
  const store = new LocalInteractionLogStore(
    options.rootDirectory,
    options.source,
    options.retention ?? DEFAULT_INTERACTION_RETENTION,
    options.clock ?? Date.now,
    options.readOnly ?? false
  )
  await store.initialize()
  return store
}

class LocalInteractionLogStore implements InteractionLogStore {
  private readonly records = new Map<string, InteractionLogSummary>()
  private readonly sourceDirectory: string
  private readonly payloadDirectory: string
  private readonly indexPath: string
  private queue: Promise<void> = Promise.resolve()

  constructor(
    rootDirectory: string,
    private readonly source: string,
    private readonly retention: Retention,
    private readonly clock: () => number,
    private readonly readOnly: boolean
  ) {
    this.sourceDirectory = join(rootDirectory, source)
    this.payloadDirectory = join(this.sourceDirectory, 'payloads')
    this.indexPath = join(this.sourceDirectory, 'index.ndjson')
  }

  async initialize(): Promise<void> {
    await mkdir(this.payloadDirectory, { recursive: true })
    try {
      const contents = await readFile(this.indexPath, 'utf8')
      for (const line of contents.split('\n')) {
        if (!line.trim()) continue
        try {
          const record = JSON.parse(line) as InteractionLogSummary
          if (record.id?.startsWith(`${this.source}:`)) this.records.set(record.id, record)
        } catch {
          // A partial or corrupt line cannot make the remaining history unreadable.
        }
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (!this.readOnly) {
      await this.recoverIncomplete(this.clock() + 1)
      await this.removeOrphanPayloads()
      await this.pruneDirect(this.clock())
    }
  }

  begin(event: InteractionBeginRecord): Promise<void> {
    return this.serial(async () => {
      this.assertOwned(event.id)
      await this.writePayload(event.id, 'request', event.request)
      const summary: InteractionLogSummary = {
        ...base(event),
        completedAt: null,
        kind: 'request-response',
        state: 'pending',
        level: 30,
        levelLabel: 'info',
        requestBytes: event.request.byteLength,
        responseBytes: 0,
        requestAvailable:
          event.request.kind !== 'empty' && event.request.unavailableReason === null,
        responseAvailable: false,
        requestTruncated: event.request.truncated,
        responseTruncated: false,
        ...(event.request.unavailableReason
          ? { requestUnavailableReason: event.request.unavailableReason }
          : {})
      }
      this.records.set(event.id, summary)
      await this.appendSummary(summary)
    })
  }

  complete(eventId: string, completion: InteractionCompletionRecord): Promise<void> {
    return this.serial(async () => {
      this.assertOwned(eventId)
      const current = this.records.get(eventId)
      if (!current) throw new Error(`INTERACTION_NOT_FOUND: ${eventId}`)
      if (current.state === 'completed') return
      if (completion.response) await this.writePayload(eventId, 'response', completion.response)
      const summary: InteractionLogSummary = {
        ...current,
        completedAt: completion.completedAt,
        state: 'completed',
        outcome: completion.outcome,
        ...(completion.status === undefined ? {} : { status: completion.status }),
        durationMs: completion.completedAt - current.time,
        responseBytes: completion.response?.byteLength ?? 0,
        responseAvailable: Boolean(
          completion.response &&
          completion.response.kind !== 'empty' &&
          completion.response.unavailableReason === null
        ),
        responseTruncated: completion.response?.truncated ?? false,
        ...(completion.response?.unavailableReason
          ? { responseUnavailableReason: completion.response.unavailableReason }
          : {}),
        ...(completion.error
          ? {
              level: 50,
              levelLabel: 'error',
              errorCode: completion.error.code,
              errorMessage: completion.error.message
            }
          : {})
      }
      this.records.set(eventId, summary)
      await this.appendSummary(summary)
      await this.pruneDirect(this.clock())
    })
  }

  recordOneWay(event: InteractionOneWayRecord): Promise<void> {
    return this.serial(async () => {
      this.assertOwned(event.id)
      await this.writePayload(event.id, 'request', event.payload)
      const summary: InteractionLogSummary = {
        ...base(event),
        completedAt: event.time,
        kind: 'one-way-event',
        state: 'completed',
        level: 30,
        levelLabel: 'info',
        outcome: 'sent',
        durationMs: 0,
        requestBytes: event.payload.byteLength,
        responseBytes: 0,
        requestAvailable:
          event.payload.kind !== 'empty' && event.payload.unavailableReason === null,
        responseAvailable: false,
        requestTruncated: event.payload.truncated,
        responseTruncated: false,
        ...(event.payload.unavailableReason
          ? { requestUnavailableReason: event.payload.unavailableReason }
          : {})
      }
      this.records.set(event.id, summary)
      await this.appendSummary(summary)
      await this.pruneDirect(this.clock())
    })
  }

  recoverIncomplete(before: number): Promise<number> {
    return this.serialWithResult(async () => {
      let recovered = 0
      for (const [id, record] of this.records) {
        if (record.state !== 'pending' || record.time >= before) continue
        const updated = { ...record, state: 'incomplete' as const, outcome: 'incomplete' }
        this.records.set(id, updated)
        await this.appendSummary(updated)
        recovered += 1
      }
      return recovered
    })
  }

  async list(query: InteractionLogQuery): Promise<InteractionLogPage> {
    await this.queue
    const limit = Math.max(1, query.limit ?? 200)
    const offset = decodeCursor(query.cursor)
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
    const records = filtered.slice(offset, offset + limit).map((record) => structuredClone(record))
    const nextOffset = offset + records.length
    return { records, nextCursor: nextOffset < filtered.length ? String(nextOffset) : null }
  }

  async getDetail(eventId: string): Promise<InteractionLogDetail | null> {
    await this.queue
    this.assertOwned(eventId)
    const summary = this.records.get(eventId)
    if (!summary) return null
    return {
      ...structuredClone(summary),
      request: summary.requestAvailable
        ? await this.readPayload(eventId, 'request', summary.requestBytes, summary.requestTruncated)
        : unavailablePayload(summary.requestUnavailableReason, summary.requestBytes),
      response: summary.responseAvailable
        ? await this.readPayload(
            eventId,
            'response',
            summary.responseBytes,
            summary.responseTruncated
          )
        : unavailablePayload(summary.responseUnavailableReason, summary.responseBytes)
    }
  }

  prune(now: number): Promise<InteractionPruneResult> {
    return this.serialWithResult(() => this.pruneDirect(now))
  }

  private serial(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work, work)
    this.queue = result.catch(() => undefined)
    return result
  }

  private serialWithResult<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private assertOwned(eventId: string): void {
    if (!eventId.startsWith(`${this.source}:`)) throw new Error(`INVALID_EVENT_SOURCE: ${eventId}`)
  }

  private async appendSummary(summary: InteractionLogSummary): Promise<void> {
    await appendFile(this.indexPath, `${JSON.stringify(summary)}\n`, 'utf8')
  }

  private async rewriteIndex(): Promise<void> {
    const contents = [...this.records.values()]
      .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
      .map((record) => JSON.stringify(record))
      .join('\n')
    await atomicWrite(this.indexPath, contents ? `${contents}\n` : '')
  }

  private async pruneDirect(now: number): Promise<InteractionPruneResult> {
    const oldestFirst = [...this.records.values()].sort(
      (left, right) => left.time - right.time || left.id.localeCompare(right.id)
    )
    const remove = new Set(
      oldestFirst
        .filter((record) => now - record.time > this.retention.maxAgeMs)
        .map((record) => record.id)
    )
    const physicalBytes = await directoryBytes(this.sourceDirectory)
    let totalBytes = await retainedBytes(this.records, remove, this.payloadDirectory)
    for (const record of oldestFirst) {
      if (totalBytes <= this.retention.maxTotalBytes) break
      if (remove.has(record.id)) continue
      remove.add(record.id)
      totalBytes = await retainedBytes(this.records, remove, this.payloadDirectory)
    }
    let removedBytes = 0
    for (const id of remove) {
      const record = this.records.get(id)
      if (!record) continue
      removedBytes += record.requestBytes + record.responseBytes
      await this.removePayload(id, 'request')
      await this.removePayload(id, 'response')
      this.records.delete(id)
    }
    if (remove.size > 0 || physicalBytes > this.retention.maxTotalBytes) {
      await this.rewriteIndex()
    }
    return { removedEvents: remove.size, removedBytes }
  }

  private async removeOrphanPayloads(): Promise<void> {
    const referenced = new Set<string>()
    for (const record of this.records.values()) {
      if (record.requestAvailable) referenced.add(this.payloadPath(record.id, 'request'))
      if (record.responseAvailable) referenced.add(this.payloadPath(record.id, 'response'))
    }
    for (const file of await readdir(this.payloadDirectory)) {
      const path = join(this.payloadDirectory, file)
      if (file.endsWith('.tmp') || !referenced.has(path)) await rm(path, { force: true })
    }
  }

  private async writePayload(
    eventId: string,
    side: 'request' | 'response',
    payload: InteractionPayloadView
  ): Promise<void> {
    if (payload.kind === 'empty' || payload.unavailableReason) return
    const path = this.payloadPath(eventId, side)
    await atomicWrite(path, await gzipAsync(JSON.stringify(payload)))
  }

  private async readPayload(
    eventId: string,
    side: 'request' | 'response',
    byteLength: number,
    truncated: boolean
  ): Promise<InteractionPayloadView> {
    try {
      const compressed = await readFile(this.payloadPath(eventId, side))
      return JSON.parse((await gunzipAsync(compressed)).toString('utf8')) as InteractionPayloadView
    } catch {
      return {
        kind: 'text',
        contentType: null,
        byteLength,
        truncated,
        text: null,
        unavailableReason: 'missing'
      }
    }
  }

  private removePayload(eventId: string, side: 'request' | 'response'): Promise<void> {
    return rm(this.payloadPath(eventId, side), { force: true })
  }

  private payloadPath(eventId: string, side: 'request' | 'response'): string {
    return join(this.payloadDirectory, `${encodeURIComponent(eventId)}.${side}.json.gz`)
  }
}

function base(event: InteractionBeginRecord | InteractionOneWayRecord) {
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

async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(contents)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

async function retainedBytes(
  records: Map<string, InteractionLogSummary>,
  remove: Set<string>,
  payloadDirectory: string
): Promise<number> {
  let total = 0
  for (const record of records.values()) {
    if (remove.has(record.id)) continue
    total += Buffer.byteLength(`${JSON.stringify(record)}\n`, 'utf8')
    for (const side of ['request', 'response'] as const) {
      const available = side === 'request' ? record.requestAvailable : record.responseAvailable
      if (!available) continue
      const path = join(payloadDirectory, `${encodeURIComponent(record.id)}.${side}.json.gz`)
      try {
        total += (await stat(path)).size
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
  }
  return total
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    total += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size
  }
  return total
}

function unavailablePayload(
  reason: InteractionPayloadView['unavailableReason'] | undefined,
  byteLength: number
): InteractionPayloadView | null {
  return reason
    ? {
        kind: 'text',
        contentType: null,
        byteLength,
        truncated: false,
        text: null,
        unavailableReason: reason
      }
    : null
}

function decodeCursor(cursor: string | null | undefined): number {
  const parsed = Number(cursor ?? 0)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
