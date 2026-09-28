// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import { createComputerUsePolicy } from '../src/mac/policy'
import { ComputerUseError, ServerErrorCode } from '../src/mac/errors'
import { originalMacModule } from './original-mac-module'
function fixture(
  decision = 'allowed',
  answer: unknown = { action: 'accept', _meta: { persist: 'always' } },
  bundle = 'com.google.Chrome'
) {
  const trace: unknown[] = []
  const client = {
    getAppPolicy: async (app: string) => {
      trace.push({ policy: app })
      return {
        decision,
        allowPersistentApproval: true,
        target: {
          appPath: '/Applications/App.app',
          bundleIdentifier: bundle,
          displayName: 'App',
          risk: 'high',
          warningSubtitle: 'warning'
        }
      }
    }
  }
  const telemetry = {
    toolCalled: (e: unknown) => trace.push({ tool: e }),
    approvalRequested: (e: unknown) => trace.push({ requested: e }),
    approvalResolved: (e: unknown) => trace.push({ resolved: e }),
    clientCreated: () => {}
  }
  const host = {
    requestMeta: { 'x-codex-turn-metadata': JSON.stringify({ call_id: ' call ' }) },
    setResponseMeta: (e: unknown) => trace.push({ responseMeta: e }),
    createElicitation: async (e: unknown) => {
      trace.push({ approval: e })
      if (answer instanceof Error) throw answer
      return answer
    },
    withSuspendedTimeout: async <T>(fn: () => Promise<T>) => {
      trace.push('suspended')
      return fn()
    }
  }
  return { trace, client, telemetry, host }
}
const saved = Reflect.get(globalThis, 'nodeRepl')
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
  else Reflect.set(globalThis, 'nodeRepl', saved)
  Reflect.deleteProperty(globalThis, Symbol.for('cua-reference-client'))
  Reflect.deleteProperty(globalThis, Symbol.for('cua-reference-telemetry'))
})
async function execute(original: boolean, decision = 'allowed', answer?: unknown) {
  const f = fixture(decision, answer)
  Reflect.set(globalThis, 'nodeRepl', f.host)
  Reflect.set(globalThis, Symbol.for('cua-reference-client'), f.client)
  Reflect.set(globalThis, Symbol.for('cua-reference-telemetry'), f.telemetry)
  const own = createComputerUsePolicy({
    getClient: async () => f.client as never,
    getHost: () => f.host,
    telemetry: f.telemetry
  })
  const ref = original ? await originalMacModule('computer-use-policy.js') : undefined
  let outcome: unknown
  try {
    outcome = await (original ? ref.withComputerUsePolicy : own.withPolicy)(
      'click',
      { app: 'original', x: 1 },
      async (input: unknown) => {
        f.trace.push({ input, frozen: Object.isFrozen(input) })
        return 'ok'
      }
    )
  } catch (e) {
    outcome = (e as Error).message
  }
  return { trace: f.trace, outcome }
}
test.each(['allowed', 'denied', 'forbidden'])(
  '%s decision and approval sequence match original',
  async (decision) => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    vi.spyOn(performance, 'now').mockReturnValue(10)
    expect(await execute(false, decision)).toEqual(await execute(true, decision))
  }
)
test('unknown app-policy decision does not execute the approved operation, matching original', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  vi.spyOn(performance, 'now').mockReturnValue(10)
  const original = await execute(true, 'unrecognized')
  expect(original.outcome).not.toBe('ok')
  expect(original.trace.some((entry) => typeof entry === 'object' && entry !== null && 'input' in entry)).toBe(false)
  expect(await execute(false, 'unrecognized')).toEqual(original)
})
test.each([
  { action: 'cancel' },
  { action: 'decline' },
  { action: 'accept', content: { source: 'computer-use-persisted-state' } },
  new Error('approval failed')
])('approval resolution/error telemetry matches baseline', async (answer) => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  vi.spyOn(performance, 'now').mockReturnValue(10)
  expect(await execute(false, 'allowed', answer)).toEqual(await execute(true, 'allowed', answer))
})
test('input getters and inherited app are rejected without executing them or querying policy', async () => {
  const f = fixture()
  const policy = createComputerUsePolicy({
    getClient: async () => f.client as never,
    getHost: () => f.host,
    telemetry: f.telemetry
  })
  const getter = vi.fn(() => 'app')
  for (const value of [
    Object.create({ app: 'app' }),
    {
      get app() {
        return getter()
      }
    },
    {
      app: 'app',
      get text() {
        return getter()
      }
    }
  ])
    await expect(policy.withPolicy('click', value, async () => {})).rejects.toThrow(
      'plain data property'
    )
  expect(getter).not.toHaveBeenCalled()
  expect(f.trace.filter((x) => typeof x === 'object' && x !== null && 'policy' in x)).toEqual([])
})
test('tool telemetry classifies cancellation and clamps elapsed duration', async () => {
  const f = fixture()
  const policy = createComputerUsePolicy({
    getClient: async () => f.client as never,
    getHost: () => f.host,
    telemetry: f.telemetry
  })
  vi.spyOn(performance, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1e12)
    .mockReturnValueOnce(10)
    .mockReturnValueOnce(0)
  await expect(
    policy.withToolTelemetry('click', 'app', async () => {
      throw new ComputerUseError({
        code: ServerErrorCode.userIntervened,
        message: 'stop',
        request: null,
        requestType: 'action'
      })
    })
  ).rejects.toThrow('stop')
  await expect(
    policy.withToolTelemetry('click', 'app', async () => {
      throw new Error('failed')
    })
  ).rejects.toThrow('failed')
  expect(f.trace).toEqual([
    {
      tool: {
        bundleIdentifier: 'app',
        durationMs: 2147483647,
        terminalStatus: 'cancelled',
        toolName: 'click'
      }
    },
    {
      tool: { bundleIdentifier: 'app', durationMs: 0, terminalStatus: 'failed', toolName: 'click' }
    }
  ])
})
test('audio approval requires accept and carries tool metadata', async () => {
  const f = fixture('allowed', { action: 'decline' })
  const policy = createComputerUsePolicy({
    getClient: async () => f.client as never,
    getHost: () => f.host,
    telemetry: f.telemetry
  })
  await expect(policy.requestAudioApproval()).rejects.toThrow(
    'not approved to record computer audio'
  )
  expect(f.trace).toEqual([
    {
      approval: expect.objectContaining({
        message: 'Allow Computer Use to record computer audio?',
        meta: expect.objectContaining({
          tool_call_id: 'call',
          tool_name: 'start_audio_recording',
          persist: ['session'],
          riskLevel: 'high'
        })
      })
    }
  ])
})
test('required host helpers are checked before fetching app policy', async () => {
  const f = fixture()
  const policy = createComputerUsePolicy({
    getClient: async () => f.client as never,
    getHost: () => ({}),
    telemetry: f.telemetry
  })
  await expect(policy.withPolicy('click', { app: 'app' }, async () => {})).rejects.toThrow(
    'requires nodeRepl.createElicitation'
  )
  expect(f.trace).toEqual([])
})
test('approval waits cannot change captured app or action properties', async () => {
  const f = fixture()
  let accept!: (answer: { action: string }) => void
  f.host.createElicitation = async () =>
    new Promise((resolve) => {
      accept = resolve
    })
  const policy = createComputerUsePolicy({
    getClient: async () => f.client as never,
    getHost: () => f.host,
    telemetry: f.telemetry
  })
  const input = { app: 'original', text: 'captured' }
  const operation = vi.fn(async (approved) => approved)
  const pending = policy.withPolicy('type_text', input, operation)
  input.app = 'changed'
  input.text = 'changed'
  for (let i = 0; i < 5 && !accept; i++) await Promise.resolve()
  expect(operation).not.toHaveBeenCalled()
  accept({ action: 'accept' })
  expect(await pending).toEqual({ app: '/Applications/App.app', text: 'captured' })
  expect(Object.isFrozen(operation.mock.calls[0]![0])).toBe(true)
  expect(f.trace).toContainEqual({ policy: 'original' })
})
