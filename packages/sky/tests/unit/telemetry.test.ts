// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createComputerUseTelemetry } from '../../src/mac/telemetry'
const saved = Reflect.get(globalThis, 'nodeRepl')
afterEach(() => {
  vi.useRealTimers()
  if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
  else Reflect.set(globalThis, 'nodeRepl', saved)
  Reflect.deleteProperty(globalThis, Symbol.for('cua-reference-statsig'))
})
function fixture(
  env: Record<string, string> = {},
  meta: unknown = {
    thread_id: ' thread ',
    turn_id: 'turn',
    call_id: 'call',
    model: 'model',
    reasoning_effort: ' high '
  }
) {
  const trace: unknown[] = []
  class Client {
    constructor(key: string, user: unknown, options: unknown) {
      trace.push({ create: { key, user, options } })
    }
    async initializeAsync() {
      trace.push('initialize')
    }
    updateUserSync(user: unknown) {
      trace.push({ user })
    }
    logEvent(event: unknown) {
      trace.push({ event })
    }
  }
  const sdk = {
    StatsigMetadataProvider: { add: (metadata: unknown) => trace.push({ metadata }) },
    StatsigClient: Client
  }
  const host = {
    config: {},
    env: {
      BROWSER_USE_CODEX_APP_BUILD_FLAVOR: 'nightly',
      BROWSER_USE_CODEX_APP_VERSION: ' 1.0 ',
      NODE_REPL_SENTRY_USER_ID: ' user ',
      ...env
    },
    requestMeta: { 'x-codex-turn-metadata': meta },
    fetch: async (url: unknown) => {
      trace.push({ fetch: url })
      return { json: async () => ({ object: 'user', id: 'id', email: 'email' }) }
    }
  }
  return { sdk, host, trace }
}
async function originalTelemetry(sdk: unknown, variant: 'sky' | 'cua' = 'sky') {
  Reflect.set(globalThis, Symbol.for('cua-reference-statsig'), sdk)
  let source = await readFile(
    resolve(
      `packages/back/codex-cua/@oai/${variant}/dist/project/cua/sky_js/src/targets/mac/computer-use-telemetry.js`
    ),
    'utf8'
  )
  const bridge =
    'export const StatsigMetadataProvider=globalThis[Symbol.for("cua-reference-statsig")].StatsigMetadataProvider;export const StatsigClient=globalThis[Symbol.for("cua-reference-statsig")].StatsigClient'
  const uuid = 'export const randomUUID=()=>"fixed-id"'
  source = source
    .replace(
      'from"@statsig/js-client"',
      `from "data:text/javascript;base64,${Buffer.from(bridge).toString('base64')}"`
    )
    .replace(
      'from"node:crypto"',
      `from "data:text/javascript;base64,${Buffer.from(uuid).toString('base64')}"`
    )
  source = source.replace(
    /from"[^"]*_virtual\/index.js"/,
    `from "data:text/javascript;base64,${Buffer.from('export const s=globalThis[Symbol.for("cua-reference-statsig")]').toString('base64')}"`
  )
  const tslib = await readFile(
    resolve(
      'packages/back/codex-cua/@oai/sky/dist/lib/js/oai_js/node_modules/tslib/tslib.es6.js'
    ),
    'utf8'
  )
  source = source.replace(
    /from"[^"]*tslib.es6.js"/,
    `from "data:text/javascript;base64,${Buffer.from(tslib).toString('base64')}"`
  )
  return import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64') + '#' + Math.random()
  )
}
function normalize(trace: unknown[]) {
  return trace.map((e) =>
    e && typeof e === 'object' && 'create' in e
      ? {
          create: {
            ...(e as any).create,
            options: {
              ...(e as any).create.options,
              networkConfig: {
                ...(e as any).create.options.networkConfig,
                networkOverrideFunc: 'function'
              }
            }
          }
        }
      : e
  )
}
test('event composition, initialization, user enrichment and single launch event match original', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  async function run(reference: false | 'sky' | 'cua') {
    const f = fixture()
    Reflect.set(globalThis, 'nodeRepl', f.host)
    const ref = reference ? await originalTelemetry(f.sdk, reference) : undefined
    const own = createComputerUseTelemetry({
      getHost: () => f.host,
      getSdk: () => f.sdk,
      eventId: () => 'fixed-id'
    })
    const sink = reference
      ? {
          clientCreated: ref.logComputerUseClientCreated,
          approvalRequested: ref.logComputerUseApprovalRequested,
          approvalResolved: ref.logComputerUseApprovalResolved,
          toolCalled: ref.logComputerUseToolCalled
        }
      : own
    sink.clientCreated()
    sink.clientCreated()
    sink.approvalRequested({
      bundleIdentifier: 'app',
      toolName: 'click',
      eventCreatedAt: 'earlier'
    })
    sink.approvalResolved({
      bundleIdentifier: 'app',
      toolName: 'click',
      approvalResult: 'accepted',
      approvalPersistence: 'always'
    })
    sink.toolCalled({
      bundleIdentifier: 'app',
      toolName: 'click',
      durationMs: 10,
      terminalStatus: 'failed'
    })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    return normalize(f.trace)
  }
  const own = await run(false)
  expect(own).toEqual(await run('sky'))
  expect(own).toEqual(await run('cua'))
})
test.each(['NODE_REPL_DISABLE_ANALYTICS', 'BROWSER_USE_DISABLE_AMBIENT_NETWORK'])(
  '%s prevents SDK initialization and network',
  (flag) => {
    const f = fixture({ [flag]: '1' })
    const getSdk = vi.fn(() => f.sdk)
    const sink = createComputerUseTelemetry({ getHost: () => f.host, getSdk })
    sink.clientCreated()
    sink.toolCalled({ toolName: 'click', durationMs: 1, terminalStatus: 'completed' })
    expect(f.trace).toEqual([])
    expect(getSdk).not.toHaveBeenCalled()
  }
)
test('unavailable host defers launch event until enabled and metadata malformed is omitted', () => {
  const f = fixture({}, '{invalid')
  let enabled = false
  const sink = createComputerUseTelemetry({
    getHost: () => (enabled ? f.host : undefined),
    getSdk: () => f.sdk,
    eventId: () => 'id'
  })
  sink.clientCreated()
  expect(f.trace).toEqual([])
  enabled = true
  sink.clientCreated()
  sink.clientCreated()
  sink.toolCalled({ toolName: 'click', durationMs: 1, terminalStatus: 'completed' })
  const events = f.trace.filter((x) => typeof x === 'object' && x !== null && 'event' in x) as any[]
  expect(events).toHaveLength(2)
  expect(events[1].event.metadata.eventParams).not.toHaveProperty('threadId')
  expect(events[1].event.metadata.eventParams.mcpErrorPresent).toBe(false)
})
test('SDK and logging failures never escape or mark launch sent', () => {
  let attempts = 0
  const f = fixture()
  const sink = createComputerUseTelemetry({
    getHost: () => f.host,
    getSdk: () => {
      attempts++
      throw new Error('SDK unavailable')
    }
  })
  expect(() => sink.clientCreated()).not.toThrow()
  expect(() => sink.clientCreated()).not.toThrow()
  expect(attempts).toBe(2)
})
