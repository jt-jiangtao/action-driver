import { createCredentialCommandGuard } from './service-credential-command.js'
import type { CredentialCommandHost, CredentialCommand } from './service-credential-command.js'
import { globalCommandHandlers } from './service-global-handlers.js'
import { createCommandRegistry } from './service-command-registry.js'

type Handler = (params: Record<string, unknown>, context: any, authorization?: unknown,
  finishNativeCredentialModelCommand?: () => void) => Promise<unknown>
interface BrowserRecord {
  id: string
  info: { type: string; apiSupportOverrides?: Record<string, boolean> }
  api: { addCloseListener(callback: () => unknown): () => void }
}
interface Backend {
  browserId: string
  clientInfo: BrowserRecord['info']
  api?: { sendWebMcpToolInvoked?(input: Record<string, unknown>): unknown }
  webMcp?: { resolveRegistration(tabId: number, registrationId: string): {
    name: string; title?: string; description?: string; origin?: string
  } }
  security: {
    runCommand<T>(command: { type: string; params: unknown }, run: (allowed: any) => Promise<T>): Promise<T>
    runNavigation?<T>(id: number, url: string, run: (permit: Promise<void>) => Promise<T>): Promise<T>
  }
  tabLifecycle: { needsReclaim(id: number): boolean; recordAcquired?(id: number): void }
  browserUser?: { claimTab(id: number): Promise<{ id: number }> }
  followSessionTab?(id: number): Promise<unknown>
  executeUnhandledCommand(input: unknown): Promise<unknown>
  dispose?(): Promise<unknown>
  [key: string]: unknown
}
interface Options {
  context: {
    get(id: string): Promise<BrowserRecord>
    refresh?(): Promise<unknown>
    list?(): Promise<BrowserRecord[]>
    getDefault?(): Promise<BrowserRecord>
    getForUrl?(url: string): Promise<BrowserRecord>
  }
  credential: CredentialCommandHost
  docs: { assertRequiredDocumentationRead(type: string): void; read?(name: string): Promise<string>; readBrowser?(browser: unknown): Promise<string> }
  host: { env: Record<string, string | undefined>; requestMeta?: Record<string, unknown> }
  createBackend(browser: BrowserRecord): Backend
  handlers?: Record<string, Handler>
  telemetry?: { withCommandTelemetry<T>(type: string, params: unknown, run: () => Promise<T>): Promise<T> }
  responseLifecycle?: {
    recordCommand(type: string, outcome: any): void
  }
  notifications?: { queue(api: any, backend: any): void }
}
const focusCommands = new Set([
  'cua_click', 'cua_double_click', 'cua_drag', 'cua_keypress', 'cua_scroll', 'cua_type',
  'dom_cua_click', 'dom_cua_double_click', 'dom_cua_keypress', 'dom_cua_scroll', 'dom_cua_type',
  'navigate_tab_back', 'navigate_tab_forward', 'navigate_tab_reload',
  'playwright_locator_click', 'playwright_locator_dblclick', 'playwright_locator_fill',
  'playwright_locator_press', 'playwright_locator_press_sequentially',
  'playwright_locator_select_option', 'playwright_locator_set_checked',
  'tab_ax_action', 'tab_handle_js_dialog'
])
const globalNames = new Set(Object.keys(globalCommandHandlers))

/** Assemble the security-checked command path. Resource/entry setup is kept outside this boundary. */
export function createBrowserCommandDispatcher(options: Options) {
  const handlers = options.handlers ?? createCommandRegistry(),
    backends = new WeakMap<object, Backend>(),
    activeBackends = new Set<Backend>(),
    closeListeners = new Map<object, () => void>()
  const run = async (command: CredentialCommand, finishNativeCredentialModelCommand?: () => void) => {
    const { type, ...params } = command
    options.docs.assertRequiredDocumentationRead(type)
    if (globalNames.has(type)) {
      const handler = globalCommandHandlers[type]!
      return await handler(
        params as Record<string, string>,
        options.context as Parameters<typeof handler>[1],
        options.host,
        options.docs as Parameters<typeof handler>[3]
      )
    }
    if (!Object.hasOwn(params, 'browser_id')) throw Error('Browser ID must be provided')
    const browser = await options.context.get(String(params.browser_id)),
      api = browser.api as object
    let backend = backends.get(api)
    if (backend == null) {
      backend = options.createBackend(browser)
      backends.set(api, backend)
      activeBackends.add(backend)
      const removeCloseListener = browser.api.addCloseListener(() => {
        backends.delete(api)
        activeBackends.delete(backend!)
        closeListeners.get(api)?.()
        closeListeners.delete(api)
      })
      closeListeners.set(api, removeCloseListener)
    }
    const id = Number(params.tab_id),
      tabId = Number.isSafeInteger(id) && id > 0 ? id : undefined
    let enteredSecurity = false
    let succeeded = false
    let result: unknown
    let webMcpTool: unknown
    const execute = async () => {
      if (
        tabId != null && type !== 'browser_user_claim_tab' &&
        type !== 'browser_user_get_tab_context' &&
        (backend!.clientInfo.apiSupportOverrides?.['Browser.user'] ??
          backend!.clientInfo.type === 'extension') &&
        backend!.tabLifecycle.needsReclaim(tabId)
      ) {
        const claimed = await backend!.browserUser!.claimTab(tabId)
        backend!.tabLifecycle.recordAcquired?.(claimed.id)
      }
      if (type === 'webmcp_invoke_tool') {
        if (tabId == null || typeof params.registration_id !== 'string' || backend!.webMcp == null)
          throw Error('WebMCP tool registration is stale. Call fetchTools() again.')
        const tool = backend!.webMcp.resolveRegistration(tabId, params.registration_id)
        webMcpTool = tool
        params.tool_name = tool.name
        params.tool_title = tool.title
        params.tool_description = tool.description
        params.tool_origin = tool.origin
      }
      const handler = handlers[type]
      const dispatch = async (authorization?: unknown) => handler != null
        ? await handler(params, backend, authorization,
            type === 'tab_browser_auth_handoff' ? finishNativeCredentialModelCommand : undefined)
        : await backend!.executeUnhandledCommand({ type, ...params })
      if (type === 'navigate_tab_url' && backend!.security.runNavigation != null)
        return await backend!.security.runNavigation(tabId!, params.url as string,
          async (permit) => { enteredSecurity = true; return await dispatch(permit) })
      return await backend!.security.runCommand({ type, params }, async (allowed) => {
        enteredSecurity = true
        if (type === 'browser_user_get_tab_context' && allowed?.expectedTabUrl != null)
          params.expected_url = allowed.expectedTabUrl
        if (tabId != null && focusCommands.has(type)) await backend!.followSessionTab?.(tabId)
        if (type === 'webmcp_invoke_tool')
          backend!.api?.sendWebMcpToolInvoked?.({
            parentCallId: options.host.requestMeta?.callId,
            tabId,
            toolName: params.tool_name
          })
        return await dispatch()
      })
    }
    try {
      result = options.telemetry == null
        ? await execute()
        : await options.telemetry.withCommandTelemetry(type, params, execute)
      succeeded = true
      return result
    } finally {
      if (enteredSecurity) {
        let currentUrl: string | undefined
        try {
          const cdp = (backend as any).cdp
          const url = tabId == null ? undefined : cdp?.currentTopLevelUrl?.(tabId)
          currentUrl = typeof url === 'string' ? url : undefined
          if (currentUrl == null && tabId != null && cdp?.isTabAttached?.(tabId)) {
            const state = await cdp.readDocumentState(tabId)
            currentUrl = typeof state?.href === 'string' ? state.href : undefined
          }
        } catch {}
        options.notifications?.queue(browser.api, backend!)
        options.responseLifecycle?.recordCommand(type, {
          backend: backend!.clientInfo.type === 'extension' ? 'chrome' : backend!.clientInfo.type,
          commandSucceeded: succeeded,
          context: backend,
          currentUrl,
          params,
          result,
          runtime: options.host,
          webMcpTool
        })
      }
    }
  }
  const guarded = createCredentialCommandGuard(run, options.credential, async (id) =>
    (await options.context.get(String(id))).id
  )
  return Object.assign(guarded, {
    async dispose() {
      const pending = [...activeBackends]
      activeBackends.clear()
      for (const remove of closeListeners.values()) remove()
      closeListeners.clear()
      await Promise.all(pending.map((backend) => backend.dispose?.()))
    }
  })
}
