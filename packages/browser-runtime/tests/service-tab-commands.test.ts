// @vitest-environment node
import { test, expect } from 'vitest'
import { tabCommandHandlers } from '../src/service-tab-commands'
import { originalDocumentation } from './original-service'
test('tab handlers preserve native IDs, credential redaction and acquisition/creation events', async () => {
  const base = await originalDocumentation()
  const commands = {
    close_tab: base.baselineCloseTab,
    create_tab: base.baselineCreateTab,
    get_tab: base.baselineGetTab,
    list_tabs: base.baselineListTabs,
    mark_tab: base.baselineMarkTab,
    name_session: base.baselineNameSession,
    selected_tab: base.baselineSelectedTab
  }
  for (const redacted of [true, false])
    for (const [type, original] of Object.entries(commands)) {
      async function exercise(run: any) {
        const calls: any[] = [],
          tab = { id: 3, title: 'secret', url: 'https://example.com', providerTabId: 'provider' },
          context = {
            tabs: {
              create: async () => tab,
              get: async () => tab,
              list: async () => [tab],
              mark: async (...args: any[]) => calls.push(['mark', ...args]),
              getActive: async () => tab
            },
            cdp: { closeTab: async (...args: any[]) => calls.push(['close', ...args]) },
            tabLifecycle: {
              recordAcquired: (id: number) => calls.push(['acquired', id]),
              recordCreated: (id: number) => calls.push(['created', id])
            },
            credentialObservationGate: { hasManualSavingTab: () => redacted },
            nameSession: async (name: string) => calls.push(['name', name])
          }
        const result = await run({ tab_id: 3, name: ' name ', status: 'active' }, context)
        return { result, calls }
      }
      expect(await exercise(tabCommandHandlers[type as keyof typeof tabCommandHandlers])).toEqual(
        await exercise(original)
      )
    }
})
test('history navigation chooses adjacent entry and reports missing entry without dispatch', async () => {
  const base = await originalDocumentation(),
    commands = {
      navigate_tab_back: base.baselineNavigateBack,
      navigate_tab_forward: base.baselineNavigateForward,
      navigate_tab_reload: base.baselineReload
    }
  for (const missing of [true, false])
    for (const [type, original] of Object.entries(commands)) {
      async function exercise(run: any) {
        const calls: any[] = []
        const context = {
          cdp: {
            call: async (...args: any[]) => {
              calls.push(args)
              return { currentIndex: 1, entries: missing ? [] : [{ id: 7 }, { id: 8 }, { id: 9 }] }
            },
            waitForPageLoadEvent: async (...args: any[]) => calls.push(['load', ...args])
          }
        }
        let result, error
        try {
          result = await run({ tab_id: 3, timeout_ms: 123 }, context)
        } catch (e: any) {
          error = e.message
        }
        return { result, error, calls }
      }
      expect(await exercise(tabCommandHandlers[type as keyof typeof tabCommandHandlers])).toEqual(
        await exercise(original)
      )
    }
})
