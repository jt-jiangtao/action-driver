import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServiceHttpServer, type ServiceHttpServer } from '../src/service/http-service'
import { RuntimeSkillRegistry } from '../src/skill-registry'
import { SkillProviderHost } from '../../desktop/src/main/skill-provider-host'
import { connectLocalCapabilityHost } from '../../desktop/src/main/local-capability-client'
import { VolatileComputerImages } from '../src/computer-use/volatile-images'

let server: ServiceHttpServer | undefined
let client: { close(): void } | undefined
afterEach(async () => { client?.close(); await server?.close(); client = undefined; server = undefined })

async function setup(host: SkillProviderHost, images?: VolatileComputerImages) {
  const registry = new RuntimeSkillRegistry()
  server = await startServiceHttpServer({
    service: {} as never, token: 'local-secret', runtimeVersion: 'test', skillRegistry: registry,
    ...(images ? { computerImages: images } : {})
  })
  client = await connectLocalCapabilityHost({ baseUrl: server.url, token: 'local-secret', host })
  await vi.waitFor(() => expect(() => registry.resolve(host.hasSkill('browser-use') ? 'browser-use' : 'computer-use', 1)).not.toThrow())
  return registry
}

describe('local capability port', () => {
  it('transports screenshot chunks into volatile memory and returns only a handle', async () => {
    const images = new VolatileComputerImages()
    const bytes = Buffer.from('jpeg bytes')
    const host = new SkillProviderHost()
    host.register({ providerId: 'native.computer-use', providerVersion: '1', skillId: 'computer-use',
      execute: async () => ({ mimeType: 'image/jpeg', width: 10, height: 5,
        base64: bytes.toString('base64'), observationId: 'obs-1' }) })
    const registry = await setup(host, images)
    const response = await registry.resolve('computer-use', 1).execute({
      invocationId: 'capture-1', input: { operation: 'capture', maxWidth: 10, maxHeight: 5 }
    })
    const result = response.input as { base64?: string; screenshot: Parameters<typeof images.read>[0] }
    expect(JSON.stringify(response)).not.toContain(bytes.toString('base64'))
    expect(result.base64).toBeUndefined()
    expect(images.read(result.screenshot).bytes).toEqual(bytes)
  })
  it('dispatches an advertised provider once and rejects a duplicate invocation ID', async () => {
    const execute = vi.fn(async (input: unknown) => ({ input }))
    const host = new SkillProviderHost()
    host.register({ providerId: 'real.browser', providerVersion: '1', skillId: 'browser-use', execute })
    const registry = await setup(host)
    const provider = registry.resolve('browser-use', 1)
    await expect(provider.execute({ invocationId: 'one', input: { url: 'https://example.com' } }))
      .resolves.toMatchObject({ ok: true, providerId: 'real.browser', input: { input: { url: 'https://example.com' } } })
    await expect(provider.execute({ invocationId: 'one', input: {} })).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('cancels Main execution and ignores a late success', async () => {
    let finish!: (value: unknown) => void
    const aborted = vi.fn()
    const host = new SkillProviderHost()
    host.register({ providerId: 'real.browser', providerVersion: '1', skillId: 'browser-use',
      execute: (_input, signal) => new Promise((resolve) => {
        finish = resolve
        signal?.addEventListener('abort', aborted)
      }) })
    const registry = await setup(host)
    const controller = new AbortController()
    const task = registry.resolve('browser-use', 1).execute({ invocationId: 'slow', input: {} }, controller.signal)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    controller.abort()
    await expect(task).rejects.toThrow('SKILL_TIMEOUT')
    await vi.waitFor(() => expect(aborted).toHaveBeenCalledTimes(1))
    finish({ late: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(registry.resolve('browser-use', 1).execute({ invocationId: 'slow', input: {} }))
      .rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })

  it('unregisters providers on disconnect', async () => {
    const host = new SkillProviderHost()
    host.register({ providerId: 'real.browser', providerVersion: '1', skillId: 'browser-use',
      execute: async () => ({}) })
    const registry = await setup(host)
    client?.close()
    await vi.waitFor(() => expect(() => registry.resolve('browser-use', 1))
      .toThrow('CAPABILITY_UNAVAILABLE'))
  })

  it('rejects a wrong token before a host can register providers', async () => {
    const registry = new RuntimeSkillRegistry()
    server = await startServiceHttpServer({
      service: {} as never, token: 'local-secret', runtimeVersion: 'test', skillRegistry: registry
    })
    const host = new SkillProviderHost()
    host.register({ providerId: 'real.browser', providerVersion: '1', skillId: 'browser-use',
      execute: async () => ({}) })
    await expect(connectLocalCapabilityHost({
      baseUrl: server.url, token: 'wrong-secret', host
    })).rejects.toThrow('403')
    expect(() => registry.resolve('browser-use', 1)).toThrow('CAPABILITY_UNAVAILABLE')
  })

  it('ends an in-flight invocation when Main disconnects', async () => {
    let started!: () => void
    const executionStarted = new Promise<void>((resolve) => { started = resolve })
    const host = new SkillProviderHost()
    host.register({ providerId: 'real.browser', providerVersion: '1', skillId: 'browser-use',
      execute: async () => {
        started()
        return await new Promise(() => undefined)
      } })
    const registry = await setup(host)
    const task = registry.resolve('browser-use', 1).execute({ invocationId: 'disconnect', input: {} })
    await executionStarted
    client?.close()
    await expect(task).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })
})
