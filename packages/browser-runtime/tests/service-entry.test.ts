// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { originalService } from './original-service'
import { browserTelemetry } from '../src/service-telemetry'

test('candidate service entry matches original pre-setup RPC errors without initializing host', async () => {
  const candidate = await import('../src/service').catch(() => ({} as any)) as any
  expect(typeof candidate.handleRpc).toBe('function')
  const original = await originalService(async () => ({}), async () => ({}))
  for (const request of [
    { method: 'execute', params: { type: 'get_tab' } },
    { method: 'constructor', params: {} },
    { method: 'unknown', params: {} }
  ]) {
    async function exercise(run: any) {
      try { return await run(request) }
      catch (cause) { return cause instanceof Error ? cause.message : String(cause) }
    }
    expect(await exercise(candidate.handleRpc)).toEqual(await exercise(original))
  }
})

test('candidate service setup and global browser listing run through the privileged macOS host', async () => {
  const { handleRpc } = await import('../src/service')
  const previous = (globalThis as any).nodeRepl
  const calls: string[] = []
  const log = vi.spyOn(browserTelemetry, 'logEvent').mockImplementation((_host, name) => {
    calls.push(`telemetry:${name}`)
  })
  const host = {
    env: { BROWSER_USE_BACKEND_PATHS: '', BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1' },
    requestMeta: { 'x-codex-turn-metadata': JSON.stringify({ session_id: 'session', turn_id: 'turn' }) },
    config: { readToml: async () => ({}), writeToml: async () => {},
      read: async () => ({}), readRequirements: async () => ({}) },
    fetch: async () => { throw Error('unexpected network') },
    createElicitation: async () => ({ action: 'accept' }),
    setResponseMeta: () => {},
    addAfterSubmittedCodeHook: (hook: { timeoutMs: number }) => {
      calls.push(`submitted:${hook.timeoutMs}`)
      return () => calls.push(`remove-submitted:${hook.timeoutMs}`)
    },
    addTurnEndedHandler: () => { calls.push('hook'); return () => calls.push('remove') }
  }
  ;(globalThis as any).nodeRepl = host
  try {
    const setup = await handleRpc({ method: 'setup', params: { environment: 'codex-app' } }) as any
    expect(setup.apiManifest.root).toBe('Agent')
    expect(setup.disabledMemberIds).toEqual([])
    expect(await handleRpc({ method: 'execute', params: { type: 'list_browsers' } })).toEqual([])
    expect(calls.filter((item) => !item.startsWith('telemetry:')))
      .toEqual(['hook', 'submitted:10000', 'submitted:12000'])
    await handleRpc({ method: 'setup', params: { environment: 'codex-app' } })
    expect(calls.filter((item) => item === 'hook')).toHaveLength(2)
    expect(calls.filter((item) => item === 'remove')).toHaveLength(1)
    expect(calls.filter((item) => item.startsWith('remove-submitted:'))).toEqual([
      'remove-submitted:10000', 'remove-submitted:12000'
    ])
    expect(calls.lastIndexOf('telemetry:browser_use_invocation_started'))
      .toBeLessThan(calls.indexOf('remove'))
  } finally {
    log.mockRestore()
    ;(globalThis as any).nodeRepl = previous
  }
})

test('overlapping setup releases every superseded host hook', async () => {
  const { handleRpc } = await import('../src/service')
  const previous = (globalThis as any).nodeRepl
  const active = new Set<symbol>()
  const host = {
    env: { BROWSER_USE_BACKEND_PATHS: '', BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1' },
    requestMeta: { 'x-codex-turn-metadata': JSON.stringify({ session_id: 'session', turn_id: 'turn' }) },
    config: { readToml: async () => ({}), writeToml: async () => {},
      read: async () => ({}), readRequirements: async () => ({}) },
    fetch: async () => { throw Error('unexpected network') },
    createElicitation: async () => ({ action: 'accept' }),
    setResponseMeta: () => {},
    addAfterSubmittedCodeHook: () => {
      const id = Symbol('after-submission')
      active.add(id)
      return () => active.delete(id)
    },
    addTurnEndedHandler: () => {
      const id = Symbol('turn-end')
      active.add(id)
      return () => active.delete(id)
    }
  }
  ;(globalThis as any).nodeRepl = host
  try {
    await Promise.all([
      handleRpc({ method: 'setup', params: { environment: 'codex-app' } }),
      handleRpc({ method: 'setup', params: { environment: 'codex-app' } })
    ])
    expect(active.size).toBe(3)
  } finally {
    ;(globalThis as any).nodeRepl = previous
  }
})
