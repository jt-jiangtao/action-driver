import { describe, expect, it, vi } from 'vitest'
import type { ResourceError } from '@action-driver/runtime-contracts'
import { createInputFileProvider, createOutputFileProvider, legacyResourceUri } from '../../../src/resources/media-providers'
import { ResourceProviderRegistry } from '../../../src/resources/registry'

const encoder = new TextEncoder()
const authority = { taskId: 'task-1', sessionId: 'session-1' }
const context = { authority, deadline: 5000, signal: new AbortController().signal }

async function text(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(new TextDecoder().decode(chunk))
  return chunks.join('')
}

function registryWith(providers: { scheme: string; capabilities: Record<string, boolean>; provider: unknown }[]) {
  const registry = new ResourceProviderRegistry({ supportedVersions: [1], now: () => 1000 })
  for (const entry of providers) registry.register({ scheme: entry.scheme, version: 1, capabilities: entry.capabilities }, entry.provider as never)
  return registry
}

describe('session input and registered output providers', () => {
  it('reads a bound input through its URI and keeps the legacy file id resolvable', async () => {
    const read = vi.fn(async () => ({ bytes: encoder.encode('report'), name: 'report.pdf', mimeType: 'application/pdf' }))
    const listBound = vi.fn(async () => [{ fileId: 'file-1', name: 'report.pdf', mimeType: 'application/pdf', byteLength: 6 }])
    const registry = registryWith([{ scheme: 'session-input', capabilities: { read: true, list: true, watch: true }, provider: createInputFileProvider({ read, listBound }) }])
    const uri = legacyResourceUri('session-input', 'file-1', authority)
    expect(uri).toBe('adr://v1/session-input/file-1?task=task-1&session=session-1')
    const result = await registry.read(uri, context)
    expect(result.version).toBe('1')
    expect(await text(result.stream)).toBe('report')
    expect(read).toHaveBeenCalledWith('file-1', 'session-1')
    expect((await registry.list('adr://v1/session-input/all?task=task-1&session=session-1', context)).length).toBe(1)
  })

  it('refuses a cross-session read or watch before touching the store', async () => {
    const read = vi.fn()
    const registry = registryWith([{ scheme: 'session-input', capabilities: { read: true, watch: true }, provider: createInputFileProvider({ read, listBound: async () => [] }) }])
    const foreign = 'adr://v1/session-input/file-1?session=session-2'
    const readFailure = await registry.read(foreign, context).then(() => null, error => error as ResourceError)
    expect(readFailure?.code).toBe('RESOURCE_UNAUTHORIZED')
    const watchFailure = await registry.watch(foreign, context).then(() => null, error => error as ResourceError)
    expect(watchFailure?.code).toBe('RESOURCE_UNAUTHORIZED')
    expect(read).not.toHaveBeenCalled()
  })

  it('surfaces a store ownership refusal as a structured not-found instead of leaking bytes', async () => {
    const registry = registryWith([{
      scheme: 'generated-output',
      capabilities: { read: true, list: true, watch: true },
      provider: createOutputFileProvider({ readSnapshot: async () => { throw Object.assign(new Error('OUTPUT_FILE_OWNERSHIP_MISMATCH'), { code: 'OUTPUT_FILE_OWNERSHIP_MISMATCH' }) }, listByTask: async () => [] })
    }])
    const failure = await registry.read('adr://v1/generated-output/file-9?task=task-1&session=session-1', context).then(() => null, error => error as ResourceError)
    expect(failure?.code).toBe('RESOURCE_NOT_FOUND')
  })

  it('lists registered outputs with their URIs, task ownership and immutable snapshots', async () => {
    const registry = registryWith([{
      scheme: 'generated-output',
      capabilities: { read: true, list: true, watch: true },
      provider: createOutputFileProvider({
        readSnapshot: async () => ({ bytes: encoder.encode('png'), name: 'chart.png', mimeType: 'image/png' }),
        listByTask: async () => [{ fileId: 'file-9', sessionId: 'session-1', taskId: 'task-1', name: 'chart.png', mimeType: 'image/png', byteLength: 3 }]
      })
    }])
    const entries = await registry.list('adr://v1/generated-output/all?task=task-1&session=session-1', context)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.immutable).toBe(true)
    expect(await text((await registry.read('adr://v1/generated-output/file-9?task=task-1&session=session-1', context)).stream)).toBe('png')
  })
})
