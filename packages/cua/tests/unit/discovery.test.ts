// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { resolve } from 'node:path'
import { originalModule } from '../original-module'
import { getApps, getBrowserTabs, getState } from '../../src/discovery'
const root = resolve('packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_cua/src')
test('application normalization matches Linux and preserves Mac results', async () => {
  const ref = await originalModule(resolve(root, 'get_apps.js'))
  for (const target of ['linux', 'mac', 'windows'] as const) {
    const computer = { target, list_apps: async () => [{ id: 'a', name: 'App', windows: [] }] }
    expect(await getApps(computer)).toEqual(await ref.get_apps!(computer))
  }
  await expect(getApps({ target: 'other', list_apps: async () => [] })).rejects.toMatchObject({
    name: 'UnreachableCaseError'
  })
})
test('controlled tabs override duplicate user tabs without losing order', async () => {
  const ref = await originalModule(resolve(root, 'get_browser_tabs.js'))
  const browser = {
    user: { openTabs: async () => [{ id: '1', title: 'user' }, { id: '2' }] },
    tabs: { list: async () => [{ id: '1', title: 'controlled' }, { id: '3' }] }
  }
  expect(await getBrowserTabs(browser)).toEqual(await ref.get_browser_tabs!(browser))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const failed = {
      ...browser,
      user: {
        openTabs: async () => {
          throw new Error('offline')
        }
      }
    }
    expect(await getBrowserTabs(failed)).toEqual(await ref.get_browser_tabs!(failed))
  } finally {
    log.mockRestore()
  }
})
test('discovery returns partial results and named errors', async () => {
  const ref = await originalModule(resolve(root, 'get_state.js'))
  const input = {
    computer: {
      target: 'mac',
      list_apps: async () => {
        throw new Error('offline')
      }
    },
    browsers: {
      list: async () => [{ id: 'b' }],
      get: async () => ({ tabs: { list: async () => [{ id: 't' }] } })
    }
  }
  expect(await getState(input)).toEqual(await ref.get_state!(input))
  expect(await getState({})).toEqual({ apps: [], browsers: [] })
})
