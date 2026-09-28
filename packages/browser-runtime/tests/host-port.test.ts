// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createGuardedBrowserHost } from '../src/host-port'
import { initializeBrowserRuntime } from '../src/runtime-initialization'

const manifest = { interfaces: {} }

test('generic browser package does not export the ActionDriver Chrome launcher', async () => {
  const api = await import('../src/index')
  expect(api).toHaveProperty('setupBrowserRuntime')
  expect(api).not.toHaveProperty('createLocalBrowserHost')
})

test('requires explicit ActionDriver host even when a private global exists', async () => {
  const rpc = vi.fn()
  vi.stubGlobal('nodeRepl', { rpc })
  try {
    await expect(initializeBrowserRuntime({}, () => ({}))).rejects.toThrow('BROWSER_HOST_UNAVAILABLE')
    expect(rpc).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('routes setup and execution through an explicit guarded host and rejects after close', async () => {
  const setup = vi.fn(async () => ({ apiManifest: manifest, disabledMemberIds: [] }))
  const execute = vi.fn(async () => ({ ok: true }))
  const close = vi.fn(async () => {})
  const host = createGuardedBrowserHost({ setup, execute, close, displayImage: vi.fn() })
  let command: ((input: Record<string, unknown>) => Promise<unknown>) | undefined
  const result = await initializeBrowserRuntime({ host, environment: 'training' }, (options) => {
    command = options.executeAgentCommand
    return options.apiManifest
  })
  expect(result).toEqual(manifest)
  expect(setup).toHaveBeenCalledWith({
    environment: 'training',
    undocumentedApiMembers: undefined,
    excludedDocumentation: undefined
  })
  expect(await command!({ type: 'list_browsers' })).toEqual({ ok: true })
  expect(execute).toHaveBeenCalledWith({ type: 'list_browsers' })
  await host.close()
  await expect(command!({ type: 'list_browsers' })).rejects.toThrow('BROWSER_HOST_CLOSED')
  expect(close).toHaveBeenCalledTimes(1)
})
