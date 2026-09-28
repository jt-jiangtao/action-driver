// @vitest-environment node
import { test, expect } from 'vitest'
import { ServiceTabs, BrowserUi } from '../src/service-tabs'
import { originalDocumentation } from './original-service'
test('service tabs preserve preferred window, tab identity, missing/active errors and mark forwarding', async () => {
  const base = await originalDocumentation()
  for (const tabs of [
    [],
    [{ id: 1, title: 'Title', url: 'https://example.com' }],
    [
      { id: 1, active: true },
      { id: 2, title: '', url: '' }
    ]
  ]) {
    async function exercise(Type: any) {
      const calls: any[] = [],
        api = {
          createTab: async (window: any) => {
            calls.push(['create', window])
            return { id: 3 }
          },
          getTabs: async () => tabs,
          markTab: async (...args: any[]) => calls.push(['mark', ...args])
        },
        service = new Type(api, 7),
        results: any[] = []
      for (const run of [
        () => service.create(),
        () => service.list(),
        () => service.get(1),
        () => service.get(99),
        () => service.getActive(),
        () => service.mark(1, 'kept')
      ])
        try {
          results.push(await run())
        } catch (e: any) {
          results.push(e.message)
        }
      return { results, calls }
    }
    expect(await exercise(ServiceTabs)).toEqual(await exercise(base.BaselineServiceTabs))
  }
})
test('browser UI ignores unavailable cursor errors and forwards wait-for-arrival false only when requested', async () => {
  const base = await originalDocumentation()
  for (const options of [{}, { waitForArrival: true }, { waitForArrival: false }])
    for (const fails of [false, true]) {
      async function exercise(Type: any) {
        const calls: any[] = [],
          ui = new Type({
            moveMouse: (params: any) => {
              calls.push(params)
              return fails ? Promise.reject(Error('unavailable')) : Promise.resolve('moved')
            }
          })
        await ui.moveMouse(1, 10, 20, options)
        await Promise.resolve()
        return calls
      }
      expect(await exercise(BrowserUi)).toEqual(await exercise(base.BaselineBrowserUi))
    }
})
