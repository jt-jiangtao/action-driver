import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResourceError } from '@action-driver/runtime-contracts'
import { VersionedResourceStore, boundedStream } from '../../../src/resources/store'
import { ResourceProviderRegistry } from '../../../src/resources/registry'

const authority = { taskId: 'task-1', sessionId: 'session-1' }
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function platform() {
  const root = await mkdtemp(join(tmpdir(), 'action-driver-resources-')); directories.push(root)
  const registry = new ResourceProviderRegistry({ supportedVersions: [1], now: () => 1000 })
  const store = new VersionedResourceStore({ root, maxChunkBytes: 4, now: () => 1000 })
  registry.register({ scheme: 'workspace', version: 1, capabilities: { read: true, write: true, list: true, watch: true } }, store)
  return { registry, store }
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(new TextDecoder().decode(chunk))
  return chunks
}

async function write(registry: ResourceProviderRegistry, id: string, text: string, request: { expectedVersion?: string; createOnly?: boolean } = {}) {
  return registry.write(`adr://v1/workspace/${id}`, { ...request, stream: boundedStream(new TextEncoder().encode(text)) }, { authority, deadline: 2000, signal: new AbortController().signal })
}

function codeOf(run: () => unknown): string {
  try { run() } catch (error) { return error instanceof ResourceError ? error.code : `unexpected:${String(error)}` }
  return 'no-error'
}

describe('versioned resource store', () => {
  it('streams large content in bounded chunks and reports the committed version', async () => {
    const { registry } = await platform()
    const entry = await write(registry, 'notes/report.txt', 'abcdefghij')
    expect(entry.version).toBe('1')
    const read = await registry.read(`adr://v1/workspace/${entry.uri}`, { authority, deadline: 2000, signal: new AbortController().signal })
    expect(await collect(read.stream)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('never treats an interrupted write as a committed version', async () => {
    const { registry } = await platform()
    await write(registry, 'notes/a.txt', 'first')
    const controller = new AbortController()
    const pending = registry.write('adr://v1/workspace/notes/a.txt', {
      expectedVersion: '1',
      stream: (async function * () { yield new TextEncoder().encode('partial'); controller.abort() })(),
      ...{}
    }, { authority, deadline: 2000, signal: controller.signal })
    await expect(pending).rejects.toThrow(/RESOURCE_CANCELLED|RESOURCE/)
    const read = await registry.read('adr://v1/workspace/notes/a.txt', { authority, deadline: 2000, signal: new AbortController().signal })
    expect(read.version).toBe('1')
    expect(await collect(read.stream)).toEqual(['firs', 't'])
  })

  it('rejects stale expected versions and immutable resources without overwriting history', async () => {
    const { registry, store } = await platform()
    await write(registry, 'notes/a.txt', 'first')
    await write(registry, 'notes/a.txt', 'second', { expectedVersion: '1' })
    const conflict = await registry.write('adr://v1/workspace/notes/a.txt', { expectedVersion: '1', stream: boundedStream(new TextEncoder().encode('stale')) }, { authority, deadline: 2000, signal: new AbortController().signal }).then(() => null, error => error as ResourceError)
    expect(conflict?.code).toBe('RESOURCE_VERSION_CONFLICT')
    expect(codeOf(() => store.markImmutable('notes/a.txt'))).toBe('no-error')
    const immutable = await registry.write('adr://v1/workspace/notes/a.txt', { expectedVersion: '2', stream: boundedStream(new TextEncoder().encode('edit')) }, { authority, deadline: 2000, signal: new AbortController().signal }).then(() => null, error => error as ResourceError)
    expect(immutable?.code).toBe('RESOURCE_IMMUTABLE')
    const pinned = await registry.read('adr://v1/workspace/notes/a.txt?version=1', { authority, deadline: 2000, signal: new AbortController().signal })
    expect(await collect(pinned.stream)).toEqual(['firs', 't'])
    const latest = await registry.read('adr://v1/workspace/notes/a.txt', { authority, deadline: 2000, signal: new AbortController().signal })
    expect(latest.version).toBe('2')
  })

  it('publishes watch events with versions and asks for a resync when a gap is reported', async () => {
    const { registry, store } = await platform()
    const uri = 'adr://v1/workspace/notes/a.txt'
    const events = await registry.watch(uri, { authority, deadline: 5000, signal: new AbortController().signal })
    const seen: unknown[] = []
    const consuming = (async () => { for await (const event of events) seen.push(event) })()
    await write(registry, 'notes/a.txt', 'first')
    store.reportGap('notes/a.txt')
    await write(registry, 'notes/a.txt', 'second')
    await store.closeWatches()
    await consuming
    expect(seen[0]).toMatchObject({ kind: 'change', version: '1', sequence: 1 })
    expect(seen[1]).toMatchObject({ kind: 'resync-required' })
    expect(seen[2]).toMatchObject({ kind: 'change', version: '2' })
  })

  it('refuses a watch opened for another session and stops delivery when authority is revoked', async () => {
    const { registry, store } = await platform()
    const refused = await registry.watch('adr://v1/workspace/notes/a.txt?session=session-2', { authority, deadline: 5000, signal: new AbortController().signal }).then(() => null, error => error as ResourceError)
    expect(refused?.code).toBe('RESOURCE_UNAUTHORIZED')
    const events = await registry.watch('adr://v1/workspace/notes/a.txt', { authority, deadline: 5000, signal: new AbortController().signal })
    const seen: unknown[] = []
    const consuming = (async () => { for await (const event of events) seen.push(event) })()
    await write(registry, 'notes/a.txt', 'first')
    store.revokeScope({ sessionId: 'session-1' })
    await write(registry, 'notes/a.txt', 'second')
    await store.closeWatches()
    await consuming
    expect(seen).toHaveLength(1)
  })
})
