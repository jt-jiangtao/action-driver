import { BrowserRpc } from './service-rpc.js'
import type { MessageTransport } from './service-rpc.js'
import type { BackendInfo, TurnMetadata } from './service-context.js'
import type { ServiceTab } from './service-tabs.js'
interface RequestMetadata {
  session_id?: unknown
  turn_id?: unknown
  thread_source?: unknown
  thread_id?: unknown
}
interface SessionParams extends TurnMetadata {
  session_context: 'live' | 'cached'
  agent_request_header_enabled?: boolean
}
interface CdpRequest {
  target: { tabId: number | string; sessionId?: string; targetId?: string }
  method: string
  commandParams: Record<string, unknown>
  timeoutMs?: number | undefined
  preserveDebuggerOnTimeout?: boolean
}
interface ExpressionResponse {
  kind: string
  result?: unknown
}
const cachedMethod = 'executeCdpWithCachedExpression',
  unsupportedCached = `No handler registered for method: ${cachedMethod}`
function sessionId(metadata: RequestMetadata | null | undefined) {
  if (metadata?.thread_source === 'subagent' && typeof metadata.thread_id === 'string')
    return metadata.thread_id
  return typeof metadata?.session_id === 'string' ? metadata.session_id : undefined
}
export class SessionBrowserApi extends BrowserRpc {
  apiTransport: MessageTransport
  lastSessionParams: SessionParams | null = null
  clientInfo: BackendInfo | undefined
  requestHeaderEnabled = false
  cachedExpressionSupport: Promise<boolean> | undefined
  committedTabUrlSupported = true
  sentCachedExpressions = new Set<string>()
  pendingPageEvents: unknown[] = []
  endingTurnId: string | undefined
  detachTurn: ((current: () => boolean) => Promise<unknown>) | undefined
  constructor(
    transport: MessageTransport,
    clientApi: object,
    public getTurnMetadata: () => RequestMetadata | null | undefined,
    public turnEndedTracker:
      | {
          track(
            metadata: TurnMetadata,
            callback: (metadata: TurnMetadata) => Promise<void>
          ): unknown
        }
      | undefined,
    public readRequestHeaderEnabled?: () => Promise<boolean>
  ) {
    super(transport)
    this.apiTransport = transport
    this.registerRequestHandlerObject(clientApi)
    this.addEventListener('onPageEvent', (event) => this.pendingPageEvents.push(event))
  }
  ping() {
    return this.sendRequest('ping')
  }
  executeCdp(input: CdpRequest) {
    return this.sendSessionRequest('executeCdp', input)
  }
  browserAuthNewTargetProtection(input: unknown) {
    return this.sendSessionRequest('browserAuthNewTargetProtection', input)
  }
  sendWebMcpToolInvoked(input: Record<string, unknown>) {
    this.sendNotification('webMcpToolInvoked', { ...input, ...this.getSessionParams() })
  }
  async executeCdpWithCachedExpression(input: CdpRequest, key: string) {
    if (this.cachedExpressionSupport == null || (await this.cachedExpressionSupport)) {
      const params = { ...input.commandParams }
      if (this.sentCachedExpressions.has(key)) delete params.expression
      const request = this.sendSessionRequest(cachedMethod, {
        ...input,
        commandParams: params,
        expressionCacheKey: key
      })
      this.sentCachedExpressions.add(key)
      this.cachedExpressionSupport ??= request.then(
        () => true,
        (error) => error !== unsupportedCached
      )
      try {
        const first = (await request) as ExpressionResponse
        if (first.kind === 'executed') return first.result
        const refill = (await this.sendSessionRequest(cachedMethod, {
          ...input,
          expressionCacheKey: key
        })) as ExpressionResponse
        if (refill.kind === 'executed') return refill.result
        throw Error('Cached CDP expression refill failed')
      } catch (error) {
        if (error !== unsupportedCached) throw error
      }
    }
    return this.executeCdp(input)
  }
  allowDownload(input: unknown) {
    return this.sendSessionRequest('allowDownload', input)
  }
  matchesCurrentSessionId(id: string) {
    const current = sessionId(this.getTurnMetadata())
    return typeof current === 'string' ? current === id : this.lastSessionParams?.session_id === id
  }
  getCurrentSessionId() {
    return this.getSessionParams().session_id
  }
  getCurrentTurnId() {
    const metadata = this.getTurnMetadata()
    if (typeof sessionId(metadata) === 'string' && typeof metadata?.turn_id === 'string')
      return metadata.turn_id
    return undefined
  }
  takePageEvents() {
    return this.pendingPageEvents.splice(0)
  }
  attach(tabId: number | string) {
    return this.sendSessionRequest('attach', { tabId })
  }
  attachTarget(tabId: number | string, targetId: string) {
    return this.sendSessionRequest('attachTarget', { tabId, targetId })
  }
  detach(tabId: number | string) {
    return this.sendSessionRequest('detach', { tabId })
  }
  detachTarget(tabId: number | string, targetId: string) {
    return this.sendSessionRequest('detachTarget', { tabId, targetId })
  }
  async getTabs() {
    return (await this.sendSessionRequest('getTabs', {})) as ServiceTab[]
  }
  async getCommittedTabUrl(tabId: number | string): Promise<unknown> {
    if (this.committedTabUrlSupported)
      try {
        return await this.sendSessionRequest('getCommittedTabUrl', { tabId })
      } catch (error) {
        if (error !== 'No handler registered for method: getCommittedTabUrl') throw error
        this.committedTabUrlSupported = false
      }
    const info = this.clientInfo ?? (await this.getInfo())
    if (info.type === 'cdp') {
      const result = (await this.executeCdp({
        target: { tabId },
        method: 'Page.getFrameTree',
        commandParams: {}
      })) as { frameTree: { frame: { url: unknown } } }
      return result.frameTree.frame.url
    }
    if (info.type === 'iab') {
      const result = (await this.executeCdp({
        target: { tabId },
        method: 'Target.getTargetInfo',
        commandParams: {}
      })) as { targetInfo: { url: unknown } }
      return result.targetInfo.url
    }
    if (info.type === 'extension') {
      const tab = (await this.getTabs()).find((item) => item.id === tabId)
      if (!tab) throw Error(`Tab not found: ${tabId}`)
      return tab.url
    }
  }
  async getUserTabs() {
    return (await this.sendSessionRequest('getUserTabs', {})) as ServiceTab[]
  }
  getUserHistory(input: unknown) {
    return this.sendSessionRequest('getUserHistory', input)
  }
  executeTabRead(input: unknown) {
    return this.sendSessionRequest('executeTabRead', input)
  }
  claimUserTab(tabId: number | string) {
    return this.sendSessionRequest('claimUserTab', { tabId })
  }
  createTab(preferredWindowId?: number) {
    return this.sendSessionRequest(
      'createTab',
      preferredWindowId == null ? {} : { preferredWindowId }
    )
  }
  markTab(tabId: number | string, status: unknown) {
    return this.sendSessionRequest('markTab', { tabId, status })
  }
  nameSession(name: string) {
    return this.sendSessionRequest('nameSession', { name })
  }
  async followSessionTab(tabId: number | string, reason = 'activity') {
    if (this.clientInfo?.sessionTabForegroundEnabled !== true) return false
    return await this.sendSessionRequest('followSessionTab', { tabId, reason })
  }
  executeUnhandledCommand(input: unknown) {
    return this.sendSessionRequest('executeUnhandledCommand', input)
  }
  moveMouse(input: unknown) {
    return this.sendSessionRequest('moveMouse', input)
  }
  async getInfo() {
    const info = (await this.sendSessionRequest('getInfo', {})) as BackendInfo
    this.clientInfo = info
    return info
  }
  turnEnded = async (metadata: TurnMetadata) => {
    try {
      if (this.detachTurn != null && this.matchesCurrentTurn(metadata)) {
        this.endingTurnId = metadata.turn_id
        try {
          await this.detachTurn(() => this.matchesCurrentTurn(metadata))
        } finally {
          this.endingTurnId = undefined
        }
      }
    } finally {
      await this.sendRequest('turnEnded', metadata)
    }
  }
  addCloseListener(callback: (error?: Error) => unknown) {
    return this.apiTransport.addCloseListener?.(callback) ?? (() => {})
  }
  async close() {
    await this.apiTransport.close?.()
  }
  async sendSessionRequest(method: string, input: unknown) {
    const params = this.getSessionParams()
    if (method !== 'getInfo' && method !== 'getUserTabs') this.lastSessionParams = params
    const info = this.clientInfo
    if (
      info?.type === 'extension' &&
      info.agentRequestHeaderEnabled !== undefined &&
      method !== 'getInfo' &&
      this.endingTurnId !== params.turn_id &&
      this.readRequestHeaderEnabled != null
    ) {
      const enabled =
        this.requestHeaderEnabled ||
        info.agentRequestHeaderEnabled === true ||
        (await this.readRequestHeaderEnabled())
      if (enabled && typeof info.agentRequestHeaderEnabled !== 'boolean')
        throw Error(
          'This browser requires agent request headers. Update the Chrome extension before continuing.'
        )
      this.requestHeaderEnabled ||= enabled
      params.agent_request_header_enabled = enabled
      if (
        this.lastSessionParams?.session_id === params.session_id &&
        this.lastSessionParams.turn_id === params.turn_id
      )
        this.lastSessionParams.agent_request_header_enabled = enabled
    }
    if (
      ['extension', 'cdp', 'iab'].includes(String(info?.type)) &&
      this.turnEndedTracker != null &&
      this.endingTurnId !== params.turn_id
    )
      this.turnEndedTracker.track(
        { session_id: params.session_id, turn_id: params.turn_id },
        this.turnEnded
      )
    return this.sendRequest(method, { ...(input as Record<string, unknown>), ...params })
  }
  matchesCurrentTurn(metadata: TurnMetadata) {
    if (this.getTurnMetadata() == null && this.lastSessionParams == null) return false
    const current = this.getSessionParams()
    return current.session_id === metadata.session_id && current.turn_id === metadata.turn_id
  }
  getSessionParams(): SessionParams {
    const metadata = this.getTurnMetadata()
    if (metadata == null && this.lastSessionParams !== null)
      return { ...this.lastSessionParams, session_context: 'cached' }
    const id = sessionId(metadata)
    if (typeof id !== 'string') throw Error('Missing required browser session_id')
    const turn = metadata?.turn_id
    if (typeof turn !== 'string') throw Error('Missing required browser turn_id')
    if (this.lastSessionParams?.session_id === id && this.lastSessionParams.turn_id === turn)
      return { ...this.lastSessionParams, session_context: 'live' }
    return { session_id: id, turn_id: turn, session_context: 'live' }
  }
}
