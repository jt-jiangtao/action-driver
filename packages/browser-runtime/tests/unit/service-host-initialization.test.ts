// @vitest-environment node
import { test, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initializeBrowserHost,
  prepareBrowserHost,
  hostPreference
} from '../../src/service-host-initialization'
import { originalDocumentation } from '../original-service'
function fixture(env: Record<string, string> = {}) {
  const calls: unknown[] = []
  const host = {
    env,
    requestMeta: { value: 'initial' } as Record<string, unknown>,
    config: {
      readToml: async () => ({}),
      writeToml: async () => {},
      read: async () => ({}),
      readRequirements: async () => ({})
    },
    fetch: async () => {
      throw Error('unexpected network')
    },
    createElicitation: async function (this: unknown, params: any) {
      expect(this).toBe(host)
      return { action: 'accept', meta: { source: 'host' }, ...params }
    },
    setResponseMeta: (value: unknown) => calls.push(value),
    addTurnEndedHandler: () => {
      calls.push('hook')
      return () => calls.push('remove')
    }
  }
  return { host, calls }
}
test('prepared host preserves live metadata and normalizes elicitation results like original', async () => {
  const original = await originalDocumentation()
  for (const source of [original.baselinePrepareHost, prepareBrowserHost]) {
    const { host } = fixture()
    const prepared = await source(host)
    expect(prepared.requestMeta).toEqual({ value: 'initial' })
    host.requestMeta = { value: 'updated' }
    expect(prepared.requestMeta).toBe(host.requestMeta)
    expect(await prepared.createElicitation({})).toEqual({
      action: 'accept',
      _meta: { source: 'host' }
    })
    expect(await prepared.createElicitation({ _meta: { source: 'preferred' } })).toEqual({
      action: 'accept',
      _meta: { source: 'preferred' }
    })
    expect(prepared.setResponseMeta).toBe(host.setResponseMeta)
  }
})
test('GAAS config loading, broker availability and profile preferences match original', async () => {
  const original = await originalDocumentation(),
    dir = await mkdtemp(join(tmpdir(), 'browser-host-')),
    path = join(dir, 'config.json')
  try {
    await writeFile(path, JSON.stringify({ custom: true }))
    for (const configPath of [path, join(dir, 'missing')]) {
      const { host } = fixture({
        BROWSER_USE_SECURITY_MODE: ' gaas-browser-environment ',
        BROWSER_USE_CONFIG_PATH: configPath,
        BROWSER_AUTH_BROKER_SOCKET_PATH: ' socket '
      })
      const expected = await original.baselinePrepareHost(host),
        actual = await prepareBrowserHost(host)
      expect(actual.gaas.config).toEqual(expected.gaas.config)
      expect(actual.gaas.browserConfig).toEqual(expected.gaas.browserConfig)
      expect(typeof actual.gaas.getBrowserAuthBrokerChallenge).toBe('function')
      expect(typeof actual.gaas.getNativeCredentialObservationStatus).toBe('function')
    }
    for (const env of [
      {},
      { BROWSER_USE_PREFERRED_EXTENSION_INSTANCE_ID: ' id ' },
      {
        BROWSER_USE_PREFERRED_CHROME_EXTENSION_INSTANCE_ID: 'old',
        BROWSER_USE_PREFERRED_CHROME_WINDOW_ID: '2'
      },
      { BROWSER_USE_PREFERRED_EXTENSION_INSTANCE_ID: 'new', BROWSER_USE_PREFERRED_WINDOW_ID: '-1' }
    ]) {
      expect(hostPreference({ env })).toEqual(original.baselineHostPreference({ env }))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('initialization validates privileged host and macOS before installing hooks, and releases context on dispose', async () => {
  await expect(initializeBrowserHost(undefined)).rejects.toThrow('privileged Node REPL')
  const { host, calls } = fixture({
    BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1',
    BROWSER_USE_ACCESSIBILITY_CORE_WASM_PATH: ' relative.wasm '
  })
  await expect(initializeBrowserHost(host)).rejects.toThrow('must be absolute')
  expect(calls).toEqual([])
  host.env.BROWSER_USE_ACCESSIBILITY_CORE_WASM_PATH = '/tmp/core.wasm'
  await expect(initializeBrowserHost(host, { platform: 'linux' })).rejects.toThrow(
    'Unsupported browser backend platform'
  )
  expect(calls).toEqual([])
  const captures: unknown[] = [],
    reporter = {
      captureException: (error: unknown) => captures.push(error),
      setUser: () => {},
      setTag: () => {}
    }
  const result = await initializeBrowserHost(host, { platform: 'darwin', reporter: () => reporter })
  expect(result.config.global).toBeDefined()
  expect(result.filesystem.tmpDir).toBe(tmpdir())
  expect(calls).toEqual(['hook'])
  expect(result.requestMeta).toBe(host.requestMeta)
  await result.dispose()
  await result.dispose()
  expect(calls).toEqual(['hook', 'remove'])
})
test('credential binding fails closed before context creation when session ownership is absent', async () => {
  const { host, calls } = fixture({
    BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1',
    BROWSER_USE_SECURITY_MODE: 'gaas-browser-environment',
    BROWSER_AUTH_BROKER_CREDENTIAL_BINDING_VERSION: '1'
  })
  await expect(prepareBrowserHost(host)).rejects.toThrow(
    'native credential state cannot be safely resumed'
  )
  expect(calls).toEqual([])
})
test('trusted initialization routes caller identity failures to its captured reporter', async () => {
  const { browserTelemetry } = await import('../../src/service-telemetry')
  const { host } = fixture({ BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1' }),
    errors: unknown[] = []
  const reporter = {
    errors,
    captureException(error: unknown) {
      this.errors.push(error)
    },
    setUser: () => {},
    setTag: () => {}
  }
  const result = await initializeBrowserHost(host, { platform: 'darwin', reporter: () => reporter })
  try {
    delete host.env.BROWSER_USE_DISABLE_AMBIENT_NETWORK
    await browserTelemetry.updateUser(result, reporter)
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('unexpected network')
    await expect(browserTelemetry.requestHeader()).rejects.toThrow('unexpected network')
  } finally {
    await result.dispose()
  }
})
