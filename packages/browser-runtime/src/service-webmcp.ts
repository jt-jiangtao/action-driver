import { WebMcpListTools } from './commands/capability.js'
import { toWebMcpToolDescriptor } from './webmcp-snapshot.js'
import { webMcpPageSource } from './service-webmcp-page.js'

const stale = 'WebMCP tool registration is stale. Call fetchTools() again.'
const excessive =
  'WebMCP is disabled for this page because the site’s WebMCP configuration exceeds supported limits. After correcting the configuration, reset NodeREPL and refresh the browser tab to retry.'
interface Target { tabId: number; sessionId?: string; targetId?: string }
interface Frame {
  target: Target
  frameId: string
  origin: string
  fileUrl?: string
}
interface World extends Frame {
  generation: number
  executionContextId: number
}
interface Cdp {
  on(event: string, listener: (value: any) => void): unknown
  addTabCleanupHandler(handler: (tabId: number) => void): unknown
  call(tabId: number, method: string, params?: unknown, options?: unknown): Promise<any>
  callTarget(target: Target, method: string, params?: unknown, options?: unknown): Promise<any>
  targetForFrameOrAttach(tabId: number, frameId: string, options?: unknown): Promise<Target | null>
}
interface Context {
  cdp: Cdp
  preferences: { isWebMcpEnabled(): Promise<boolean> }
  supportsTabCapability(id: string): Promise<boolean>
  getCurrentSessionId(): string
  clientInfo: { name: string }
  runtime?: unknown
}
interface Tool {
  name: string
  call_name: string
  registration_id: string
  title?: string
  description?: string
  input_schema?: unknown
  annotations?: Record<string, boolean>
  origin?: string
  pageUrl?: string
}
interface Limits {
  maxTools: number
  maxTotalDescriptorBytes: number
  maxRegistrationChanges: number
}
interface TabState {
  generation: number
  worldName: string
  worlds: Map<string, World>
  registrations: Map<string, World>
  observedTargets: Map<string, Promise<void>>
  notifiedGenerations: Map<string, number>
  frameSnapshot?: string
  toolsBySession: Map<string, { generation: number; tools: Tool[] }>
  snapshot?: string | undefined
  registrationChanges: number
  disabled: boolean
}
const defaultLimits: Limits = {
  maxTools: 100,
  maxTotalDescriptorBytes: 65536,
  maxRegistrationChanges: 10
}
const tabId = (value: unknown): number => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Expected a positive integer')
  return id
}
const matchesTarget = (target: Target, source: Target) =>
  target.tabId === source.tabId &&
  (target.sessionId != null
    ? target.sessionId === source.sessionId
    : target.targetId != null
      ? target.targetId === source.targetId
      : source.sessionId == null && source.targetId == null)
const signature = (tools: Tool[]) =>
  JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      ...(tool.title == null ? {} : { title: tool.title }),
      ...(tool.description == null ? {} : { description: tool.description }),
      inputSchema: tool.input_schema,
      ...(tool.annotations == null ? {} : { annotations: tool.annotations }),
      ...(tool.origin == null ? {} : { origin: tool.origin })
    }))
  )

/** Browser service state for page-defined tools; one instance per trusted browser context. */
export class WebMcpService {
  private static generation = 0
  private readonly tabs = new Map<number, TabState>()
  constructor(private readonly context: Context, private readonly limits: Limits = defaultLimits) {
    context.cdp.on('event', (event) => this.onEvent(event))
    context.cdp.on('tabDetached', (id) => this.tabs.delete(id))
    context.cdp.addTabCleanupHandler((id) => this.tabs.delete(id))
  }
  private state(id: number): TabState {
    let state = this.tabs.get(id)
    if (state == null) {
      state = {
        generation: ++WebMcpService.generation,
        worldName: `browser-use-webmcp-${crypto.randomUUID()}`,
        worlds: new Map(),
        registrations: new Map(),
        observedTargets: new Map(),
        notifiedGenerations: new Map(),
        toolsBySession: new Map(),
        registrationChanges: 0,
        disabled: false
      }
      this.tabs.set(id, state)
    }
    return state
  }
  private invalidate(state: TabState) {
    state.generation = ++WebMcpService.generation
    state.worlds.clear()
    state.registrations.clear()
  }
  private assertGeneration(state: TabState, generation: number) {
    if (state.generation !== generation) throw new Error(stale)
  }
  private onEvent(event: any) {
    const id = event?.source?.tabId
    if (typeof id !== 'number') return
    const state = this.tabs.get(id)
    if (state == null) return
    if (
      event.method === 'Page.frameNavigated' &&
      event.source.sessionId == null &&
      event.source.targetId == null &&
      event.params?.frame?.parentId == null
    ) {
      state.snapshot = undefined
      state.registrationChanges = 0
      state.disabled = false
    }
    const invalidating = new Set([
      'WebMCP.toolsAdded',
      'WebMCP.toolsRemoved',
      'Runtime.executionContextsCleared',
      'Page.frameNavigated',
      'Page.frameAttached',
      'Page.frameDetached',
      'Page.documentOpened'
    ])
    if (invalidating.has(event.method)) {
      if (
        event.method.startsWith('Page.') ||
        [...state.worlds.values()].some((world) => matchesTarget(world.target, event.source))
      ) this.invalidate(state)
    }
    if (
      event.method === 'Runtime.executionContextDestroyed' &&
      [...state.worlds.values()].some(
        (world) =>
          matchesTarget(world.target, event.source) &&
          world.executionContextId === event.params?.executionContextId
      )
    ) this.invalidate(state)
    if (event.method === 'Target.detachedFromTarget') {
      const source = { ...event.source, sessionId: event.params?.sessionId, targetId: event.params?.targetId }
      if ([...state.worlds.values()].some((world) => matchesTarget(world.target, source)))
        this.invalidate(state)
      if (event.params?.sessionId != null) state.observedTargets.delete(event.params.sessionId)
      if (event.params?.targetId != null) state.observedTargets.delete(event.params.targetId)
    }
  }
  private async supported(command: 'webmcp_list_tools' | 'webmcp_invoke_tool') {
    const runtime = this.context.runtime as
      | { requestMeta?: Record<string, unknown> }
      | undefined
    let metadata = runtime?.requestMeta?.['x-codex-turn-metadata']
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata) } catch { metadata = undefined }
    }
    const model =
      metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).model
        : undefined
    if (typeof model === 'string' && model.toLowerCase().includes('-luna'))
      throw new Error(`${model.toLowerCase()} does not support command "${command}".`)
    if (!(await this.context.preferences.isWebMcpEnabled()) ||
      !(await this.context.supportsTabCapability('webmcp'))) {
      for (const state of this.tabs.values()) {
        for (const session of state.toolsBySession.keys()) state.notifiedGenerations.delete(session)
        state.toolsBySession.clear()
      }
      throw new Error(`${this.context.clientInfo.name} does not support command "${command}".`)
    }
  }
  private async frames(id: number, deadlineMs?: number) {
    const state = this.state(id)
    const generation = state.generation
    const { frameTree } = await this.context.cdp.call(id, 'Page.getFrameTree', undefined, { deadlineMs })
    const { targetInfos } = await this.context.cdp.call(id, 'Target.getTargets', undefined, { deadlineMs })
    const pending = new Set<string>(
      targetInfos
        .filter((info: any) => info.type === 'iframe' && (info.tabId == null || info.tabId === id))
        .map((info: any) => info.targetId)
    )
    const targets: Array<{ target: Target; frameTree: any }> = [
      { target: { tabId: id }, frameTree }
    ]
    const frames: Frame[] = []
    const fingerprint = new Map<string, string>()
    for (const entry of targets) {
      const key = entry.target.sessionId ?? entry.target.targetId ?? 'top'
      let enabled = state.observedTargets.get(key)
      if (enabled == null) {
        enabled = this.context.cdp
          .callTarget(entry.target, 'WebMCP.enable', undefined, { deadlineMs })
          .then(() => undefined)
        state.observedTargets.set(key, enabled)
      }
      try { await enabled } catch (error) { state.observedTargets.delete(key); throw error }
      const nodes = [entry.frameTree]
      for (const { frame, childFrames } of nodes) {
        fingerprint.set(
          frame.id,
          JSON.stringify([frame.parentId, frame.loaderId, entry.target.sessionId, entry.target.targetId])
        )
        if (
          (frame.secureContextType === 'Secure' || frame.secureContextType === 'SecureLocalhost') &&
          ((frame.securityOrigin === 'file://' && frame.url.startsWith('file://')) ||
            frame.securityOrigin.startsWith('https://') ||
            (frame.securityOrigin.startsWith('http://') &&
              frame.securityOriginDetails?.isLocalhost === true))
        ) {
          let fileUrl: string | undefined
          if (frame.securityOrigin === 'file://') {
            const url = new URL(frame.url)
            url.search = ''
            url.hash = ''
            fileUrl = url.href
          }
          frames.push({ target: entry.target, frameId: frame.id, origin: frame.securityOrigin, ...(fileUrl == null ? {} : { fileUrl }) })
        }
        if (childFrames != null) nodes.push(...childFrames)
      }
      const owned = await Promise.all(
        [...pending].map(async (frameId) => {
          try {
            await this.context.cdp.callTarget(entry.target, 'DOM.getFrameOwner', { frameId }, { deadlineMs })
            return frameId
          } catch (error) {
            if (/Frame with the given id (?:was not found|does not belong to the target)/.test(
              error instanceof Error ? error.message : String(error)
            )) return null
            throw error
          }
        })
      )
      for (const frameId of owned) {
        if (frameId == null) continue
        pending.delete(frameId)
        const target = await this.context.cdp.targetForFrameOrAttach(id, frameId, { deadlineMs })
        if (target == null) throw new Error(stale)
        const nested = await this.context.cdp.callTarget(target, 'Page.getFrameTree', undefined, { deadlineMs })
        if (nested.frameTree.frame.id !== frameId) throw new Error(stale)
        targets.push({ target, frameTree: nested.frameTree })
      }
    }
    this.assertGeneration(state, generation)
    const next = JSON.stringify([...fingerprint].sort(([a], [b]) => a.localeCompare(b)))
    if (state.frameSnapshot != null && state.frameSnapshot !== next) this.invalidate(state)
    state.frameSnapshot = next
    return { frames, pageUrl: frameTree.frame.url || undefined }
  }
  private async world(frame: Frame, deadlineMs?: number): Promise<World> {
    const state = this.state(frame.target.tabId)
    const generation = state.generation
    const cached = state.worlds.get(frame.frameId)
    if (cached != null) return cached
    const { executionContextId } = await this.context.cdp.callTarget(
      frame.target,
      'Page.createIsolatedWorld',
      { frameId: frame.frameId, grantUniveralAccess: false, worldName: state.worldName },
      { deadlineMs }
    )
    this.assertGeneration(state, generation)
    const value = { ...frame, generation, executionContextId }
    state.worlds.set(frame.frameId, value)
    return value
  }
  private async evaluate(world: World, expression: string, timeoutMs: number, deadlineMs?: number) {
    const state = this.state(world.target.tabId)
    const response = await this.context.cdp.callTarget(
      world.target,
      'Runtime.evaluate',
      { awaitPromise: true, contextId: world.executionContextId, expression, returnByValue: true, timeout: timeoutMs },
      { timeoutMs, deadlineMs, beforeDispatch: () => this.assertGeneration(state, world.generation) }
    )
    if (response.exceptionDetails != null)
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  private async discover(id: number, deadlineMs?: number) {
    const state = this.state(id)
    const discovered = await this.frames(id, deadlineMs)
    const generation = state.generation
    const batches = await Promise.all(
      discovered.frames.map(async (frame) => {
        const world = await this.world(frame, deadlineMs)
        const tools = await this.evaluate(
          world,
          `${webMcpPageSource}\nwebMcp.readTools(${JSON.stringify({ generation, pageUrl: discovered.pageUrl, staleRegistrationError: stale })})`,
          10000,
          deadlineMs
        )
        this.assertGeneration(state, generation)
        if (!Array.isArray(tools)) throw new Error('WebMCP fetchTools failed: no result returned.')
        for (const tool of tools) {
          if (typeof tool?.registration_id !== 'string' || tool.origin !== frame.origin)
            throw new Error('Invalid native WebMCP tool owner.')
          state.registrations.set(tool.registration_id, world)
          if (frame.fileUrl != null) tool.origin = frame.fileUrl
        }
        return tools as Tool[]
      })
    )
    await this.frames(id, deadlineMs)
    this.assertGeneration(state, generation)
    return { generation, tools: batches.flat() }
  }
  async list(params: { tab_id: unknown }, deadlineMs?: number) {
    const id = tabId(params.tab_id)
    await this.supported('webmcp_list_tools')
    const state = this.state(id)
    if (state.disabled) throw new Error(excessive)
    const discovered = await this.discover(id, deadlineMs)
    await this.supported('webmcp_list_tools')
    if (state.disabled) throw new Error(excessive)
    this.assertGeneration(state, discovered.generation)
    if (discovered.tools.length > this.limits.maxTools)
      throw ((state.disabled = true), new Error(excessive))
    const tools = WebMcpListTools.ResultSchema.parse({ tools: discovered.tools }).tools as Tool[]
    const bytes = new TextEncoder().encode(
      JSON.stringify(tools.map((tool) => ({ ...toWebMcpToolDescriptor(tool), call_name: undefined })))
    ).byteLength
    if (bytes > this.limits.maxTotalDescriptorBytes)
      throw ((state.disabled = true), new Error(excessive))
    const snapshot = signature(tools)
    if (
      state.snapshot != null &&
      state.snapshot !== snapshot &&
      ++state.registrationChanges > this.limits.maxRegistrationChanges
    ) throw ((state.disabled = true), new Error(excessive))
    state.snapshot = snapshot
    const session = this.context.getCurrentSessionId()
    state.notifiedGenerations.set(session, discovered.generation)
    state.toolsBySession.set(session, { generation: discovered.generation, tools: structuredClone(tools) })
    return { tools }
  }
  /** Resolve approval metadata before command security runs; never expose mutable snapshot state. */
  resolveRegistration(tab: unknown, registrationId: string): Tool {
    const id = tabId(tab)
    const state = this.tabs.get(id)
    const session = state?.toolsBySession.get(this.context.getCurrentSessionId())
    const tool =
      state?.disabled === true || session?.generation !== state?.generation
        ? undefined
        : session?.tools.find((item) => item.registration_id === registrationId)
    if (tool == null) throw new Error(stale)
    return structuredClone(tool)
  }
  clearSessionSnapshots() {
    for (const state of this.tabs.values()) {
      for (const session of state.toolsBySession.keys()) state.notifiedGenerations.delete(session)
      state.toolsBySession.clear()
    }
  }
  pendingNotificationTabIds(sessionId: string) {
    return [...this.tabs]
      .filter(([, state]) => state.notifiedGenerations.get(sessionId) !== state.generation)
      .map(([id]) => id)
  }
  async notificationForTab(id: number, deadlineMs: number) {
    if (Date.now() >= deadlineMs) return ''
    const state = this.state(id)
    const sessionId = this.context.getCurrentSessionId()
    const previous = state.toolsBySession.get(sessionId)
    const comparison = previous?.generation === state.generation
      ? signature(previous.tools)
      : previous != null && previous.tools.length > 0 ? 'stale' : undefined
    const { tools } = await this.list({ tab_id: id }, deadlineMs)
    if (Date.now() >= deadlineMs) return ''
    const current = signature(tools)
    if (comparison === current || (comparison == null && tools.length === 0)) return ''
    if (tools.length === 0) return `WebMCP tools are no longer available in tab ${id}.`
    return [
      `WebMCP tools are available in tab ${id}:`,
      '',
      '```json',
      JSON.stringify(
        tools.map(toWebMcpToolDescriptor).map(({ call_name, ...descriptor }) => ({
          ...descriptor,
          name: call_name
        }))
      ),
      '```'
    ].join('\n')
  }
  async invoke(params: {
    tab_id: unknown
    registration_id: string
    input?: unknown
    timeout_ms?: number
  }) {
    const id = tabId(params.tab_id)
    await this.supported('webmcp_invoke_tool')
    const state = this.state(id)
    if (state.disabled) throw new Error(excessive)
    this.resolveRegistration(id, params.registration_id)
    const world = state.registrations.get(params.registration_id)
    if (world == null) throw new Error(stale)
    await this.frames(id)
    this.assertGeneration(state, world.generation)
    const result = await this.evaluate(
      world,
      `${webMcpPageSource}\nwebMcp.invokeTool(${JSON.stringify({
        registrationId: params.registration_id,
        generation: world.generation,
        inputJson: JSON.stringify(params.input ?? null),
        timeoutMs: params.timeout_ms,
        staleRegistrationError: stale
      })})`,
      params.timeout_ms as number
    )
    if (result !== null && typeof result !== 'string')
      throw new Error('WebMCP executeTool returned an invalid result.')
    return { result }
  }
}

export const webMcpCommandHandlers = {
  webmcp_list_tools: (params: { tab_id: unknown }, context: { webMcp: WebMcpService }) =>
    context.webMcp.list(params),
  webmcp_invoke_tool: (
    params: { tab_id: unknown; registration_id: string; input?: unknown; timeout_ms?: number },
    context: { webMcp: WebMcpService }
  ) => context.webMcp.invoke(params)
}
