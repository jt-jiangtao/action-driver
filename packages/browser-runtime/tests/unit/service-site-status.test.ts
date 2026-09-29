// @vitest-environment node
import { test, expect } from 'vitest'
import { SiteStatusChecker, siteStatusRequest } from '../../src/service-site-status'
import {
  bypassesSecurityCheck,
  withoutUserConsent,
  securityMode
} from '../../src/service-security-mode'
import { originalDocumentation } from '../original-service'
test('site status request preserves cache key, private URL field stripping and localhost exemptions', async () => {
  const base = await originalDocumentation()
  for (const url of [
    'https://www.example.com/path?x=1#hash',
    'https://user:password@example.com',
    'http://localhost',
    'http://foo.localhost',
    'http://127.0.0.1',
    'http://[::1]',
    'file:///tmp/a'
  ])
    expect(
      siteStatusRequest(url, { conversationId: 's', turnId: 't', urlRequestSource: 'source' })
    ).toEqual(
      base.baselineSiteStatusRequest(url, {
        conversationId: 's',
        turnId: 't',
        urlRequestSource: 'source'
      })
    )
  expect(() => siteStatusRequest('invalid')).toThrow('URL is invalid')
})
test('security modes match explicit bypass and consent policy; unknown modes use default', async () => {
  const base = await originalDocumentation()
  for (const mode of [
    '',
    'disabled-for-local-testing',
    'gaas-browser-environment',
    'unknown',
    ' gaas-browser-environment '
  ])
    for (const check of [
      'browser-history-read',
      'browser-origin-access',
      'file-download',
      'file-upload',
      'full-cdp',
      'page-asset-cross-origin-fetch',
      'page-asset-download',
      'raw-cdp-destination-url',
      'webmcp-tool-call',
      'check-navigation-url-policy',
      'check-url-site-status',
      'unknown'
    ]) {
      const host = { env: { BROWSER_USE_SECURITY_MODE: mode } }
      expect(securityMode(host)).toBe(base.baselineSecurityMode(host))
      expect(bypassesSecurityCheck(host, check)).toBe(base.baselineSecurityBypass(host, check))
      expect(withoutUserConsent(host, check)).toBe(base.baselineWithoutConsent(host, check))
    }
})
test('site status caches first response for 24 hours while still fetching on subsequent calls', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    let now = 0,
      calls = 0
    const checker = new Type(
        () => now,
        () => ({ session_id: 's', turn_id: 't' })
      ),
      host = {
        env: {},
        fetch: async () => {
          calls++
          return { ok: true, json: async () => ({ feature_status: { agent: calls % 2 === 0 } }) }
        }
      }
    const outcomes: any[] = []
    for (const time of [0, 1, 86400000]) {
      now = time
      try {
        await checker.throwIfBlocksUrl(host, 'https://www.example.com/path', 'iab', {})
        outcomes.push('ok')
      } catch (error: any) {
        outcomes.push({ message: error.message, reason: error.reason })
      }
      await Promise.resolve()
      await Promise.resolve()
    }
    return { calls, outcomes, cached: checker.cachedBlocked('example.com') }
  }
  expect(await exercise(SiteStatusChecker)).toEqual(await exercise(base.BaselineSiteStatus))
})
test('site status unavailable checks fail open with original audit outcome, not a user approval', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const checker = new Type()
    for (const fetch of [
      undefined,
      async () => {
        throw Error('network')
      },
      async () => ({ ok: false, status: 503 })
    ])
      await checker.throwIfBlocksUrl({ env: {}, fetch }, 'https://example.com', 'iab', {})
    return { cache: checker.cache.size, pending: checker.inflightRequests.size }
  }
  expect(await exercise(SiteStatusChecker)).toEqual(await exercise(base.BaselineSiteStatus))
})
test('site status audit preserves background fail-open events and cached block denials', async () => {
  const base = await originalDocumentation(),
    { setSecurityAudit } = await import('../../src/service-security-approval')
  async function exercise(Type: any, set: any) {
    const events: any[] = [],
      checker = new Type(() => 0),
      host = {
        env: {},
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ feature_status: { agent: true } })
        })
      }
    set((event: any) => events.push(event))
    const errors = []
    try {
      for (let i = 0; i < 2; i++) {
        try {
          await checker.throwIfBlocksUrl(host, 'https://example.com/path', 'iab', {}, 'full-cdp')
        } catch (error: any) {
          errors.push(error.reason)
        }
      }
      host.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
      try {
        await checker.throwIfBlocksUrl(host, 'https://example.com/path', 'iab', {})
      } catch {}
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      set(undefined)
    }
    return { events, errors }
  }
  expect(await exercise(SiteStatusChecker, setSecurityAudit)).toEqual(
    await exercise(base.BaselineSiteStatus, base.baselineSetAudit)
  )
})
