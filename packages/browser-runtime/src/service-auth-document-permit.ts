import type { PausedResponse } from './service-document-responses.js'

interface CredentialField { name: string; value: string }
interface AuthRequest {
  url: string
  method: string
  headers: Record<string, string>
  postData?: string
}
type RequestMatcher = (request: AuthRequest) => Promise<boolean>

/** Ordinary mode rejects requests whose URL or referrer contains the password or encoded variants. */
export async function createAuthOrdinaryUnsafeRequest(password: string): Promise<RequestMatcher> {
  if (!password) throw Error('Browser credential submission is missing its password')
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const encoder = new TextEncoder()
  const digest = async (value: string) => new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  const expected = await digest(password)
  const length = password.length
  const contains = async (value: string) => {
    if (value.length > 8192) return true
    const variants = new Set([value])
    for (const variant of variants) {
      if (variants.size > 128) return true
      variants.add(variant.replace(/\+/g, ' '))
      variants.add(variant.replace(/(?:%[\da-f]{2})+/gi, (encoded) => {
        try { return decodeURIComponent(encoded) } catch { return encoded }
      }))
      for (let offset = 0; offset + length <= variant.length; offset += 64) {
        const hashes = await Promise.all(Array.from(
          { length: Math.min(64, variant.length - length - offset + 1) },
          (_, index) => digest(variant.slice(offset + index, offset + index + length))
        ))
        if (hashes.some((hash) => hash.every((byte, index) => byte === expected[index]))) return true
      }
    }
    return false
  }
  return async (request) => {
    if (await contains(request.url)) return true
    for (const [name, value] of Object.entries(request.headers))
      if (name.toLowerCase() === 'referer' && await contains(value)) return true
    return false
  }
}

/** Match a private form submission with non-extractable HMAC keys, as in the original permit. */
export async function createAuthRequestMatcher(fields: CredentialField[]): Promise<RequestMatcher> {
  if (fields.length === 0 || fields.some(({ name, value }) => !name || value == null))
    throw Error('Browser credential submission is missing a required value')
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const encoder = new TextEncoder()
  const digest = async (value: string) => new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  const expected = await Promise.all(fields.map(async ({ name, value }) => ({
    name, digest: await digest(value)
  })))
  return async (request) => {
    if (request.postData == null || request.postData.length > 128 * 1024) return false
    const contentType = Object.entries(request.headers)
      .find(([name]) => name.toLowerCase() === 'content-type')?.[1]
    if (contentType == null) return false
    let data: URLSearchParams | FormData
    try {
      const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType === 'application/x-www-form-urlencoded') data = new URLSearchParams(request.postData)
      else if (mediaType === 'multipart/form-data') data = await new Response(request.postData, {
        headers: { 'Content-Type': contentType }
      }).formData()
      else return false
      for (const field of expected) {
        const values = data.getAll(field.name)
        if (values.length !== 1 || typeof values[0] !== 'string') return false
        const actual = await digest(values[0])
        if (actual.length !== field.digest.length) return false
        let mismatch = 0
        for (let index = 0; index < field.digest.length; index++)
          mismatch |= field.digest[index]! ^ actual[index]!
        if (mismatch !== 0) return false
      }
      return true
    } catch { return false }
  }
}

interface Cdp {
  call(tabId: number, method: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>
  on(event: 'event' | 'tabDetached', callback: (...args: any[]) => void): unknown
  removeListener(event: 'event' | 'tabDetached', callback: (...args: any[]) => void): unknown
  suppressRawNetworkEvents(tabId: number): () => void
  browserAuthNewTargetCheck(tabId: number): Promise<string>
  protectBrowserAuthNewTargets(tabId: number): Promise<() => Promise<void>>
  protectServiceWorkerStarts(tabId: number): Promise<() => Promise<void>>
  protectBrowserAuthServiceWorkerBypass(tabId: number): Promise<() => Promise<void>>
  closeBrowserAuthPausedTarget?(tabId: number, targetId: string): Promise<boolean>
}
interface Requests {
  addRequestInterceptor(
    tabId: number, interceptor: (request: PausedResponse) => Promise<'block' | void>, priority: number
  ): Promise<() => Promise<void>>
  on(event: 'requestResolution', callback: (...args: any[]) => void): unknown
  removeListener(event: 'requestResolution', callback: (...args: any[]) => void): unknown
}
interface PrivatePermitInput {
  cdp: Cdp
  requests: Requests
  tabId: number
  frameId: string
  target: { origin: string; url: string }
  credentialFields: CredentialField[]
}
function parsedUrl(value: string): URL | undefined {
  try { const url = new URL(value); url.hash = ''; return url } catch { return undefined }
}
function nestedDocument(node: any): boolean {
  if (['iframe', 'frame', 'object', 'embed'].includes(String(node?.localName).toLowerCase())) return true
  return [...(node?.children ?? []), ...(node?.shadowRoots ?? []),
    ...(node?.contentDocument == null ? [] : [node.contentDocument])].some(nestedDocument)
}
export async function checkPrivateAuthContainment(
  cdp: Pick<Cdp, 'call' | 'browserAuthNewTargetCheck'>,
  tabId: number,
  origin: string
): Promise<boolean> {
  try {
    const [{ frameTree }, { root }] = await Promise.all([
      cdp.call(tabId, 'Page.getFrameTree'),
      cdp.call(tabId, 'DOM.getDocument', { depth: -1, pierce: true })
    ])
    if (parsedUrl(frameTree.frame.securityOrigin)?.origin !== origin ||
      (frameTree.childFrames?.length ?? 0) !== 0 || nestedDocument(root) ||
      await cdp.browserAuthNewTargetCheck(tabId) !== 'contained') return false
    const { executionContextId } = await cdp.call(tabId, 'Page.createIsolatedWorld', {
      frameId: frameTree.frame.id, worldName: 'browser-auth-saving-service-workers'
    })
    const result = await cdp.call(tabId, 'Runtime.evaluate', {
      expression: '(async () => { const container = navigator.serviceWorker; if (container == null) return true; if (container.controller != null || (await container.getRegistrations()).length !== 0) return false; return container.controller == null; })()',
      contextId: executionContextId, awaitPromise: true, returnByValue: true
    })
    return result.exceptionDetails == null && result.result?.value === true
  } catch { return false }
}

/** Opens the private-form permit only after every protection is active and page containment passes. */
export async function openAuthDocumentPermit(input: PrivatePermitInput) {
  const { cdp, requests, tabId, frameId, target } = input
  const matches = await createAuthRequestMatcher(input.credentialFields)
  const targetUrl = parsedUrl(target.url)
  if (targetUrl == null || targetUrl.protocol !== 'https:' || targetUrl.origin !== target.origin)
    throw Error('Invalid credential submission target')
  const releaseRaw = cdp.suppressRawNetworkEvents(tabId)
  let releaseInterceptor: (() => Promise<void>) | undefined
  let releaseTargets: (() => Promise<void>) | undefined
  let releaseWorkers: (() => Promise<void>) | undefined
  let releaseBypass: (() => Promise<void>) | undefined
  let closed = false
  let rejected = false
  let candidateClaimed = false
  let outcome: 'submitted' | 'submission_failed' | 'origin_changed' | undefined
  let finishOutcome!: (status: 'submitted' | 'submission_failed' | 'origin_changed') => void
  const completion = new Promise<'submitted' | 'submission_failed' | 'origin_changed'>(
    (resolve) => { finishOutcome = resolve })
  const setOutcome = (status: 'submitted' | 'submission_failed' | 'origin_changed') => {
    rejected = status !== 'submitted'
    if (outcome === undefined) { outcome = status; finishOutcome(status) }
  }
  const allowedRedirects = new Set<string>()
  const allowedUrls = new Set<string>()
  const networkRequests = new Map<string, { loaderId: string; url: string; method: string }>()
  const networkResponses = new Map<string, { loaderId: string; url: string }>()
  const frameNavigations = new Map<string, { url: string; reachable: boolean }>()
  let candidate: { fetchId: string; networkId: string; released: boolean } | undefined
  const finishCandidate = () => {
    if (candidate == null || !candidate.released || outcome != null) return
    const request = networkRequests.get(candidate.networkId)
    const response = networkResponses.get(candidate.networkId)
    if (request == null || response == null || request.loaderId !== response.loaderId ||
      request.method !== 'POST' || request.url !== targetUrl.href ||
      !allowedUrls.has(response.url)) return
    const navigation = frameNavigations.get(request.loaderId)
    if (navigation == null) return
    setOutcome(navigation.reachable && navigation.url === response.url
      ? 'submitted' : 'submission_failed')
  }
  const onEvent = (event: any) => {
    if (event.source?.tabId !== tabId) return
    if (event.method === 'Page.windowOpen' || event.method === 'Page.javascriptDialogOpening')
      setOutcome('submission_failed')
    if (event.method === 'Target.attachedToTarget' &&
      (event.params?.targetInfo?.type === 'service_worker' ||
        event.params?.waitingForDebugger === true)) {
      setOutcome('submission_failed')
      if (event.params?.waitingForDebugger === true && typeof event.params?.targetInfo?.targetId === 'string')
        void cdp.closeBrowserAuthPausedTarget?.(tabId, event.params.targetInfo.targetId)
    }
    if (event.method === 'Page.frameNavigated' && event.params?.frame?.id !== frameId &&
      !['about:blank', 'about:srcdoc'].includes(event.params?.frame?.url)) {
      const child = parsedUrl(event.params?.frame?.securityOrigin ?? '')
      if (child?.origin !== target.origin) setOutcome('origin_changed')
    }
    if (event.source?.sessionId != null || event.source?.targetId != null) return
    const params = event.params
    if (event.method === 'Network.requestWillBeSent' && params?.frameId === frameId &&
      params.type === 'Document' && params.redirectResponse == null && networkRequests.size < 32) {
      const url = parsedUrl(params.request?.url ?? '')
      if (url != null) networkRequests.set(params.requestId, {
        loaderId: params.loaderId, url: url.href, method: params.request.method
      })
    } else if (event.method === 'Network.responseReceived' && params?.frameId === frameId &&
      params.type === 'Document' && networkResponses.size < 32) {
      const url = parsedUrl(params.response?.url ?? '')
      if (url != null && params.response.status >= 200 && params.response.status <= 599 &&
        ![204, 205, 301, 302, 303, 307, 308].includes(params.response.status))
        networkResponses.set(params.requestId, { loaderId: params.loaderId, url: url.href })
    } else if (event.method === 'Network.loadingFailed' && params?.requestId === candidate?.networkId)
      setOutcome('submission_failed')
    else if (event.method === 'Page.frameNavigated' && frameNavigations.size < 32) {
      const url = parsedUrl(params?.frame?.url ?? '')
      if (url != null) frameNavigations.set(params.frame.loaderId, {
        url: url.href, reachable: params.frame.unreachableUrl == null
      })
    }
    finishCandidate()
  }
  const onDetached = (id: number) => { if (id === tabId) rejected = true }
  const onRequestResolution = (id: number, paused: PausedResponse, resolution: string) => {
    if (id !== tabId || !allowedRedirects.has(paused.requestId)) return
    if (resolution === 'blocked') { setOutcome('submission_failed'); return }
    if (paused.requestId === candidate?.fetchId) candidate.released = true
    finishCandidate()
  }
  const onRequest = async (paused: PausedResponse): Promise<'block' | void> => {
    const request = paused.request as unknown as AuthRequest | undefined
    if (request == null) { rejected = true; return 'block' }
    const url = parsedUrl(request.url)
    if (url == null || url.protocol !== 'https:' || url.origin !== target.origin || rejected) {
      setOutcome('origin_changed')
      return 'block'
    }
    const safeMethod = request.method === 'GET' || request.method === 'HEAD'
    if (safeMethod && paused.frameId === frameId && paused.resourceType === 'Document' &&
      typeof paused.redirectedRequestId === 'string' &&
      allowedRedirects.has(paused.redirectedRequestId)) {
      allowedRedirects.add(paused.requestId)
      allowedUrls.add(url.href)
      return
    }
    if (paused.frameId !== frameId || paused.resourceType !== 'Document') {
      if (safeMethod) return
      setOutcome('submission_failed')
      return 'block'
    }
    if (request.method !== 'POST' || url.href !== targetUrl.href || candidateClaimed ||
      typeof paused.networkId !== 'string') {
      setOutcome('origin_changed')
      return 'block'
    }
    candidateClaimed = true
    if (!(await matches(request)) || rejected) {
      setOutcome('submission_failed')
      return 'block'
    }
    allowedRedirects.add(paused.requestId)
    allowedUrls.add(url.href)
    candidate = { fetchId: paused.requestId, networkId: paused.networkId as string, released: false }
  }
  cdp.on('event', onEvent)
  cdp.on('tabDetached', onDetached)
  requests.on('requestResolution', onRequestResolution)
  try {
    releaseInterceptor = await requests.addRequestInterceptor(tabId, onRequest, 100)
    releaseTargets = await cdp.protectBrowserAuthNewTargets(tabId)
    releaseWorkers = await cdp.protectServiceWorkerStarts(tabId)
    await cdp.call(tabId, 'Network.enable', {})
    releaseBypass = await cdp.protectBrowserAuthServiceWorkerBypass(tabId)
    if (!(await checkPrivateAuthContainment(cdp, tabId, target.origin)) || rejected)
      throw Error('Browser credential submission cannot contain every document')
  } catch (error) {
    await Promise.allSettled([releaseBypass?.(), releaseWorkers?.(), releaseTargets?.(), releaseInterceptor?.()])
    cdp.removeListener('event', onEvent)
    cdp.removeListener('tabDetached', onDetached)
    requests.removeListener('requestResolution', onRequestResolution)
    releaseRaw()
    throw error
  }
  return {
    currentRejection: () => outcome === 'submitted' ? null : outcome ?? (rejected ? 'submission_failed' as const : null),
    async result(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([completion,
          new Promise<'submission_failed'>((resolve) => {
            timer = setTimeout(() => resolve('submission_failed'), Math.min(timeoutMs, 5000))
          })])
      } finally { clearTimeout(timer) }
    },
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled([releaseBypass?.(), releaseWorkers?.(), releaseTargets?.(), releaseInterceptor?.()])
      cdp.removeListener('event', onEvent)
      cdp.removeListener('tabDetached', onDetached)
      requests.removeListener('requestResolution', onRequestResolution)
      releaseRaw()
    }
  }
}

interface OrdinaryPermitInput {
  cdp: Pick<Cdp, 'call' | 'on' | 'removeListener' | 'suppressRawNetworkEvents' |
    'protectBrowserAuthServiceWorkerBypass'> & {
      waitForEvent(tabId: number, predicate: (event: any) => boolean,
        options: { timeoutMs: number; timeoutMessage: string }): Promise<unknown>
    }
  requests: Requests
  tabId: number
  frameId: string
  origin: string
  password: string
}

/** Ordinary manual-save permit: same-origin requests only, no password in URLs/referrers. */
export async function openAuthOrdinaryDocumentPermit(input: OrdinaryPermitInput) {
  const { cdp, requests, tabId, frameId, origin } = input
  if (parsedUrl(origin)?.origin !== origin || !origin.startsWith('https://'))
    throw Error('Invalid ordinary credential origin')
  const unsafe = await createAuthOrdinaryUnsafeRequest(input.password)
  const releaseRaw = cdp.suppressRawNetworkEvents(tabId)
  let releaseInterceptor: (() => Promise<void>) | undefined
  let releaseBypass: (() => Promise<void>) | undefined
  let closed = false
  let outcome: 'origin_changed' | 'submission_failed' | undefined
  let cleanup: Promise<void> | undefined
  const quiesce = async () => {
    const first = (await cdp.call(tabId, 'Page.getFrameTree')).frameTree.frame
    if (first.id !== frameId) throw Error('Browser cannot quiesce the credential document')
    const event = cdp.waitForEvent(tabId, (candidate) =>
      candidate.source?.sessionId == null && candidate.source?.targetId == null &&
      candidate.method === 'Page.frameNavigated' &&
      candidate.params?.frame?.id === frameId &&
      candidate.params.frame.parentId == null &&
      candidate.params.frame.url === 'about:blank' &&
      candidate.params.frame.unreachableUrl == null,
    { timeoutMs: 5000, timeoutMessage: 'Browser could not quiesce the credential document' })
      .then(() => true, () => false)
    const navigated = await cdp.call(tabId, 'Page.navigate', { url: 'about:blank' },
      { preserveDebuggerOnTimeout: true })
    const observed = await event
    const final = (await cdp.call(tabId, 'Page.getFrameTree')).frameTree.frame
    if (!observed || navigated.errorText || navigated.isDownload === true ||
      !navigated.loaderId || navigated.frameId !== frameId || final.id !== frameId ||
      final.loaderId !== navigated.loaderId || final.loaderId === first.loaderId ||
      final.url !== 'about:blank' || final.unreachableUrl != null)
      throw Error('Browser cannot quiesce the credential document')
    await cdp.call(tabId, 'Page.resetNavigationHistory', undefined,
      { preserveDebuggerOnTimeout: true })
  }
  const reject = (status: 'origin_changed' | 'submission_failed', document: boolean) => {
    outcome ??= status
    if (document && cleanup == null) cleanup = Promise.resolve().then(async () => {
      try { await cdp.call(tabId, 'Page.stopLoading', undefined,
        { preserveDebuggerOnTimeout: true }) } catch {}
      await quiesce()
    })
    return 'block' as const
  }
  const onRequest = async (paused: PausedResponse): Promise<'block' | void> => {
    if (paused.frameId !== frameId) return
    const request = paused.request as unknown as AuthRequest | undefined
    const url = parsedUrl(request?.url ?? '')
    const document = paused.resourceType === 'Document'
    if (url == null || url.protocol !== 'https:' || url.origin !== origin)
      return reject('origin_changed', document)
    if (outcome != null && cleanup != null)
      return reject(outcome, document)
    if (request == null || await unsafe(request))
      return reject('submission_failed', document)
  }
  const onDetached = (id: number) => { if (id === tabId) outcome ??= 'submission_failed' }
  cdp.on('tabDetached', onDetached)
  try {
    releaseInterceptor = await requests.addRequestInterceptor(tabId, onRequest, 100)
    await cdp.call(tabId, 'Network.enable', {})
    releaseBypass = await cdp.protectBrowserAuthServiceWorkerBypass(tabId)
    const [{ frameTree }] = await Promise.all([
      cdp.call(tabId, 'Page.getFrameTree'),
      cdp.call(tabId, 'DOM.getDocument', { depth: -1, pierce: true })
    ])
    if (parsedUrl(frameTree.frame.securityOrigin)?.origin !== origin)
      throw Error('Browser credential submission cannot contain every document')
  } catch (error) {
    await Promise.allSettled([releaseBypass?.(), releaseInterceptor?.()])
    cdp.removeListener('tabDetached', onDetached)
    releaseRaw()
    throw error
  }
  return {
    currentRejection: () => outcome ?? null,
    async ordinaryResult() {
      await cdp.call(tabId, 'Page.getFrameTree', undefined,
        { preserveDebuggerOnTimeout: true }).catch((error) => {
          if (cleanup == null) throw error
        })
      await cleanup
      return outcome ?? 'submitted' as const
    },
    async close() {
      if (closed) return
      closed = true
      try { await cleanup } finally {
        await Promise.allSettled([releaseBypass?.(), releaseInterceptor?.()])
        cdp.removeListener('tabDetached', onDetached)
        releaseRaw()
      }
    }
  }
}
