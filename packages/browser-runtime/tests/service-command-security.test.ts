// @vitest-environment node
import { test, expect } from 'vitest'
import { CommandSecurity } from '../src/service-command-security'
import { originalDocumentation } from './original-service'
const timing = { trackElicitation: (run: any) => run }
function fixture(Type: any, options: any = {}) {
  const calls: any[] = [],
    tabs = {
      get: async (id: any) => {
        calls.push(['tab', id])
        return { url: options.url ?? 'https://example.com/path' }
      }
    },
    prefs = {
      getOriginPolicyDecision: async (url: any, action: any) => {
        calls.push(['policy', url, action])
        return options.policy ?? null
      },
      getOriginPermission: async () => ({
        decision: 'approve',
        scope: 'global',
        source: 'browser-use-persisted-state'
      }),
      getFileTransferPermission: async () => ({
        decision: 'approve',
        scope: 'global',
        source: 'browser-use-persisted-state'
      }),
      getFullCdpPermission: async () => ({
        decision: 'approve',
        scope: 'global',
        source: 'browser-use-persisted-state'
      }),
      getHistoryPermission: async () => ({
        decision: 'approve',
        scope: 'global',
        source: 'browser-use-persisted-state'
      }),
      getPersistedHistoryPermission: async () => ({
        decision: 'approve',
        scope: 'global',
        source: 'browser-use-persisted-state'
      }),
      captureOriginRequestContext: () => ({ guardianMode: 'v1' }),
      isAutoReviewDisabled: async () => false,
      isOriginAutoReviewDisabled: async () => false
    },
    host = {
      env: { BROWSER_USE_SECURITY_MODE: options.mode ?? '' },
      assertBrowserUrlAllowed: async (url: any) => calls.push(['host url', url]),
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      createElicitation: async () => {
        throw Error('unexpected prompt')
      }
    },
    security = new Type(
      tabs,
      'iab',
      prefs,
      host,
      timing,
      {},
      { openTabs: async () => [{ id: 1, url: 'https://example.com/user' }] }
    )
  return { security, calls }
}
test('command security authorizes scoped operations with original policy ordering and error reasons', async () => {
  const base = await originalDocumentation()
  for (const command of [
    { type: 'list_tabs', params: {} },
    { type: 'navigate_tab_url', params: { url: 'https://example.com' } },
    { type: 'tab_screenshot', params: { tab_id: '1' } },
    { type: 'browser_user_get_tab_context', params: { tab_id: '1' } },
    { type: 'browser_user_history', params: { limit: 5 } }
  ])
    for (const policy of [null, 'deny', 'unavailable']) {
      async function exercise(Type: any) {
        const f = fixture(Type, { policy })
        let value, error
        try {
          value = await f.security.runCommand(command, async (approved: any) => {
            f.calls.push(['execute', approved])
            return 'completed'
          })
        } catch (e: any) {
          error = { message: e.message, reason: e.reason }
        }
        return { value, error, calls: f.calls, active: [...f.security.activeCommandsByTabId] }
      }
      expect(await exercise(CommandSecurity)).toEqual(await exercise(base.BaselineCommandSecurity))
    }
})
test('file/full-CDP/asset security paths preserve source and destination policy checks', async () => {
  const base = await originalDocumentation()
  for (const operation of [
    'ensureDownloadSourcePolicyAllowed',
    'ensureFileUploadAllowed',
    'ensureFullCdpAllowed',
    'ensurePageAssetDownloadAllowed',
    'ensurePageAssetFallbackFetchAllowed',
    'ensureDownloadAllowed'
  ])
    for (const policy of [null, 'deny', 'unavailable'])
      for (const mode of ['', 'gaas-browser-environment', 'disabled-for-local-testing']) {
        async function exercise(Type: any) {
          const f = fixture(Type, { policy, mode }),
            args =
              operation === 'ensurePageAssetDownloadAllowed'
                ? ['https://example.com']
                : operation === 'ensurePageAssetFallbackFetchAllowed'
                  ? ['https://example.com', 'https://cdn.example.com']
                  : operation === 'ensureDownloadAllowed'
                    ? [1, 'https://cdn.example.com']
                    : [1]
          let error
          try {
            await f.security[operation](...args)
          } catch (e: any) {
            error = { message: e.message, reason: e.reason }
          }
          return { error, calls: f.calls }
        }
        expect(await exercise(CommandSecurity)).toEqual(
          await exercise(base.BaselineCommandSecurity)
        )
      }
})
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
test('navigation queue serializes by tab, waits active safety checks and recovers after failures', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type),
      gate = deferred<void>(),
      calls = f.calls
    f.security.startUrlPolicyCheck = () => gate.promise
    f.security.ensureUrlOriginConsentAllowed = async (url: any) => calls.push(['consent', url])
    f.security.activeCommandsByTabId.set(1, 1)
    const first = f.security.runNavigation(1, 'https://first.example', async () => {
        calls.push('first')
        throw Error('navigation')
      }),
      second = f.security.runNavigation(1, 'https://second.example', async () => {
        calls.push('second')
        return 'completed'
      })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    const before = [...calls]
    gate.resolve()
    const result = await Promise.allSettled([first, second])
    return {
      before,
      calls,
      result: result.map((item: any) =>
        item.status === 'fulfilled' ? item.value : item.reason.message
      ),
      pending: f.security.pendingNavigationsByTabId.size
    }
  }
  expect(await exercise(CommandSecurity)).toEqual(await exercise(base.BaselineCommandSecurity))
})
test('navigation validation rejects invalid inputs without allocating queues', async () => {
  const base = await originalDocumentation()
  for (const [id, url] of [
    [0, 'https://example.com'],
    [1, ''],
    [1.5, 'https://example.com']
  ]) {
    async function exercise(Type: any) {
      const f = fixture(Type)
      try {
        await f.security.runNavigation(id, url, () => {})
      } catch (e: any) {
        return { error: e.message, pending: f.security.pendingNavigationsByTabId.size }
      }
    }
    expect(await exercise(CommandSecurity)).toEqual(await exercise(base.BaselineCommandSecurity))
  }
})
