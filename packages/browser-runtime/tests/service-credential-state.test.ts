// @vitest-environment node
import { test, expect } from 'vitest'
import { CredentialRegistry } from '../src/service-credential-state'
import { originalDocumentation } from './original-service'
import { EventEmitter } from 'node:events'
function transport() {
  const cdp: any = new EventEmitter()
  let loader = 'original'
  cdp.call = async () => ({ frameTree: { frame: { id: 'main', loaderId: loader } } })
  return {
    cdp,
    setLoader: (value: string) => {
      loader = value
    }
  }
}
async function fixture(original: boolean) {
  const base = await originalDocumentation(),
    registry = new CredentialRegistry(),
    state = original ? base.resetCredentialState() : registry,
    t = transport(),
    gate = original ? base.baselineCredentialGate('browser', t.cdp) : registry.get('browser', t.cdp)
  return { gate, registry, state, t }
}
async function error(run: () => unknown) {
  try {
    await run()
    return 'allowed'
  } catch (e: any) {
    return e.message
  }
}
test('native documents are blocked; newly navigated documents need an explicit matching permit', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      g = f.gate,
      result = []
    result.push(await error(() => g.assertObservationAllowed(1)))
    await g.protect(1)
    result.push(await error(() => g.assertObservationAllowed(1)))
    result.push(await error(() => g.permitNavigatedDocument(1, 'original', g.epoch)))
    f.t.setLoader('new')
    g.permitNavigatedDocument(1, 'new', g.epoch)
    result.push(await error(() => g.assertObservationAllowed(1)))
    f.t.setLoader('changed')
    result.push(await error(() => g.assertObservationAllowed(1)))
    return {
      result,
      epoch: g.epoch,
      observation: g.observationEpoch,
      used: g.usedNativeCredentials
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('navigation events invalidate permits and ignore stale/subframe sources', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      g = f.gate,
      remove = g.bindNavigationEvents(f.t.cdp)
    await g.protect(1)
    f.t.setLoader('new')
    g.permitNavigatedDocument(1, 'new', g.epoch)
    const result = []
    for (const event of [
      {
        method: 'Page.frameStartedNavigating',
        source: { tabId: 1, sessionId: 'nested' },
        params: { frameId: 'main' }
      },
      {
        method: 'Page.frameNavigated',
        source: { tabId: 1 },
        params: { frame: { id: 'child', parentId: 'main' } }
      },
      { method: 'Page.navigatedWithinDocument', source: { tabId: 1 }, params: { frameId: 'main' } }
    ]) {
      f.t.cdp.emit('event', event)
      result.push(await error(() => g.assertObservationAllowed(1)))
    }
    f.t.cdp.emit('tabDetached', 1)
    remove()
    return {
      result,
      epoch: g.epoch,
      observation: g.observationEpoch,
      listeners: f.t.cdp.listenerCount('event')
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('manual saving can permit ordinary interaction only for current epoch and recorded tab', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      g = f.gate,
      result = []
    await g.protectManualSaving(1)
    result.push(g.hasManualSavingTab(1))
    result.push(await error(() => g.allowOrdinaryInteraction(1, g.epoch - 1)))
    g.allowOrdinaryInteraction(1, g.epoch)
    result.push(g.hasManualSavingTab(1))
    result.push(await error(() => g.assertObservationAllowed(1)))
    g.invalidateDocuments(1)
    result.push(await error(() => g.assertObservationAllowed(1)))
    g.rebind(transport().cdp)
    result.push(await error(() => g.assertObservationAllowed(1)))
    return { result, epoch: g.epoch, observation: g.observationEpoch }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('protection waits outstanding observations and blocks new commands until protected', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      finish = f.state.beginCommand(),
      order: string[] = []
    const protect = f.gate.protect(1, () => order.push('release caller'))
    for (let i = 0; i < 5; i++) await Promise.resolve()
    const pending = f.gate.protectionPending,
      rejected = await error(() => f.state.beginCommand())
    finish()
    await protect
    return { pending, rejected, order, protected: f.gate.usedNativeCredentials }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('observation rechecks prevent navigation during a read and release scope on failure', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      g = f.gate
    await g.protect(1)
    f.t.setLoader('new')
    g.permitNavigatedDocument(1, 'new', g.epoch)
    const result = await error(() =>
      g.observe(async () => {
        g.invalidateDocuments(1)
        return 'sensitive'
      }, 1)
    )
    await g.protect(1)
    return { result, pending: g.protectionPending }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('protecting one browser invalidates observations retained by other browsers', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const registry = new CredentialRegistry()
    if (original) base.resetCredentialState()
    const a = original
        ? base.baselineCredentialGate('a', transport().cdp)
        : registry.get('a', transport().cdp),
      b = original
        ? base.baselineCredentialGate('b', transport().cdp)
        : registry.get('b', transport().cdp)
    await a.protect(1)
    return {
      a: [a.epoch, a.observationEpoch],
      b: [b.epoch, b.observationEpoch],
      retained: await error(() => a.assertRetainedObservationAllowed()),
      stale: await error(() => b.assertObservationAllowed(1, 0, false))
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('credential broker binding verifies ownership, session and resumable status fail closed', async () => {
  const base = await originalDocumentation()
  for (const status of [false, true, undefined])
    for (const ownership of ['true', 'false'])
      for (const session of ['session', '', 'x'.repeat(257)]) {
        async function exercise(original: boolean) {
          const registry = new CredentialRegistry(),
            state = original ? base.resetCredentialState() : registry,
            calls: any[] = [],
            host = {
              env: {
                BROWSER_AUTH_BROKER_CREDENTIAL_BINDING_VERSION: '1',
                ENABLE_BROWSER_SESSION_TAB_OWNERSHIP: ownership,
                BROWSER_AUTH_BROKER_SOCKET_PATH: '/run/codex-browser-auth/browser-auth-broker.sock'
              },
              requestMeta: { 'x-codex-turn-metadata': { session_id: session } },
              gaas: {
                getNativeCredentialObservationStatus: async (id: string) => {
                  calls.push(id)
                  return status
                }
              }
            }
          const initialize = await error(() =>
              original
                ? base.baselineInitializeCredentialBroker(host)
                : registry.initializeBroker(host, session)
            ),
            check = await error(() => state.checkBroker())
          return { initialize, check, calls }
        }
        expect(await exercise(false)).toEqual(await exercise(true))
      }
})
test('native document history limit and malformed loader fail with original protected state', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      results = []
    for (let i = 0; i < 65; i++) {
      f.t.setLoader('loader' + i)
      const result = await error(() => f.gate.protect(1))
      if (result !== 'allowed') results.push([i, result])
    }
    f.t.cdp.call = async () => ({ frameTree: { frame: { id: '', loaderId: 'missing' } } })
    results.push(await error(() => f.gate.readLoader(1)))
    return { results, pending: f.gate.protectionPending, used: f.gate.usedNativeCredentials }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
