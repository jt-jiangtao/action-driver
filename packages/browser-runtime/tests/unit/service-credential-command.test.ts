// @vitest-environment node
import { test, expect } from 'vitest'
import { createCredentialCommandGuard } from '../../src/service-credential-command'
import { originalDocumentation } from '../original-service'
function fixture(used: boolean) {
  const calls: any[] = [],
    gate = {
      browserId: 'browser',
      usedNativeCredentials: used,
      observationEpoch: 7,
      assertRetainedObservationAllowed() {
        calls.push('retained')
      },
      async assertObservationAllowed(...args: any[]) {
        calls.push(['observe', ...args])
      },
      invalidateDocuments(id: any) {
        calls.push(['invalidate', id])
      }
    },
    host = {
      assertHealthy: () => calls.push('healthy'),
      gates: () => [gate],
      checkBroker: async () => calls.push('broker'),
      beginCommand: () => {
        calls.push('begin')
        return () => calls.push('finish')
      },
      isUnsafe: () => false
    }
  return { calls, host, gate }
}
test('credential command guard preserves observation ordering, navigation invalidation and id validation', async () => {
  const base = await originalDocumentation()
  for (const type of [
    'get_documentation',
    'create_tab',
    'navigate_tab_url',
    'close_tab',
    'tab_screenshot',
    'get_user_history',
    'tab_browser_auth_handoff'
  ])
    for (const used of [true, false])
      for (const result of [{ id: '2', extra: 'hidden' }, { id: 2 }, 'value']) {
        async function exercise(original: boolean) {
          const f = fixture(used)
          const run = async (command: any, finish: any) => {
              f.calls.push(['run', command, typeof finish])
              return result
            },
            resolve = async (id: any) => {
              f.calls.push(['resolve', id])
              return id
            }
          if (original) base.configureCredentialBoundaries(f.host)
          const guarded = original
            ? base.baselineCredentialCommandGuard(run, resolve)
            : createCredentialCommandGuard(run, f.host, resolve)
          let value, error
          try {
            value = await guarded({ type, browser_id: 'browser', tab_id: 2 })
          } catch (e: any) {
            error = e.message
          }
          return { value, error, calls: f.calls }
        }
        expect(await exercise(false)).toEqual(await exercise(true))
      }
})
test('failed operations repeat safety checks and always release command scope', async () => {
  const base = await originalDocumentation()
  for (const type of [
    'create_tab',
    'navigate_tab_back',
    'tab_browser_auth_handoff',
    'tab_screenshot'
  ]) {
    async function exercise(original: boolean) {
      const f = fixture(true)
      if (original) base.configureCredentialBoundaries(f.host)
      const run = async () => {
          throw Error('operation failed')
        },
        guarded = original
          ? base.baselineCredentialCommandGuard(run)
          : createCredentialCommandGuard(run, f.host)
      try {
        await guarded({ type, browser_id: 'browser', tab_id: 1 })
      } catch (e: any) {
        return { error: e.message, calls: f.calls }
      }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
test('native credential navigation suppresses observations after completion', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const f = fixture(false)
    if (original) base.configureCredentialBoundaries(f.host)
    const run = async () => {
        f.gate.usedNativeCredentials = true
        return { url: 'sensitive' }
      },
      guarded = original
        ? base.baselineCredentialCommandGuard(run)
        : createCredentialCommandGuard(run, f.host)
    return {
      result: await guarded({ type: 'navigate_tab_url', browser_id: 'browser', tab_id: 1 }),
      calls: f.calls
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('manual handoffs serialize globally while ordinary observations remain independent', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const f = fixture(false)
    if (original) base.configureCredentialBoundaries(f.host)
    let release!: () => void
    const wait = new Promise<void>((yes) => {
        release = yes
      }),
      order: string[] = []
    const run = async (command: any) => {
        order.push(command.label)
        if (command.label === 'first') await wait
        return command.label
      },
      guarded = original
        ? base.baselineCredentialCommandGuard(run)
        : createCredentialCommandGuard(run, f.host)
    const first = guarded({ type: 'tab_browser_auth_handoff', label: 'first' }),
      second = guarded({ type: 'tab_browser_auth_handoff', label: 'second' })
    for (let i = 0; i < 12; i++) await Promise.resolve()
    const before = [...order]
    release()
    return { before, results: await Promise.all([first, second]), order }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
