import { describe, expect, it, vi } from 'vitest'
import { ResourceError, type ResourceProvider } from '@actiondriver/runtime-contracts'
import { ResourceProviderRegistry } from '../../../src/resources/registry'

const authority = { taskId: 'task-1', sessionId: 'session-1' }
const chunked = async function * (text: string) { yield new TextEncoder().encode(text) }

function provider(overrides: Partial<ResourceProvider> = {}): ResourceProvider {
  return {
    async read() { return { uri: 'adr://v1/fixture/a', version: '1', stream: chunked('body') } },
    async list() { return [{ uri: 'adr://v1/fixture/a', version: '1' }] },
    ...overrides
  }
}

function registry() {
  const instance = new ResourceProviderRegistry({ supportedVersions: [1], now: () => 1000 })
  return instance
}

function codeOf(run: () => unknown): string {
  try { run() } catch (error) { return error instanceof ResourceError ? error.code : `unexpected:${String(error)}` }
  return 'no-error'
}

describe('resource provider registry', () => {
  it('routes an operation to the provider registered for the URI scheme', async () => {
    const instance = registry()
    instance.register({ scheme: 'fixture', version: 1, owner: { pluginId: 'fixture', version: '1.0.0' }, capabilities: { read: true, list: true } }, provider())
    const read = await instance.read('adr://v1/fixture/a?task=task-1&session=session-1', { authority, deadline: 5000, signal: new AbortController().signal })
    expect(read.version).toBe('1')
    const chunks: string[] = []
    for await (const chunk of read.stream) chunks.push(new TextDecoder().decode(chunk))
    expect(chunks).toEqual(['body'])
    expect((await instance.list('adr://v1/fixture/a?task=task-1&session=session-1', { authority, deadline: 5000, signal: new AbortController().signal }))).toHaveLength(1)
  })

  it('refuses duplicate scheme ownership and names both owners', () => {
    const instance = registry()
    instance.register({ scheme: 'fixture', version: 1, owner: { pluginId: 'first', version: '1.0.0' }, capabilities: { read: true } }, provider())
    const failure = codeOf(() => instance.register({ scheme: 'fixture', version: 1, owner: { pluginId: 'second', version: '1.0.0' }, capabilities: { read: true } }, provider()))
    expect(failure).toBe('RESOURCE_VERSION_CONFLICT')
    expect(() => instance.register({ scheme: 'fixture', version: 1, owner: { pluginId: 'second', version: '1.0.0' }, capabilities: { read: true } }, provider())).toThrow(/first.*second/)
  })

  it('rejects provider protocol versions and schemes this host does not serve', async () => {
    const instance = registry()
    expect(codeOf(() => instance.register({ scheme: 'fixture', version: 2, capabilities: { read: true } }, provider()))).toBe('RESOURCE_UNSUPPORTED')
    expect(codeOf(() => instance.resolve('adr://v1/file/etc/passwd', { authority }))).toBe('RESOURCE_SCHEME_UNKNOWN')
    expect(codeOf(() => instance.resolve('not-a-resource', { authority }))).toBe('RESOURCE_INVALID_URI')
  })

  it('never falls back to another provider or the local filesystem after unregister', async () => {
    const instance = registry()
    instance.register({ scheme: 'fixture', version: 1, capabilities: { read: true } }, provider())
    instance.unregister('fixture')
    expect(codeOf(() => instance.resolve('adr://v1/fixture/a', { authority }))).toBe('RESOURCE_UNAVAILABLE')
    await expect(instance.read('adr://v1/fixture/a', { authority, deadline: 5000, signal: new AbortController().signal }))
      .rejects.toThrow(ResourceError)
  })

  it('reports unsupported operations instead of pretending they succeeded', async () => {
    const instance = registry()
    instance.register({ scheme: 'fixture', version: 1, capabilities: { read: true } }, provider())
    await expect(instance.write('adr://v1/fixture/a', { stream: chunked('x') }, { authority, deadline: 5000, signal: new AbortController().signal }))
      .rejects.toThrow(/write/)
    expect(codeOf(() => instance.register({ scheme: 'lying', version: 1, capabilities: { write: true } }, provider()))).toBe('RESOURCE_UNSUPPORTED')
  })

  it('authorizes scope and deadlines before the provider is touched', async () => {
    const instance = registry()
    const read = vi.fn(async () => ({ uri: 'adr://v1/fixture/a', version: '1', stream: chunked('body') }))
    instance.register({ scheme: 'fixture', version: 1, capabilities: { read: true } }, { read })
    const unauthorized = await instance.read('adr://v1/fixture/a?session=session-2', { authority, deadline: 5000, signal: new AbortController().signal }).catch(error => error as ResourceError)
    expect((unauthorized as ResourceError).code).toBe('RESOURCE_UNAUTHORIZED')
    const expired = await instance.read('adr://v1/fixture/a', { authority, deadline: 999, signal: new AbortController().signal }).catch(error => error as ResourceError)
    expect((expired as ResourceError).code).toBe('RESOURCE_DEADLINE_EXCEEDED')
    const controller = new AbortController(); controller.abort()
    const cancelled = await instance.read('adr://v1/fixture/a', { authority, deadline: 5000, signal: controller.signal }).catch(error => error as ResourceError)
    expect((cancelled as ResourceError).code).toBe('RESOURCE_CANCELLED')
    expect(read).not.toHaveBeenCalled()
  })
})
