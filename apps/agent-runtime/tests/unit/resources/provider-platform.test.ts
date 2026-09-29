// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResourceError } from '@actiondriver/runtime-contracts'
import type { ResourceEntry, ResourceOperationContext, ResourceReadResult, ResourceWatchEvent } from '@actiondriver/runtime-contracts'
import type { InvocationContext } from '@actiondriver/plugin-contracts'
import { createPluginArtifactHostPorts, createPluginResourceProvider, pluginArtifactResourceId } from '../../../src/resources/plugin-resources'
import { createRemoteResourceProvider, type RemoteResourceTransport } from '../../../src/resources/remote-provider'
import { createHttpRemoteResourceTransport } from '../../../src/resources/remote-http-transport'
import { ResourceProviderRegistry } from '../../../src/resources/registry'
import { VersionedResourceStore } from '../../../src/resources/store'
import { createSessionScopedStoreProvider } from '../../../src/resources/work-provider'

const temporaryDirectories: string[] = []

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-provider-platform-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function text(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(new TextDecoder().decode(chunk))
  return chunks.join('')
}

function streamOf(...values: string[]): AsyncIterable<Uint8Array> {
  return (async function * () { for (const value of values) yield new TextEncoder().encode(value) })()
}

function context(authority: { sessionId?: string; taskId?: string; pluginId?: string }, overrides: Partial<Pick<ResourceOperationContext, 'deadline' | 'signal'>> = {}): ResourceOperationContext {
  return {
    authority,
    deadline: overrides.deadline ?? Date.now() + 5_000,
    signal: overrides.signal ?? new AbortController().signal
  }
}

function invocation(sessionId: string, taskId: string): InvocationContext {
  return {
    requestId: 'request-1',
    callId: 'call-1',
    taskId,
    sessionId,
    deadline: Date.now() + 5_000,
    source: { kind: 'runtime' },
    chain: []
  }
}

function workspaceRegistry(): { registry: ResourceProviderRegistry; store: VersionedResourceStore } {
  const store = new VersionedResourceStore({ root: join(root(), 'workspace') })
  const registry = new ResourceProviderRegistry({ supportedVersions: [1], now: Date.now })
  registry.register(
    { scheme: 'workspace', version: 1, capabilities: { read: true, write: true, list: true, watch: true } },
    createSessionScopedStoreProvider({ scheme: 'workspace', store })
  )
  return { registry, store }
}

describe('writable session work resources', () => {
  it('writes, reads back, lists and versions a work resource in the caller session', async () => {
    const { registry } = workspaceRegistry()
    const uri = 'adr://v1/workspace/session-1/notes/brief.txt?session=session-1'
    const first = await registry.write(uri, { createOnly: true, contentType: 'text/plain', stream: streamOf('v1') }, context({ sessionId: 'session-1', taskId: 'task-1' }))
    expect(first.version).toBe('1')
    const second = await registry.write(uri, { expectedVersion: '1', stream: streamOf('v2') }, context({ sessionId: 'session-1', taskId: 'task-2' }))
    expect(second.version).toBe('2')
    expect(await text((await registry.read(uri, context({ sessionId: 'session-1' }))).stream)).toBe('v2')

    const listed = await registry.list('adr://v1/workspace/all?session=session-1', context({ sessionId: 'session-1' }))
    expect(listed.map(entry => entry.uri)).toEqual([uri])
    expect(listed[0]?.version).toBe('2')
  })

  it('refuses a work resource that names another session and a concurrent stale write', async () => {
    const { registry } = workspaceRegistry()
    const other = 'adr://v1/workspace/session-1/notes/brief.txt?session=session-1'
    await registry.write(other, { createOnly: true, stream: streamOf('v1') }, context({ sessionId: 'session-1' }))

    const foreignUri = 'adr://v1/workspace/session-2/notes/secret.txt?session=session-2'
    const refused = await registry
      .write(foreignUri, { createOnly: true, stream: streamOf('nope') }, context({ sessionId: 'session-1' }))
      .then(() => null, (error: ResourceError) => error)
    expect(refused?.code).toBe('RESOURCE_UNAUTHORIZED')

    const conflict = await registry
      .write(other, { expectedVersion: '1', stream: streamOf('v2') }, context({ sessionId: 'session-1', taskId: 'task-1' }))
    expect(conflict.version).toBe('2')
    const stale = await registry
      .write(other, { expectedVersion: '1', stream: streamOf('v3') }, context({ sessionId: 'session-1', taskId: 'task-2' }))
      .then(() => null, (error: ResourceError) => error)
    expect(stale?.code).toBe('RESOURCE_VERSION_CONFLICT')
    expect(await text((await registry.read(other, context({ sessionId: 'session-1' }))).stream)).toBe('v2')
  })

  it('cancels and deadlines a write before it commits', async () => {
    const { registry } = workspaceRegistry()
    const uri = 'adr://v1/workspace/session-1/notes/brief.txt?session=session-1'
    const controller = new AbortController()
    controller.abort()
    const cancelled = await registry
      .write(uri, { createOnly: true, stream: streamOf('v1') }, context({ sessionId: 'session-1' }, { signal: controller.signal }))
      .then(() => null, (error: ResourceError) => error)
    expect(cancelled?.code).toBe('RESOURCE_CANCELLED')

    const expired = await registry
      .write(uri, { createOnly: true, stream: streamOf('v1') }, context({ sessionId: 'session-1' }, { deadline: Date.now() - 1 }))
      .then(() => null, (error: ResourceError) => error)
    expect(expired?.code).toBe('RESOURCE_DEADLINE_EXCEEDED')
    expect(await registry.list('adr://v1/workspace/all?session=session-1', context({ sessionId: 'session-1' }))).toHaveLength(0)
  })

  it('reports watch events with versions and sequence, and refuses a foreign session subscription', async () => {
    const { registry } = workspaceRegistry()
    const uri = 'adr://v1/workspace/session-1/notes/brief.txt?session=session-1'
    await registry.write(uri, { createOnly: true, stream: streamOf('v1') }, context({ sessionId: 'session-1' }))
    const events = await registry.watch(uri, context({ sessionId: 'session-1' }))
    const iterator = events[Symbol.asyncIterator]()
    const first = iterator.next()
    await registry.write(uri, { expectedVersion: '1', stream: streamOf('v2') }, context({ sessionId: 'session-1', taskId: 'task-2' }))
    const event = (await first).value as ResourceWatchEvent
    expect(event.kind).toBe('change')
    expect(event.version).toBe('2')
    expect(event.sequence).toBe(2)

    const refused = await registry
      .watch('adr://v1/workspace/session-2/notes/x.txt?session=session-1', context({ sessionId: 'session-1' }))
      .then(() => null, (error: ResourceError) => error)
    expect(refused?.code).toBe('RESOURCE_UNAUTHORIZED')
  })
})

describe('plugin artifact resources', () => {
  function pluginRegistry() {
    const store = new VersionedResourceStore({ root: join(root(), 'plugins') })
    const registry = new ResourceProviderRegistry({ supportedVersions: [1], now: Date.now })
    registry.register(
      { scheme: 'plugin', version: 1, capabilities: { read: true, write: true, list: true, watch: true } },
      createPluginResourceProvider(store)
    )
    return { registry, store }
  }

  it('creates and reads an artifact through the unified URI and the legacy bare id', async () => {
    const { registry, store } = pluginRegistry()
    const owner = { pluginId: 'documents', version: '1.0.0', hostEpoch: 'epoch-1' }
    const ports = createPluginArtifactHostPorts({
      store,
      readResource: (uri, _authority, context) => registry.read(uri, context),
      ids: () => 'artifact-1'
    })
    const contextOf = invocation('session-1', 'task-1')
    const created = await ports.create(owner, { name: 'sample.txt', contentType: 'text/plain', data: Buffer.from('hello').toString('base64') }, contextOf, new AbortController().signal) as { uri: string; version: string }
    expect(created.uri).toBe(`adr://v1/plugin/${pluginArtifactResourceId('documents', 'session-1', 'sample.txt')}`)

    const byUri = await ports.read(owner, { uri: created.uri }, contextOf, new AbortController().signal) as { base64: string }
    expect(Buffer.from(byUri.base64, 'base64').toString()).toBe('hello')
    const byId = await ports.read(owner, { id: 'sample.txt' }, contextOf, new AbortController().signal) as { base64: string }
    expect(Buffer.from(byId.base64, 'base64').toString()).toBe('hello')
  })

  it('refuses another plugin and another session reading the same artifact', async () => {
    const { registry, store } = pluginRegistry()
    const ports = createPluginArtifactHostPorts({ store, readResource: (uri, _authority, context) => registry.read(uri, context), ids: () => 'artifact-1' })
    const owner = { pluginId: 'documents', version: '1.0.0', hostEpoch: 'epoch-1' }
    const created = await ports.create(owner, { name: 'sample.txt', data: Buffer.from('hello').toString('base64') }, invocation('session-1', 'task-1'), new AbortController().signal) as { uri: string }

    const peer = { pluginId: 'spreadsheets', version: '1.0.0', hostEpoch: 'epoch-1' }
    const refused = await ports
      .read(peer, { uri: created.uri }, invocation('session-1', 'task-1'), new AbortController().signal)
      .then(() => null, (error: ResourceError) => error)
    expect(refused?.code).toBe('RESOURCE_UNAUTHORIZED')

    const otherSession = await ports
      .read(owner, { uri: created.uri }, invocation('session-2', 'task-9'), new AbortController().signal)
      .then(() => null, (error: ResourceError) => error)
    expect(otherSession?.code).toBe('RESOURCE_UNAUTHORIZED')
  })
})

describe('remote resource provider', () => {
  class FakeTransport implements RemoteResourceTransport {
    connected = true
    dropDuringWrite = false
    writes: string[] = []
    isConnected(): boolean {
      return this.connected
    }
    async read(uri: string, _context: ResourceOperationContext): Promise<ResourceReadResult> {
      return { uri, version: '1', contentType: 'text/plain', stream: streamOf('remote') }
    }
    async write(uri: string, request: { stream: AsyncIterable<Uint8Array> }, _context: ResourceOperationContext): Promise<ResourceEntry> {
      if (!this.connected) throw Object.assign(new Error('socket closed'), { code: 'DISCONNECTED' })
      const chunks: string[] = []
      for await (const chunk of request.stream) {
        if (this.dropDuringWrite) {
          this.connected = false
          throw Object.assign(new Error('socket closed mid-write'), { code: 'DISCONNECTED' })
        }
        chunks.push(new TextDecoder().decode(chunk))
      }
      this.writes.push(chunks.join(''))
      return { uri, version: '1' }
    }
    async list(): Promise<ResourceEntry[]> {
      return []
    }
    async watch(uri: string): Promise<AsyncIterable<ResourceWatchEvent>> {
      return (async function * () {
        yield { kind: 'change' as const, uri, version: '1', sequence: 1 }
        throw Object.assign(new Error('socket closed'), { code: 'DISCONNECTED' })
      })()
    }
  }

  it('fails a read once the host is disconnected instead of reading a local fallback', async () => {
    const transport = new FakeTransport()
    const provider = createRemoteResourceProvider(transport)
    const uri = 'adr://v1/remote-host/doc-1?session=session-1'
    expect(await text((await provider.read!(uri, context({ sessionId: 'session-1' }))).stream)).toBe('remote')
    transport.connected = false
    const failure = await provider.read!(uri, context({ sessionId: 'session-1' })).then(() => null, (error: ResourceError) => error)
    expect(failure?.code).toBe('RESOURCE_UNAVAILABLE')
  })

  it('reports an unknown outcome when a remote write loses its host and never replays it', async () => {
    const transport = new FakeTransport()
    const provider = createRemoteResourceProvider(transport)
    transport.dropDuringWrite = true
    const failure = await provider
      .write!('adr://v1/remote-host/doc-1?session=session-1', { createOnly: true, stream: streamOf('payload') }, context({ sessionId: 'session-1' }))
      .then(() => null, (error: ResourceError) => error)
    expect(failure?.code).toBe('RESOURCE_UNAVAILABLE')
    expect(failure?.message).toContain('unknown')
    expect(transport.writes).toHaveLength(0)
  })

  it('demands a re-synchronization when a watch loses the remote host', async () => {
    const provider = createRemoteResourceProvider(new FakeTransport())
    const events = await provider.watch!('adr://v1/remote-host/doc-1?session=session-1', context({ sessionId: 'session-1' }))
    const seen: ResourceWatchEvent[] = []
    for await (const event of events) seen.push(event)
    expect(seen.map(event => event.kind)).toEqual(['change', 'resync-required'])
  })

  it('propagates cancellation of an in-flight remote stream', async () => {
    const controller = new AbortController()
    const transport = new FakeTransport()
    transport.read = async (uri) => ({
      uri,
      version: '1',
      stream: (async function * () {
        yield new TextEncoder().encode('first')
        controller.abort()
        yield new TextEncoder().encode('second')
      })()
    })
    const provider = createRemoteResourceProvider(transport)
    const read = await provider.read!('adr://v1/remote-host/doc-1?session=session-1', context({ sessionId: 'session-1' }, { signal: controller.signal }))
    const iterator = read.stream[Symbol.asyncIterator]()
    expect(new TextDecoder().decode((await iterator.next()).value as Uint8Array)).toBe('first')
    const failure = await iterator.next().then(() => null, (error: ResourceError) => error)
    expect(failure?.code).toBe('RESOURCE_CANCELLED')
  })
})

describe('remote http transport', () => {
  function host(overrides: { fail?: boolean } = {}) {
    const requests: string[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      requests.push(target)
      if (target.endsWith('/readyz')) {
        return new Response('ok', { status: overrides.fail ? 503 : 200 })
      }
      if (overrides.fail) return new Response('unavailable', { status: 503 })
      if (target.endsWith('/resources/read')) {
        const body = JSON.parse(String(init?.body)) as { uri: string }
        return Response.json({ ok: true, value: { uri: body.uri, version: '1', contentType: 'text/plain', base64: Buffer.from('remote').toString('base64') } })
      }
      if (target.endsWith('/resources/list')) {
        return Response.json({ ok: true, value: [{ uri: 'adr://v1/remote-host/doc-1', version: '1' }] })
      }
      if (target.endsWith('/resources/write')) {
        const body = JSON.parse(String(init?.body)) as { uri: string }
        return Response.json({ ok: true, value: { uri: body.uri, version: '1' } })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
    return { fetchImpl, requests }
  }

  it('proxies read, list and write to a reachable host', async () => {
    const { fetchImpl } = host()
    const transport = createHttpRemoteResourceTransport({ baseUrl: 'http://127.0.0.1:9/remote', token: 'secret', fetch: fetchImpl })
    expect(await transport.isConnected()).toBe(true)
    const read = await transport.read('adr://v1/remote-host/doc-1?session=session-1', context({ sessionId: 'session-1' }))
    expect(await text(read.stream)).toBe('remote')
    expect((await transport.list('adr://v1/remote-host/all?session=session-1', context({ sessionId: 'session-1' }))).length).toBe(1)
    expect((await transport.write('adr://v1/remote-host/doc-1?session=session-1', { createOnly: true, stream: streamOf('payload') }, context({ sessionId: 'session-1' }))).version).toBe('1')
  })

  it('reports an unreachable or refusing host as unavailable instead of a local fallback', async () => {
    const { fetchImpl } = host({ fail: true })
    const transport = createHttpRemoteResourceTransport({ baseUrl: 'http://127.0.0.1:9/remote', token: 'secret', fetch: fetchImpl })
    expect(await transport.isConnected()).toBe(false)
    const provider = createRemoteResourceProvider(transport)
    const failure = await provider
      .read!('adr://v1/remote-host/doc-1?session=session-1', context({ sessionId: 'session-1' }))
      .then(() => null, (error: ResourceError) => error)
    expect(failure?.code).toBe('RESOURCE_UNAVAILABLE')
  })

  it('translates a remote structured refusal instead of flattening it to a transport error', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/readyz')) return new Response('ok', { status: 200 })
      return Response.json({ ok: false, error: { code: 'RESOURCE_UNAUTHORIZED', message: 'cross-session' } }, { status: 403 })
    }) as unknown as typeof fetch
    const transport = createHttpRemoteResourceTransport({ baseUrl: 'http://127.0.0.1:9/remote', token: 'secret', fetch: fetchImpl })
    const failure = await transport.read('adr://v1/remote-host/doc-1?session=session-2', context({ sessionId: 'session-2' }))
      .then(() => null, (error: ResourceError) => error)
    expect(failure?.code).toBe('RESOURCE_UNAUTHORIZED')
  })
})
