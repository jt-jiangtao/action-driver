import { TabCdpCommands } from './commands/structured.js'

const supportedDomains = new Set(['Accessibility','Audits','CacheStorage','Console','CSS','Database','Debugger','DOM','DOMDebugger','DOMSnapshot','Emulation','Fetch','IO','Input','Inspector','Log','Network','Overlay','Page','Performance','Profiler','Runtime','Storage','Target','Tracing','WebAudio','WebAuthn'])
const blockedDomains = new Set(['CacheStorage','Database','Storage','Target','WebAuthn'])
const blockedMethods = new Set(['DOM.getFileInfo','DOM.setFileInputFiles','Input.dispatchKeyEvent','Input.setInterceptDrags','Network.clearBrowserCookies','Network.deleteDeviceBoundSession','Network.enableDeviceBoundSessions','Network.getAllCookies','Network.getResponseBodyForInterception','Network.setCookieControls','Network.setExtraHTTPHeaders','Network.setRequestInterception','Network.takeResponseBodyForInterceptionAsStream','Page.addScriptToEvaluateOnLoad','Page.addScriptToEvaluateOnNewDocument','Page.crash','Page.disable','Page.getNavigationHistory','Page.resetNavigationHistory','Page.setAdBlockingEnabled','Page.setBypassCSP','Page.setDownloadBehavior','Page.setInterceptFileChooserDialog','Page.setRPHRegistrationMode','Page.setSPCTransactionMode','Tracing.requestMemoryDump'])
const guidance = new Map([
  ['Fetch.disable','Use Fetch.enable with an empty patterns array to clear raw interception.'],
  ['Fetch.enable','Use explicit non-Document resourceType patterns; Browser Use reserves Document responses for browser-managed navigation.'],
  ['DOM.setFileInputFiles','Use tab.playwright.waitForEvent("filechooser") and chooser.setFiles(...) instead.'],
  ['Input.dispatchDragEvent','Use tab.playwright.waitForEvent("filechooser") and chooser.setFiles(...) instead for file uploads.'],
  ['Input.dispatchKeyEvent','Use tab.cua.type(...) or tab.cua.keypress(...) instead.'],
  ['Network.getAllCookies','Use Network.getCookies with explicit URLs instead.'],
  ['Page.getNavigationHistory','For supported history navigation, use tab.back() or tab.forward() instead.'],
  ['Page.navigate','Use tab.goto(url) instead.'],
  ['Page.navigateToHistoryEntry','Use tab.back() or tab.forward() instead.'],
  ['Page.reload','Use tab.reload() instead.'],
  ['Page.setDownloadBehavior','Use tab.playwright.waitForEvent("download") before triggering a download instead.'],
  ['Page.setInterceptFileChooserDialog','Use tab.playwright.waitForEvent("filechooser") and chooser.setFiles(...) instead.']
])
const hardBlocked = new Set(['Input.dispatchDragEvent','Network.continueInterceptedRequest','Network.getCertificate','Network.loadNetworkResource','Network.replayXHR','Page.navigate','Page.navigateToHistoryEntry'])
const object = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value)
const unsupported = (method: string) => `This method is not supported through raw CDP.${guidance.has(method) ? ` ${guidance.get(method)}` : ''}`
function restrictedParameters(method: string, params: any) {
  switch (method) {
    case 'Fetch.continueResponse':
    case 'Fetch.fulfillRequest': return params?.binaryResponseHeaders != null
    case 'Network.configureDurableMessages': return params?.maxTotalBufferSize != null
    case 'Network.enable': return params?.enableDurableMessages === true
    case 'Page.createIsolatedWorld': return params?.grantUniveralAccess === true
    case 'Page.reload': return params?.scriptToEvaluateOnLoad != null
    case 'Tracing.start': {
      const trace = params?.traceConfig
      return params?.perfettoConfig != null || params?.tracingBackend === 'system' ||
        typeof params?.options === 'string' && params.options.split(',').some((part: string) => part.trim() === 'enable-systrace') ||
        object(trace) && (trace.enableSystrace === true || trace.memoryDumpConfig != null)
    }
    default: return false
  }
}
/** Validate a raw method and preserve Browser Use's Document Fetch interception. */
export function prepareRawCdp(method: string, params: Record<string, unknown> | undefined, preserveDocumentInterception: boolean) {
  const dot = method.indexOf('.'), domain = dot > 0 ? method.slice(0, dot) : null
  if (!domain || !supportedDomains.has(domain) || blockedDomains.has(domain) || blockedMethods.has(method) ||
    hardBlocked.has(method) || restrictedParameters(method, params)) throw Error(unsupported(method))
  if (!preserveDocumentInterception) return params
  if (method === 'Fetch.disable') throw Error(unsupported(method))
  if (method !== 'Fetch.enable') return params
  const patterns = params?.patterns
  if (!Array.isArray(patterns) || patterns.some(pattern => !object(pattern) || typeof pattern.resourceType !== 'string' || pattern.resourceType === 'Document'))
    throw Error(unsupported(method))
  return { ...params, patterns: [...patterns, { requestStage: 'Response', resourceType: 'Document' }] }
}
function stringField(method: string, value: any, field: string, label = field) {
  if (value == null || !Object.hasOwn(value, field)) return []
  if (typeof value[field] !== 'string') throw Error(`${method} ${label} must be a string when set.`)
  return [value[field]]
}
function requiredString(method: string, value: any, field: string, label = field) {
  const urls = stringField(method, value, field, label)
  if (!urls.length) throw Error(`${method} ${label} is required so Browser Use can authorize the affected origin.`)
  return urls
}
function cookiesUrl(method: string, value: any, prefix = '') {
  if (value != null && Object.hasOwn(value, 'domain'))
    throw Error(`${method} ${prefix}domain is not supported; use ${prefix}url so Browser Use can authorize the affected origin.`)
  for (const field of ['sourcePort','sourceScheme']) if (value != null && Object.hasOwn(value, field))
    throw Error(`${method} ${prefix}${field} is not supported; omit it so the browser derives it from ${prefix}url.`)
  const urls = requiredString(method, value, 'url', `${prefix}url`)
  const partition = value?.partitionKey
  if (partition != null) {
    if (!object(partition)) throw Error(`${method} ${prefix}partitionKey must be an object when set.`)
    urls.push(...stringField(method, partition, 'topLevelSite', `${prefix}partitionKey.topLevelSite`))
  }
  return urls
}
function urlArray(method: string, params: any, field: string) {
  if (params == null || !Object.hasOwn(params, field)) return []
  const values = params[field]
  if (!Array.isArray(values)) throw Error(`${method} ${field} must be an array when set.`)
  return values.map((value, index) => {
    if (typeof value !== 'string') throw Error(`${method} ${field}[${index}] must be a string.`)
    return value
  })
}
/** Extract every affected URL so each destination receives its own approval. */
export function rawCdpDestinationUrls(method: string, params: Record<string, unknown> | undefined) {
  if (hardBlocked.has(method)) throw Error(unsupported(method))
  switch (method) {
    case 'Fetch.continueRequest': return stringField(method, params, 'url')
    case 'Fetch.continueResponse':
    case 'Fetch.fulfillRequest': {
      const headers = params?.responseHeaders
      if (headers == null) return []
      if (!Array.isArray(headers)) throw Error(`${method} responseHeaders must be an array when set.`)
      const urls: string[] = []
      for (const header of headers) {
        if (!object(header) || typeof header.name !== 'string' || typeof header.value !== 'string')
          throw Error(`${method} responseHeaders entries must include string name and value fields.`)
        if (header.name.trim().toLowerCase() === 'location') urls.push(header.value)
      }
      return urls
    }
    case 'Network.getCookies': {
      const urls = urlArray(method, params, 'urls')
      if (!urls.length) throw Error(`${method} urls must include at least one URL so Browser Use can authorize every affected origin.`)
      return urls
    }
    case 'Network.deleteCookies':
    case 'Network.setCookie': return cookiesUrl(method, params)
    case 'Page.deleteCookie': return requiredString(method, params, 'url')
    case 'Network.setCookies': {
      const cookies = params?.cookies
      if (cookies == null) return []
      if (!Array.isArray(cookies)) throw Error(`${method} cookies must be an array when set.`)
      return cookies.flatMap((cookie, index) => {
        if (!object(cookie)) throw Error(`${method} cookies[${index}] must be an object.`)
        return cookiesUrl(method, cookie, `cookies[${index}].`)
      })
    }
    default: return []
  }
}
const target = (value: any) => value == null ? undefined : { sessionId: value.session_id, targetId: value.target_id }
const tabId = (value: string) => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  return id
}
const supportedBackend = (context: any) => {
  const type = context.clientInfo.type
  if (type === 'extension' || type === 'iab') return true
  return type === 'cdp' && context.runtime.env?.BROWSER_USE_SECURITY_MODE?.trim() === 'gaas-browser-environment' &&
    context.runtime.env?.BROWSER_USE_FULL_CDP_ACCESS_ENABLED === '1'
}
const assertBackend = async (context: any) => {
  await context.preferences.assertFullCdpEnabled()
  if (!supportedBackend(context)) throw Error('Full CDP access is currently only available for browser extension and in-app browser tabs.')
}
export const cdpCommandHandlers = {
  tab_cdp_call: async (input: unknown, context: any) => {
    await assertBackend(context)
    const params = TabCdpCommands.Call.PayloadSchema.parse(input), id = tabId(params.tab_id)
    const selected = target(params.target)
    const payload = prepareRawCdp(params.method, params.params, selected == null)
    const preflight = () => {
      if (context.cdp.hasBrowserAuthRawEventProtection(id)) throw Error('Raw CDP is unavailable while Browser Use is protecting credential saving.')
      if (context.documentResponses.hasRequestInterceptors(id) && /^(Fetch|Network|Target)\./.test(params.method))
        throw Error('Raw CDP is unavailable while Browser Use is protecting a browser request.')
      if (context.documentResponses.hasOwnedPausedResponses(id))
        throw Error('Raw CDP is unavailable while Browser Use is resolving a paused document response.')
    }
    preflight()
    const urls = rawCdpDestinationUrls(params.method, payload)
    await context.security.ensureFullCdpAllowed(id)
    for (const url of urls) await context.security.ensureRawCdpUrlAllowed(url)
    return await context.cdp.callRawCdp(id, params.method, payload, {
      beforeDispatch: preflight,
      prepareDispatch: () => context.documentResponses.ensureInterceptionReady(id),
      target: selected,
      timeoutMs: params.timeout_ms ?? 3000
    }) ?? {}
  },
  tab_cdp_events: async (input: unknown, context: any) => {
    await assertBackend(context)
    const params = TabCdpCommands.Events.PayloadSchema.parse(input), id = tabId(params.tab_id)
    await context.security.ensureFullCdpAllowed(id)
    return await context.cdp.readRawCdpEvents(id, {
      afterSequence: params.after_sequence,
      limit: params.limit,
      methods: params.methods,
      target: target(params.target),
      timeoutMs: params.timeout_ms
    })
  }
}
