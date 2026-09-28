import { EventEmitter } from 'node:events'
import type { PausedResponse } from './service-document-responses.js'
interface DownloadEvent {
  id: string
  url: string
  status: string
  filename: string
  session_id?: string
  [key: string]: unknown
}
interface Api {
  addEventListener(name: string, run: (event: DownloadEvent) => void): unknown
  matchesCurrentSessionId(id: string): boolean
  allowDownload(params: { tabId: number; url: string; requestId: string }): Promise<unknown>
}
interface Responses {
  on(event: string, run: (...args: any[]) => void): unknown
  addRequestInterceptor(
    id: number,
    run: (request: PausedResponse) => Promise<void>
  ): Promise<() => Promise<void>>
  continueResponse(
    id: number,
    requestId: string,
    overrides?: Record<string, unknown>
  ): Promise<unknown>
  failResponse(id: number, requestId: string): Promise<unknown>
}
interface PendingRequest {
  requestId: string
  url: string
  responseOverrides: Record<string, unknown> | undefined
}
const header = (headers: PausedResponse['responseHeaders'], name: string) =>
  headers?.find((header) => header.name.toLowerCase() === name)?.value
const attachment = (headers: PausedResponse['responseHeaders']) =>
  /^attachment(?:\s*;|\s*$)/i.test(header(headers, 'content-disposition') ?? '')
const mime = (headers: PausedResponse['responseHeaders']) =>
  header(headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
const media = (mime: string | undefined) =>
  mime === 'application/pdf' ||
  mime?.startsWith('image/') === true ||
  mime?.startsWith('video/') === true
function responseOverrides(response: PausedResponse): Record<string, unknown> | undefined {
  if (
    response.responseStatusCode == null ||
    response.responseHeaders == null ||
    attachment(response.responseHeaders) ||
    !media(mime(response.responseHeaders))
  )
    return
  const headers = response.responseHeaders,
    has = headers.some((header) => header.name.toLowerCase() === 'content-disposition')
  return {
    responseCode: response.responseStatusCode,
    ...(response.responseStatusText ? { responsePhrase: response.responseStatusText } : {}),
    responseHeaders: has
      ? headers.map((header) =>
          header.name.toLowerCase() === 'content-disposition'
            ? { ...header, value: header.value.replace(/^[^;]*/u, 'attachment') }
            : header
        )
      : [...headers, { name: 'Content-Disposition', value: 'attachment' }]
  }
}
export class Downloads extends EventEmitter {
  filenamesById = new Map<string, string>()
  activeDownloadTabs = new Set<number>()
  downloadIntents = new Map<
    number,
    { type: 'next' } | { type: 'request'; requestIds: Set<string> }
  >()
  allowedDownloadUrlsByTabId = new Map<number, string>()
  pendingDownloadRequestsByTabId = new Map<number, PendingRequest>()
  constructor(
    private api: Api,
    private documentResponses: Responses,
    private security: { ensureDownloadAllowed(id: number, url: string): Promise<unknown> },
    private clientType: string
  ) {
    super()
    api.addEventListener('onDownloadChange', (event) => {
      if (event.session_id != null && !api.matchesCurrentSessionId(event.session_id)) return
      this.filenamesById.set(event.id, event.filename)
      this.emit('change', event)
    })
    documentResponses.on('tabDetached', (id: number) => {
      this.downloadIntents.delete(id)
      this.allowedDownloadUrlsByTabId.delete(id)
      this.pendingDownloadRequestsByTabId.delete(id)
    })
    documentResponses.on('intercept', (id: number, response: PausedResponse, take: () => void) => {
      const intent = this.downloadIntents.get(id)
      let explicit = false
      switch (intent?.type) {
        case undefined:
          break
        case 'next':
          explicit = true
          break
        case 'request':
          explicit = intent.requestIds.has(response.requestId)
          break
        default:
          throw Error(`Unknown download intent: ${intent}`)
      }
      if (this.isDownload(response, explicit)) {
        take()
        void this.handleDownloadResponse(id, response, explicit).catch(() => {})
      }
    })
  }
  async withDownload<T>(id: number, run: () => Promise<T>) {
    if (this.activeDownloadTabs.has(id))
      throw Error(
        'A download is already in progress in this tab. Wait for it to finish before starting another.'
      )
    this.activeDownloadTabs.add(id)
    try {
      return await run()
    } finally {
      this.activeDownloadTabs.delete(id)
    }
  }
  async enableDownload(id: number) {
    this.allowedDownloadUrlsByTabId.delete(id)
    this.downloadIntents.set(id, { type: 'next' })
  }
  async enableMediaDownload(id: number, url: string, frameId: string) {
    const normalized = new URL(url)
    normalized.hash = ''
    const requestIds = new Set<string>(),
      remove = await this.documentResponses.addRequestInterceptor(id, async (request) => {
        if (request.resourceType !== 'Document' || request.frameId !== frameId) return
        if (
          (requestIds.size === 0 && request.request?.url === normalized.href) ||
          (request.redirectedRequestId != null &&
            requestIds.has(request.redirectedRequestId as string))
        )
          requestIds.add(request.requestId)
      })
    this.allowedDownloadUrlsByTabId.delete(id)
    this.downloadIntents.set(id, { type: 'request', requestIds })
    return async () => {
      try {
        await this.disableDownload(id)
      } finally {
        await remove()
      }
    }
  }
  async disableDownload(id: number) {
    this.downloadIntents.delete(id)
    this.allowedDownloadUrlsByTabId.delete(id)
    await this.failPendingDownloadRequest(id)
  }
  async waitForDownload(id: number, timeoutMs: number) {
    const started = Date.now(),
      timeoutError = Error(`Timed out after ${timeoutMs}ms waiting for download.`)
    let reject!: (error: unknown) => void
    const timeout = new Promise<never>((_, no) => {
      reject = no
    })
    let timer = setTimeout(() => reject(timeoutError), timeoutMs)
    const requestWait = this.waitForDownloadRequest(id)
    let completion: ReturnType<Downloads['waitForCompletedDownload']> | undefined
    try {
      const request = await Promise.race([requestWait.promise, timeout]),
        remaining = timeoutMs - (Date.now() - started)
      if (remaining <= 0) throw timeoutError
      clearTimeout(timer)
      await this.security.ensureDownloadAllowed(id, request.url)
      timer = setTimeout(() => reject(timeoutError), remaining)
      const assertCurrent = () => {
        if (this.pendingDownloadRequestsByTabId.get(id)?.requestId !== request.requestId)
          throw Error('The paused download response is no longer available.')
      }
      assertCurrent()
      if (this.clientType === 'iab' || this.clientType === 'cdp')
        await Promise.race([
          this.api.allowDownload({ tabId: id, url: request.url, requestId: request.requestId }),
          timeout
        ])
      assertCurrent()
      this.allowedDownloadUrlsByTabId.set(id, request.url)
      completion = this.waitForCompletedDownload(id)
      void completion.promise.catch(() => {})
      await Promise.race([
        this.documentResponses.continueResponse(id, request.requestId, request.responseOverrides),
        timeout
      ])
      assertCurrent()
      this.pendingDownloadRequestsByTabId.delete(id)
      return await Promise.race([completion.promise, timeout])
    } finally {
      clearTimeout(timer)
      requestWait.cancel()
      completion?.cancel()
      await this.disableDownload(id)
    }
  }
  waitForDownloadRequest(id: number) {
    const request = this.pendingDownloadRequestsByTabId.get(id)
    if (request !== undefined) return { cancel: () => {}, promise: Promise.resolve(request) }
    let cancel = () => {}
    const promise = new Promise<PendingRequest>((resolve) => {
      const listener = (tab: number, value: PendingRequest) => {
        if (tab === id) {
          cancel()
          resolve(value)
        }
      }
      cancel = () => {
        this.removeListener('request', listener)
      }
      this.addListener('request', listener)
    })
    return { cancel, promise }
  }
  waitForCompletedDownload(id: number) {
    let downloadId: string | null = null,
      cancel = () => {}
    const promise = new Promise<DownloadEvent>((resolve, reject) => {
      const listener = (event: DownloadEvent) => {
        if (downloadId === null) {
          if (event.status !== 'started' || event.url !== this.allowedDownloadUrlsByTabId.get(id))
            return
          downloadId = event.id
          return
        }
        if (
          event.id === downloadId &&
          event.status !== 'started' &&
          event.status !== 'in_progress'
        ) {
          cancel()
          switch (event.status) {
            case 'complete':
              resolve(event)
              return
            case 'failed':
              reject(Error(`Download ${event.id} failed.`))
              return
            case 'canceled':
              reject(Error(`Download ${event.id} was canceled.`))
              return
          }
        }
      }
      cancel = () => {
        this.removeListener('change', listener)
      }
      this.addListener('change', listener)
    })
    return { cancel, promise }
  }
  getPath(id: string) {
    return this.filenamesById.get(id) ?? null
  }
  isDownload(response: PausedResponse, explicit = false) {
    const type = mime(response.responseHeaders),
      redirect =
        [301, 302, 303, 307, 308].includes(response.responseStatusCode as number) &&
        header(response.responseHeaders, 'location') != null
    return (
      response.resourceType === 'Document' &&
      !redirect &&
      (attachment(response.responseHeaders) ||
        (explicit && media(type)) ||
        !(type === 'text/html' || media(type)))
    )
  }
  async handleDownloadResponse(id: number, response: PausedResponse, explicit: boolean) {
    const requestId = response.requestId
    if (!explicit) {
      await this.documentResponses.failResponse(id, requestId)
      return
    }
    const pending = {
      requestId,
      responseOverrides: responseOverrides(response),
      url: response.request!.url
    }
    this.pendingDownloadRequestsByTabId.set(id, pending)
    this.downloadIntents.delete(id)
    this.emit('request', id, pending)
  }
  async failPendingDownloadRequest(id: number) {
    const pending = this.pendingDownloadRequestsByTabId.get(id)
    if (pending !== undefined) {
      await this.documentResponses.failResponse(id, pending.requestId)
      if (this.pendingDownloadRequestsByTabId.get(id)?.requestId === pending.requestId)
        this.pendingDownloadRequestsByTabId.delete(id)
    }
  }
}
