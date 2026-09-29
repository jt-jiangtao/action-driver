// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'

const own = async () => (await import('../../src/service-extra-commands').catch(() => ({} as any)) as any).extraCommandHandlers

test('user-tab, history, dev-log and page-asset command adapters match original outputs and calls', async () => {
  const base = await originalDocumentation(), handlers = await own()
  const entries = [
    ['browser_user_claim_tab', base.baselineBrowserUserClaim, { tab_id: 3 }],
    ['browser_user_get_tab_context', base.baselineBrowserUserContext, { tab_id: 3, expected_url: 'https://example.test/' }],
    ['browser_user_get_tab_context', base.baselineBrowserUserContext, { tab_id: 3 }],
    ['browser_user_history', base.baselineBrowserUserHistory, { queries: ['one'], limit: 2, from: '2024-01-01' }],
    ['browser_user_history', base.baselineBrowserUserHistory, { queries: [] }],
    ['browser_user_open_tabs', base.baselineBrowserUserOpenTabs, {}],
    ['tab_dev_logs', base.baselineDevLogs, { tab_id: 3, levels: ['warn'], filter: 'x', limit: 2 }],
    ['tab_page_assets_bundle', base.baselineAssetsBundle, { tab_id: 3, assetIds: ['a'], inventoryId: 'i', kinds: ['image'] }],
    ['tab_page_assets_list', base.baselineAssetsList, { tab_id: 3 }]
  ] as const
  async function exercise(run: any, params: object) {
    const calls: unknown[] = []
    const context = {
      browserUser: {
        claimTab: async (id: number) => { calls.push(['claim', id]); return { id, title: 'T', url: 'https://example.test/' } },
        getTabContext: async (...args: unknown[]) => { calls.push(['context', ...args]); return { kind: 'text', text: 'Page' } },
        openTabs: async () => [{ id: 3, providerTabId: 'provider', title: 'T', url: 'https://example.test/', lastOpened: 123 }]
      },
      tabLifecycle: { recordAcquired: (id: number) => calls.push(['acquired', id]) },
      history: async (options: unknown) => { calls.push(['history', options]); return [{ url: 'https://example.test/', title: 'T', dateVisited: '2024-01-01' }] },
      dev: { logs: async (options: unknown) => { calls.push(['logs', options]); return [{ level: 'warn', message: 'x', timestamp: '2024-01-01' }] } },
      tabs: { get: async (id: number) => { calls.push(['tab', id]); return { id, url: 'https://example.test/' } } },
      pageAssets: {
        bundle: async (value: unknown) => { calls.push(['bundle', value]); return { path: '/tmp/a' } },
        list: async (value: unknown) => { calls.push(['list', value]); return { assets: [] } }
      }
    }
    let result: unknown, error: string | undefined
    try { result = await run(params, context) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    return { result, error, calls }
  }
  for (const [name, original, params] of entries)
    expect(await exercise(handlers?.[name], params)).toEqual(await exercise(original, params))
})
