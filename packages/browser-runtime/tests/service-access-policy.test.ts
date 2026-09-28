// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserPreferences } from '../src/service-preferences'
import { originalDocumentation } from './original-service'
function config(data: any = {}, requirements: any = {}, all: any = { config: {} }, fail = false) {
  return {
    global: {
      get: async (name: string) => {
        if (fail) throw Error('config')
        return data[name]
      }
    },
    readRequirements: async () => {
      if (fail) throw Error('requirements')
      return requirements
    },
    readAll: async () => {
      if (fail) throw Error('all')
      return all
    }
  }
}
test('full CDP access requires feature and enterprise permission with original disable reasons', async () => {
  const base = await originalDocumentation()
  for (const mode of ['', 'gaas-browser-environment'])
    for (const enabled of [undefined, false, true])
      for (const feature of ['0', '1'])
        for (const enterprise of [undefined, false, true])
          for (const fail of [false, true]) {
            const conf = config(
                { full_cdp_access_enabled: enabled },
                {
                  requirements: { featureRequirements: { browser_use_full_cdp_access: enterprise } }
                },
                undefined,
                fail
              ),
              host = {
                env: {
                  BROWSER_USE_SECURITY_MODE: mode,
                  BROWSER_USE_FULL_CDP_ACCESS_ENABLED: feature
                }
              },
              a = new BrowserPreferences(conf as any, host),
              b = new base.BaselinePreferences(conf, host)
            expect(await a.fullCdpAccessState()).toEqual(await b.fullCdpAccessState())
            expect(await a.isFullCdpEnabled()).toBe(await b.isFullCdpEnabled())
            let expected
            try {
              await b.assertFullCdpEnabled()
            } catch (e: any) {
              expected = e.message
            }
            if (expected) await expect(a.assertFullCdpEnabled()).rejects.toThrow(expected)
            else await a.assertFullCdpEnabled()
          }
})
test('WebMCP and auto-review flags preserve defaults and failure behavior', async () => {
  const base = await originalDocumentation()
  for (const value of [undefined, false, true, 'invalid'])
    for (const enterprise of [undefined, false, true])
      for (const fail of [false, true]) {
        const conf = config(
            { webmcp_enabled: value, disable_auto_review: value },
            { requirements: { browserUse: { disableAutoReview: enterprise } } },
            undefined,
            fail
          ),
          host = { env: {} },
          a = new BrowserPreferences(conf as any, host),
          b = new base.BaselinePreferences(conf, host)
        expect(await a.isWebMcpEnabled()).toBe(await b.isWebMcpEnabled())
        expect(await a.isAutoReviewDisabled()).toBe(await b.isAutoReviewDisabled())
      }
})
test('history enterprise/user limits dominate persisted global approvals and unavailable policies deny', async () => {
  const base = await originalDocumentation()
  for (const type of ['iab', 'extension', 'cdp'])
    for (const persisted of [undefined, 'never_ask', 'disabled', 'invalid'])
      for (const enterprise of [undefined, false, true])
        for (const allowPersistent of [false, true])
          for (const fail of [false, true]) {
            const conf = config(
                { history_approval_mode: persisted, iab_history_approval_mode: persisted },
                {
                  requirements: {
                    browserUse: {
                      allowHistoryAccess: enterprise,
                      allowGlobalPersistentApproval: allowPersistent
                    }
                  }
                },
                { config: { browser_use: { allow_history_access: enterprise } } },
                fail
              ),
              host = { env: {} },
              a = new BrowserPreferences(conf as any, host),
              b = new base.BaselinePreferences(conf, host)
            expect(await a.getHistoryPermission(type)).toEqual(await b.getHistoryPermission(type))
          }
})
test('origin access/transfer/CDP/auto-review/persistence delegates verified policy with failure defaults', async () => {
  const base = await originalDocumentation()
  for (const fail of [false, true]) {
    const conf = config(
        {},
        {
          requirements: {
            browserUse: {
              origins: { 'https://example.com': { access: 'deny', persistentApproval: false } }
            }
          }
        },
        { config: {} },
        fail
      ),
      host = { env: {} },
      a = new BrowserPreferences(conf as any, host),
      b = new base.BaselinePreferences(conf, host)
    for (const name of ['access', 'uploads', 'downloads', 'fullCdpAccess'])
      expect(await a.getOriginPolicyDecision('https://example.com', name as any)).toEqual(
        await b.getOriginPolicyDecision('https://example.com', name)
      )
    expect(await a.isOriginAutoReviewDisabled('https://example.com')).toBe(
      await b.isOriginAutoReviewDisabled('https://example.com')
    )
    expect(await a.isPersistentApprovalAllowed('https://example.com')).toBe(
      await b.isPersistentApprovalAllowed('https://example.com')
    )
    expect(await a.allowsGlobalPersistentApproval()).toBe(await b.allowsGlobalPersistentApproval())
  }
})
test('malformed history config remains unavailable instead of using a saved approval', async () => {
  const base = await originalDocumentation()
  const conf = config({ history_approval_mode: 'never_ask' }, {}, {}),
    host = { env: {} }
  expect(await new BrowserPreferences(conf as any, host).getHistoryPermission('extension')).toEqual(
    await new base.BaselinePreferences(conf, host).getHistoryPermission('extension')
  )
})
