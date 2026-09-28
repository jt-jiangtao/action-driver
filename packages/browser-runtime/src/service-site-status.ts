import { turnMetadata } from './service-discovery.js'
import { securityPolicyError } from './service-preferences.js'
import { BrowserUseSecurityError, emitSecurityAudit } from './service-security-approval.js'
import type { SecurityOptions } from './service-security-approval.js'
import { bypassesSecurityCheck } from './service-security-mode.js'
import { httpOrigin } from './service-approval-gates.js'
interface SiteRequest {
  cacheKey: string
  displayUrl: string
  endpoint: string
}
export function siteStatusRequest(
  input: string,
  options: { conversationId?: unknown; turnId?: unknown; urlRequestSource?: string } = {}
): SiteRequest | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw Error(
      'Browser Use cannot visit the requested page because the URL is invalid. Use a complete http:// or https:// URL.'
    )
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  const host = url.hostname.trim().toLowerCase()
  if (!host)
    throw Error(
      'Browser Use cannot visit the requested page because the URL does not include a website host.'
    )
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    ['127.0.0.1', '[::1]', '::1'].includes(host)
  )
    return null
  const site = new URL(url.origin)
  site.pathname = url.pathname
  site.search = url.search
  const endpoint = new URL('https://chatgpt.com/backend-api/aura/site_status')
  endpoint.searchParams.set('site_url', site.href)
  endpoint.searchParams.set('url_request_source', options.urlRequestSource ?? 'codex_browser_use')
  if (options.conversationId != null)
    endpoint.searchParams.set('conversation_id', String(options.conversationId))
  if (options.turnId != null) endpoint.searchParams.set('turn_id', String(options.turnId))
  site.search = ''
  return {
    cacheKey: host.startsWith('www.') ? host.slice(4) : host,
    displayUrl: site.pathname === '/' ? site.href.slice(0, -1) : site.href,
    endpoint: endpoint.href
  }
}
export interface SiteStatusHost {
  env: Record<string, string | undefined>
  requestMeta?: Record<string, unknown> | undefined
  fetch?: (
    url: string,
    options: { method: 'GET' }
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
}
export class SiteStatusRequestError extends Error {
  constructor(public httpStatus: number) {
    super('Browser Use site-status request failed.')
  }
}
function reportFailure(
  error: unknown,
  backend: string | undefined,
  family: string | undefined,
  background = false
) {
  emitSecurityAudit(() => ({
    ...(background ? { background: true } : {}),
    backend,
    browserFamily: family,
    check: 'check-url-site-status',
    httpStatus: error instanceof SiteStatusRequestError ? error.httpStatus : undefined,
    permissionSource: 'site-status',
    outcome: 'error_fail_open',
    reason: 'site_status_unavailable'
  }))
}
export class SiteStatusChecker {
  cache = new Map<string, { blocked: boolean; timestampMs: number }>()
  inflightRequests = new Map<string, Promise<boolean>>()
  constructor(
    public now = Date.now,
    public getTurnMetadata: (
      host: SiteStatusHost
    ) => Record<string, unknown> | undefined = turnMetadata
  ) {}
  async throwIfBlocksUrl(
    host: SiteStatusHost,
    url: unknown,
    backend?: string,
    options?: SecurityOptions,
    authorization = 'browser-origin-access'
  ) {
    await this.startCheck(host, url, backend, options, authorization)
  }
  startCheck(
    host: SiteStatusHost,
    url: unknown,
    backend?: string,
    options?: SecurityOptions,
    authorization = 'browser-origin-access'
  ): Promise<void> | void {
    if (bypassesSecurityCheck(host, 'check-url-site-status') || typeof url !== 'string') return
    const meta = this.getTurnMetadata(host),
      request = siteStatusRequest(url, {
        conversationId: meta?.session_id,
        turnId: meta?.turn_id,
        urlRequestSource: backend == null ? 'codex_browser_use' : `codex_browser_use:${backend}`
      })
    if (!request) return
    let result: ReturnType<SiteStatusChecker['isBlocked']>
    try {
      result = this.isBlocked(host, request, backend, options?.browserFamily)
    } catch (error) {
      reportFailure(error, backend, options?.browserFamily)
      return
    }
    const handle = (response: { blocked: boolean; outcome: string }) => {
      if (response.blocked) {
        emitSecurityAudit(() => ({
          authorization,
          backend,
          browserFamily: options?.browserFamily,
          check: 'check-url-site-status',
          origin: httpOrigin(url) ?? undefined,
          permissionSource: 'site-status',
          outcome: 'denied',
          reason: 'site_status_blocked',
          ...(response.outcome === 'success_cache_hit' ? { cached: true } : {})
        }))
        throw new BrowserUseSecurityError(
          'site_status_blocked',
          `${options?.elicitationDisplayName ?? 'Browser use'} is not permitted on ${request.displayUrl}.`
        )
      }
      emitSecurityAudit(() => ({
        backend,
        browserFamily: options?.browserFamily,
        check: 'check-url-site-status',
        origin: httpOrigin(url) ?? undefined,
        permissionSource: 'site-status',
        outcome: response.outcome
      }))
    }
    if (!(result instanceof Promise)) return handle(result)
    const pending = result.then(handle, (error) =>
      reportFailure(error, backend, options?.browserFamily)
    )
    void pending.catch(() => {})
    return pending
  }
  isBlocked(
    host: SiteStatusHost,
    request: SiteRequest,
    backend?: string,
    family?: string
  ): { blocked: boolean; outcome: string } | Promise<{ blocked: boolean; outcome: string }> {
    const fetch = this.fetchBlocked(host, request),
      cached = this.cachedBlocked(request.cacheKey)
    if (cached !== null) {
      void fetch.catch((error) => reportFailure(error, backend, family, true))
      return { blocked: cached, outcome: 'success_cache_hit' }
    }
    const current = this.inflightRequests.get(request.cacheKey)
    if (current) {
      void fetch.catch((error) => reportFailure(error, backend, family, true))
      return current.then((blocked) => ({ blocked, outcome: 'success' }))
    }
    const pending = fetch
      .then((blocked) => {
        this.cache.set(request.cacheKey, { blocked, timestampMs: this.now() })
        return blocked
      })
      .finally(() => {
        if (this.inflightRequests.get(request.cacheKey) === pending)
          this.inflightRequests.delete(request.cacheKey)
      })
    this.inflightRequests.set(request.cacheKey, pending)
    return pending.then((blocked) => ({ blocked, outcome: 'success' }))
  }
  cachedBlocked(key: string): boolean | null {
    const cached = this.cache.get(key)
    if (!cached || this.now() - cached.timestampMs >= 86400000) {
      if (cached) this.cache.delete(key)
      return null
    }
    return cached.blocked
  }
  async fetchBlocked(host: SiteStatusHost, request: SiteRequest) {
    if (typeof host.fetch !== 'function')
      throw securityPolicyError(
        'Browser Use cannot determine if this website is allowed. Please try again later or use another source.'
      )
    const response = await host.fetch(request.endpoint, { method: 'GET' })
    if (!response.ok) throw new SiteStatusRequestError(response.status)
    const value = await response.json()
    if (value === null || typeof value !== 'object') return false
    const features = (value as Record<string, unknown>).feature_status
    return (
      features !== null &&
      typeof features === 'object' &&
      (features as Record<string, unknown>).agent === true
    )
  }
}
