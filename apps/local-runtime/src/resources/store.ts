import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  ResourceError,
  parseResourceUri,
  type ResourceEntry,
  type ResourceOperationContext,
  type ResourceProvider,
  type ResourceReadResult,
  type ResourceWatchEvent,
  type ResourceWriteRequest
} from '@action-driver/runtime-contracts'

/** Chunk helper so providers never need to buffer a whole file to serve a read. */
export function boundedStream(bytes: Uint8Array, options: { maxChunkBytes?: number } = {}): AsyncIterable<Uint8Array> {
  const size = Math.max(1, options.maxChunkBytes ?? 64 * 1024)
  return (async function * () {
    for (let offset = 0; offset < bytes.length; offset += size) yield bytes.slice(offset, offset + size)
  })()
}

type Version = { version: number; content: Uint8Array; contentType?: string }
type Record = { versions: Version[]; immutable: boolean; sequence: number }
type WatchListener = (event: ResourceWatchEvent) => void
type Scope = { taskId?: string; sessionId?: string }

export interface VersionedResourceStoreOptions { root: string; maxChunkBytes?: number; now?(): number }

/**
 * File-backed writable resources with explicit versioning. Documents are immutable once marked
 * delivered, so modifying one always produces a new version instead of rewriting history.
 */
export class VersionedResourceStore implements ResourceProvider {
  private readonly records = new Map<string, Record>()
  private readonly watchers = new Map<string, Map<WatchListener, Scope>>()
  private readonly revokedScopes: Scope[] = []
  private readonly pending: (() => void)[] = []
  /** Serializes writes per resource so the version check and the commit stay atomic. */
  private readonly writeTails = new Map<string, Promise<unknown>>()
  constructor(private readonly options: VersionedResourceStoreOptions) {}

  private now(): number { return this.options.now?.() ?? Date.now() }

  /** Providers address resources by their stable id; the URI itself stays a locating device. */
  private resourceId(uri: string): string { return parseResourceUri(uri).id }

  private split(id: string, selector?: string): { key: string; version?: number } {
    if (selector === undefined) return { key: id }
    const version = Number(selector)
    if (!Number.isSafeInteger(version) || version < 1) throw new ResourceError('RESOURCE_NOT_FOUND', `${id}: invalid version selector`)
    return { key: id, version }
  }

  private record(key: string): Record {
    let record = this.records.get(key)
    if (!record) { record = { versions: [], immutable: false, sequence: 0 }; this.records.set(key, record) }
    return record
  }

  private directory(key: string): string {
    const path = join(this.options.root, key)
    if (!path.startsWith(this.options.root)) throw new ResourceError('RESOURCE_INVALID_URI', `${key}: escapes the store root`)
    return path
  }

  async read(uri: string, _context: ResourceOperationContext): Promise<ResourceReadResult> {
    const id = this.resourceId(uri)
    const { key, version } = this.split(id, _context.authority.version)
    const record = await this.load(key)
    const selected = version === undefined ? record.versions.at(-1) : record.versions.find(value => value.version === version)
    if (!selected) throw new ResourceError('RESOURCE_NOT_FOUND', `${id}: no such version`)
    return { uri: id, version: String(selected.version), ...(selected.contentType ? { contentType: selected.contentType } : {}), stream: boundedStream(selected.content, this.options) }
  }

  async list(uri: string, _context: ResourceOperationContext): Promise<ResourceEntry[]> {
    const id = this.resourceId(uri)
    const keys = await this.keys()
    return keys.filter(key => key === id || key.startsWith(`${id}/`)).map(key => {
      const record = this.records.get(key)!
      return { uri: key, version: String(record.versions.at(-1)?.version ?? 0), ...(record.immutable ? { immutable: true } : {}) }
    })
  }

  async write(uri: string, request: ResourceWriteRequest, context: ResourceOperationContext): Promise<ResourceEntry> {
    const id = this.resourceId(uri)
    const { key, version: selector } = this.split(id)
    if (selector !== undefined) throw new ResourceError('RESOURCE_IMMUTABLE', `${id}: pinned versions are read-only`)
    return await this.serialize(key, () => this.commitWrite(id, key, request, context))
  }

  private async commitWrite(id: string, key: string, request: ResourceWriteRequest, context: ResourceOperationContext): Promise<ResourceEntry> {
    const record = await this.load(key)
    const current = record.versions.at(-1)?.version
    if (record.immutable) throw new ResourceError('RESOURCE_IMMUTABLE', `${id}: delivered resources are immutable`)
    if (request.createOnly && current !== undefined) throw new ResourceError('RESOURCE_VERSION_CONFLICT', `${id}: already exists at version ${current}`)
    if (request.expectedVersion !== undefined && request.expectedVersion !== String(current ?? '')) throw new ResourceError('RESOURCE_VERSION_CONFLICT', `${id}: expected ${request.expectedVersion}, current ${current ?? 'none'}`)
    const chunks: Uint8Array[] = []
    for await (const chunk of request.stream) {
      if (context.signal.aborted) throw new ResourceError('RESOURCE_CANCELLED', `${id}: write cancelled`)
      if (context.deadline <= this.now()) throw new ResourceError('RESOURCE_DEADLINE_EXCEEDED', `${id}: write deadline exceeded`)
      chunks.push(chunk)
    }
    if (context.signal.aborted) throw new ResourceError('RESOURCE_CANCELLED', `${id}: write cancelled`)
    const version = (current ?? 0) + 1
    record.versions.push({ version, content: Buffer.concat(chunks), ...(request.contentType ? { contentType: request.contentType } : {}) })
    record.sequence += 1
    await this.persist(key, record)
    this.emit(key, { kind: 'change', uri: key, version: String(version), sequence: record.sequence })
    return { uri: key, version: String(version) }
  }

  /**
   * A rejected predecessor must not block the next writer, but it must still run after it so two
   * writers cannot both see the same current version and both commit.
   */
  private serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.writeTails.get(key) ?? Promise.resolve()
    const current = previous.then(run, run)
    this.writeTails.set(key, current.catch(() => undefined))
    return current
  }

  async watch(uri: string, context: ResourceOperationContext): Promise<AsyncIterable<ResourceWatchEvent>> {
    const id = this.resourceId(uri)
    const { key } = this.split(id)
    const queue: ResourceWatchEvent[] = []
    let notify: (() => void) | undefined
    let closed = false
    const listener: WatchListener = event => { queue.push(event); notify?.() }
    const listeners = this.watchers.get(key) ?? new Map<WatchListener, Scope>()
    listeners.set(listener, { ...context.authority }); this.watchers.set(key, listeners)
    this.pending.push(() => { closed = true; notify?.() })
    return {
      [Symbol.asyncIterator]: () => ({
        async next(): Promise<IteratorResult<ResourceWatchEvent>> {
          while (!queue.length) {
            if (closed) return { done: true, value: undefined as never }
            await new Promise<void>(resolve => { notify = resolve })
          }
          return { done: false, value: queue.shift()! }
        }
      })
    }
  }

  markImmutable(id: string): void {
    this.record(id).immutable = true
  }

  /** Simulation seam for a provider-observed gap: subscribers must re-synchronize. */
  reportGap(id: string): void {
    this.emit(id, { kind: 'resync-required', uri: id })
  }

  revokeScope(scope: Scope): void {
    this.revokedScopes.push({ ...scope })
  }

  async deleteSession(sessionId: string, namespace: 'workspace' | 'plugin'): Promise<void> {
    this.revokeScope({ sessionId })
    for (const key of await this.keys()) {
      const owned = namespace === 'workspace'
        ? key === sessionId || key.startsWith(`${sessionId}/`)
        : key.split('/')[1] === sessionId
      if (!owned) continue
      this.records.delete(key)
      this.watchers.delete(key)
      this.writeTails.delete(key)
      await rm(this.directory(key), { recursive: true, force: true })
    }
  }

  async closeWatches(): Promise<void> {
    for (const close of this.pending.splice(0)) close()
    this.watchers.clear()
  }

  private emit(key: string, event: ResourceWatchEvent): void {
    const listeners = this.watchers.get(key)
    if (!listeners) return
    for (const [listener, scope] of [...listeners]) if (!this.isRevoked(scope)) listener(event)
  }

  private isRevoked(scope: Scope): boolean {
    return this.revokedScopes.some(revoked =>
      (revoked.sessionId !== undefined && revoked.sessionId === scope.sessionId) ||
      (revoked.taskId !== undefined && revoked.taskId === scope.taskId))
  }

  private async load(key: string): Promise<Record> {
    if (this.records.has(key)) return this.record(key)
    const directory = this.directory(key)
    const record = this.record(key)
    try {
      const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8')) as { versions: { version: number; contentType?: string }[]; immutable?: boolean; sequence?: number }
      for (const entry of meta.versions) record.versions.push({ version: entry.version, content: new Uint8Array(await readFile(join(directory, `${entry.version}.bin`))), ...(entry.contentType ? { contentType: entry.contentType } : {}) })
      record.immutable = meta.immutable ?? false
      record.sequence = meta.sequence ?? record.versions.length
    } catch { /* a resource without a committed version stays absent */ }
    return record
  }

  private async keys(): Promise<string[]> {
    const found: string[] = []
    const walk = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory()) await walk(join(directory, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
        else if (entry.name === 'meta.json' && prefix) found.push(prefix)
      }
    }
    await walk(this.options.root, '')
    return [...new Set([...this.records.keys(), ...found])]
  }

  private async persist(key: string, record: Record): Promise<void> {
    const directory = this.directory(key)
    await mkdir(directory, { recursive: true })
    for (const version of record.versions) await writeFile(join(directory, `${version.version}.bin`), version.content)
    // A unique staging name keeps concurrent writers from renaming each other's file away.
    const meta = join(this.options.root, `${Buffer.from(key).toString('hex')}.${randomUUID()}.meta.json`)
    await writeFile(meta, JSON.stringify({ versions: record.versions.map(value => ({ version: value.version, ...(value.contentType ? { contentType: value.contentType } : {}) })), immutable: record.immutable, sequence: record.sequence }))
    await rename(meta, join(directory, 'meta.json')).catch(async error => {
      await rm(meta, { force: true })
      throw error
    })
  }
}
