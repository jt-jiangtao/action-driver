// @vitest-environment node
import { expect, test } from 'vitest'
import { createBrowserCommandDispatcher } from '../src/service-command-dispatch'

test('auth dispatcher forwards the current command release callback through security', async () => {
  let callback: (() => void) | undefined
  let released = 0
  const api = { addCloseListener: () => () => {} }
  const browser = { id: '1', info: { type: 'cdp' }, api }
  const dispatch = createBrowserCommandDispatcher({
    context: { get: async () => browser },
    credential: { assertHealthy() {}, gates: () => [], checkBroker: async () => {},
      beginCommand: () => () => { released++ }, isUnsafe: () => false },
    docs: { assertRequiredDocumentationRead() {} }, host: { env: {} },
    createBackend: () => ({ browserId: '1', clientInfo: browser.info, api,
      security: { runCommand: async (_command: unknown, run: Function) => await run(undefined) },
      tabLifecycle: { needsReclaim: () => false }, executeUnhandledCommand: async () => ({}) }),
    handlers: { tab_browser_auth_handoff: async (_params, _backend, _authorization, finish) => {
      callback = finish
      finish?.()
      return { status: 'submitted' }
    } }
  })
  expect(await dispatch({ type: 'tab_browser_auth_handoff', browser_id: '1', tab_id: '7' }))
    .toEqual({ status: 'submitted' })
  expect(typeof callback).toBe('function')
  expect(released).toBeGreaterThan(0)
})
