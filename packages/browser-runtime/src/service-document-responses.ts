import { EventEmitter } from 'node:events'
import type { CdpOptions } from './service-cdp-attachment.js'
import type { CdpEvent } from './service-cdp-events.js'
export interface PausedResponse {
  requestId: string
  resourceType?: string
  responseStatusCode?: number
  responseStatusText?: string
  responseHeaders?: { name: string; value: string }[]
  responseErrorReason?: string
  frameId?: string
  request?: { url: string }
  [key: string]: unknown
}
interface Cdp {
  addTabAttachHandler(
    handler: (id: number, options: CdpOptions) => Promise<unknown> | undefined
  ): unknown
  on(event: 'tabDetached', handler: (id: number) => void): unknown
  on(event: 'event', handler: (event: CdpEvent) => void): unknown
  call(
    id: number,
    method: string,
    params: Record<string, unknown>,
    options?: CdpOptions
  ): Promise<unknown>
  isTabAttached(id: number): boolean
}
type Interceptor = (request: PausedResponse) => Promise<'block' | 'handled' | 'continue' | void>
const responsePattern = { requestStage: 'Response', resourceType: 'Document' },
  preserve = { preserveDebuggerOnTimeout: true },
  requestPattern = { requestStage: 'Request' }
export class DocumentResponses extends EventEmitter {
  ownedResponsesByTab = new Map<number, Set<string>>()
  setupByTab = new Map<number, Promise<unknown>>()
  requestInterceptorsByTab = new Map<number, { interceptor: Interceptor; priority: number }[]>()
  configurationByTab = new Map<number, Promise<void>>()
  configuredRequestsByTab = new Set<number>()
  constructor(private cdp: Cdp) {
    super()
    cdp.addTabAttachHandler((id, options) => {
      if (!this.setupByTab.has(id)) return this.ensureInterceptionReady(id, options)
    })
    cdp.on('tabDetached', (id) => {
      this.ownedResponsesByTab.delete(id)
      this.setupByTab.delete(id)
      this.requestInterceptorsByTab.delete(id)
      this.configurationByTab.delete(id)
      this.configuredRequestsByTab.delete(id)
      this.emit('tabDetached', id)
    })
    cdp.on('event', (event) => {
      void this.handleEvent(event).catch(() => {})
    })
  }
  ensureInterceptionReady(id: number, options: CdpOptions = {}) {
    const pending = this.setupByTab.get(id)
    if (pending !== undefined) return pending
    const request = this.cdp.call(id, 'Fetch.enable', { patterns: [responsePattern] }, options)
    this.setupByTab.set(id, request)
    void request.catch(() => {
      if (this.setupByTab.get(id) === request) this.setupByTab.delete(id)
    })
    return request
  }
  async addRequestInterceptor(id: number, interceptor: Interceptor, priority = 0) {
    await this.ensureInterceptionReady(id)
    const list = this.requestInterceptorsByTab.get(id) ?? [],
      entry = { interceptor, priority }
    list.push(entry)
    list.sort((a, b) => b.priority - a.priority)
    this.requestInterceptorsByTab.set(id, list)
    try {
      await this.configureRequestInterception(id)
    } catch (error) {
      list.splice(list.indexOf(entry), 1)
      if (list.length === 0) this.requestInterceptorsByTab.delete(id)
      throw error
    }
    return async () => {
      const current = this.requestInterceptorsByTab.get(id)
      if (current === undefined) return
      const index = current.indexOf(entry)
      if (index < 0) return
      current.splice(index, 1)
      if (current.length === 0) this.requestInterceptorsByTab.delete(id)
      await this.configureRequestInterception(id)
    }
  }
  hasOwnedPausedResponses(id: number) {
    return (this.ownedResponsesByTab.get(id)?.size ?? 0) > 0
  }
  hasRequestInterceptors(id: number) {
    return this.requestInterceptorsByTab.has(id)
  }
  async continueResponse(id: number, requestId: string, params?: Record<string, unknown>) {
    await this.cdp.call(id, 'Fetch.continueResponse', { requestId, ...params }, preserve)
    this.release(id, requestId)
  }
  async failResponse(id: number, requestId: string) {
    await this.cdp.call(
      id,
      'Fetch.failRequest',
      { requestId, errorReason: 'BlockedByClient' },
      preserve
    )
    this.release(id, requestId)
  }
  async handleEvent(event: CdpEvent) {
    if (event.method !== 'Fetch.requestPaused') return
    const id = event.source.tabId
    if (typeof id !== 'number' || event.source.sessionId != null || event.source.targetId != null)
      return
    const params = event.params as PausedResponse
    if (params.responseStatusCode == null && params.responseErrorReason == null) {
      if (!this.requestInterceptorsByTab.has(id) && !this.configuredRequestsByTab.has(id)) return
      await this.handleRequest(id, params)
      return
    }
    if (params.resourceType !== 'Document') return
    const requestId = params.requestId,
      owned = this.ownedResponsesByTab.get(id) ?? new Set<string>()
    owned.add(requestId)
    this.ownedResponsesByTab.set(id, owned)
    if (params.responseErrorReason != null) {
      await this.cdp.call(id, 'Fetch.continueRequest', { requestId }, preserve)
      this.release(id, requestId)
      return
    }
    let claimed = false
    this.emit('intercept', id, params, () => {
      claimed = true
    })
    if (claimed) return
    const headers = params.responseHeaders
    this.emit('response', id, params)
    await this.continueResponse(
      id,
      requestId,
      params.responseHeaders === headers
        ? undefined
        : {
            responseCode: params.responseStatusCode,
            ...(params.responseStatusText ? { responsePhrase: params.responseStatusText } : {}),
            responseHeaders: params.responseHeaders
          }
    )
  }
  configureRequestInterception(id: number) {
    const pending = (this.configurationByTab.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.cdp.isTabAttached(id)) return
        const enabled = this.requestInterceptorsByTab.has(id)
        if (this.configuredRequestsByTab.has(id) !== enabled) {
          await this.cdp.call(
            id,
            'Fetch.enable',
            { patterns: enabled ? [requestPattern, responsePattern] : [responsePattern] },
            preserve
          )
          if (enabled) this.configuredRequestsByTab.add(id)
          else this.configuredRequestsByTab.delete(id)
        }
      })
    this.configurationByTab.set(id, pending)
    void pending
      .finally(() => {
        if (this.configurationByTab.get(id) === pending) this.configurationByTab.delete(id)
      })
      .catch(() => {})
    return pending
  }
  async handleRequest(id: number, request: PausedResponse) {
    let resolution = 'blocked'
    try {
      for (const { interceptor } of [...(this.requestInterceptorsByTab.get(id) ?? [])]) {
        let result
        try {
          result = await interceptor(request)
        } catch {
          result = 'block'
        }
        if (result === 'handled') {
          resolution = 'handled'
          return
        }
        if (result === 'block') {
          await this.cdp.call(
            id,
            'Fetch.failRequest',
            { requestId: request.requestId, errorReason: 'BlockedByClient' },
            preserve
          )
          return
        }
      }
      await this.cdp.call(id, 'Fetch.continueRequest', { requestId: request.requestId }, preserve)
      resolution = 'released'
    } finally {
      this.emit('requestResolution', id, request, resolution)
    }
  }
  release(id: number, requestId: string) {
    const owned = this.ownedResponsesByTab.get(id)
    if (owned !== undefined) {
      owned.delete(requestId)
      if (owned.size === 0) this.ownedResponsesByTab.delete(id)
    }
  }
}
