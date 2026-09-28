import { BrowserCdp } from './service-cdp.js'
import { ServiceClipboard } from './service-clipboard.js'
import { BrowserUser } from './service-browser-user.js'
import { BrowserUi, ServiceTabs } from './service-tabs.js'
import { CuaInput } from './service-cua-input.js'
import { DevLogs } from './service-dev-logs.js'
import { TabLifecycle } from './service-tab-lifecycle.js'
import { PlaywrightInput } from './service-playwright-input.js'
import { BrowserPreferences } from './service-preferences.js'
import { CommandSecurity } from './service-command-security.js'
import { DocumentResponses } from './service-document-responses.js'
import { Downloads } from './service-downloads.js'
import { SiteInstructions } from './service-site-instructions.js'
import { PageAssets } from './service-page-assets.js'
import { AxState } from './service-ax-state.js'
import { AxActions } from './service-ax-actions.js'
import { CredentialRegistry } from './service-credential-state.js'
import { WebMcpService } from './service-webmcp.js'
import { VisibleDomSnapshot } from './service-visible-dom.js'
import { captureTabScreenshot } from './service-screenshot.js'
import { clipboardShortcut, dispatchKeys } from './service-keyboard-input.js'
import { focusedClipboardTarget, performVirtualClipboardShortcut } from './service-playwright-clipboard-shortcut.js'
import { pastePage, runClipboardPageAction } from './service-playwright-paste.js'
import { interactionCommandHandlers } from './service-tab-interaction-commands.js'

/** Privileged API methods are supplied by the selected browser transport. */
interface BrowserBackendApi {
  addEventListener(name: string, listener: (...args: any[]) => void): unknown
  addCloseListener(listener: () => void): () => void
  getUserHistory(input: unknown): Promise<unknown>
  nameSession(input: unknown): Promise<unknown>
  getCurrentSessionId(): string | undefined
  followSessionTab(id: number, reason: string): Promise<boolean>
  getInfo(): Promise<{ capabilities?: { tab?: { id: string }[] } }>
  executeUnhandledCommand(input: unknown): Promise<unknown>
  getCommittedTabUrl(id: number): Promise<unknown>
  close(): Promise<unknown>
  detachTurn: ((isCurrent: () => boolean) => Promise<unknown>) | undefined
  [key: string]: any
}

/** Owns one connected browser's state. The command registry lives above this boundary. */
export class BrowserBackend {
  readonly preferences: BrowserPreferences
  readonly cdp: BrowserCdp
  readonly credentialObservationGate: ReturnType<CredentialRegistry['get']>
  readonly clipboard: ServiceClipboard
  readonly browserUser: BrowserUser
  readonly ui: BrowserUi
  readonly cua: CuaInput
  readonly dev: DevLogs
  readonly tabs: ServiceTabs
  readonly tabLifecycle: TabLifecycle
  readonly playwright: PlaywrightInput
  readonly security: CommandSecurity
  readonly documentResponses: DocumentResponses
  readonly downloads: Downloads
  readonly siteInstructions: SiteInstructions
  readonly pageAssets: PageAssets
  readonly ax: AxState
  readonly webMcp: WebMcpService
  readonly visibleDom: VisibleDomSnapshot
  readonly keyboard = { clipboardShortcut, dispatchKeys }
  readonly axClipboard = {
    perform: (
      action: 'paste' | 'paste-plain-text' | 'copy' | 'cut',
      id: number,
      focus: { target: { tabId: number; sessionId?: string; targetId?: string }; executionContextId?: number; inputTargetToken?: string }
    ) => performVirtualClipboardShortcut(action, id, this, async () => focus, 'tab_ax_action')
  }
  readonly axInput = {
    paste: async (id: number, index: number | undefined, text: string, format?: 'html' | 'text') => {
      const entries = [{ mime_type: 'text/plain', text }]
      if (format === 'html') entries.unshift({ mime_type: 'text/html', text })
      await this.clipboard.runExclusive(async () => {
        const focus = index == null
          ? { target: { tabId: id } }
          : await this.playwright.focusNode(this.ax.targetForElement(id, index), {
              requireEditable: true, timeoutMs: 3000
            }),
          resolved = await focusedClipboardTarget(this.cdp, id, focus)
        this.clipboard.write([{ entries }], 'tab_ax_action')
        await runClipboardPageAction({
          args: {
            action: 'paste',
            clipboardItems: this.clipboard.read(),
            ...('inputTargetToken' in focus && focus.inputTargetToken != null
              ? { iabInputTargetToken: focus.inputTargetToken }
              : {})
          },
          commandType: 'tab_ax_action',
          ctx: this,
          pageFunction: pastePage,
          tabId: id,
          target: resolved.target,
          executionContextId: resolved.executionContextId
        })
      })
    }
  }
  readonly isIabBackend: boolean
  readonly runtime: any
  readonly commandTiming: any
  readonly filesystem: any
  readonly environment: string
  readonly performanceSpan: any
  readonly elicitationDisplayName: string | undefined
  private removeCloseListener: () => void
  private removeTabAttachHandler: (() => void) | undefined
  private removeCredentialNavigationListeners: () => void
  private disposePromise: Promise<void> | undefined
  transportClosed = false

  constructor(
    readonly api: BrowserBackendApi,
    readonly browserId: string,
    readonly clientInfo: { type: string; family?: string; apiSupportOverrides?: Record<string, boolean> },
    options: {
      runtime: any
      config: ConstructorParameters<typeof BrowserPreferences>[0]
      commandTiming: any
      filesystem: any
      environment: string
      performanceSpan: any
      preferredWindowId?: number
      elicitationDisplayName?: string
    }
  ) {
    this.runtime = options.runtime
    this.commandTiming = options.commandTiming
    this.filesystem = options.filesystem
    this.environment = options.environment
    this.performanceSpan = options.performanceSpan
    this.preferences = new BrowserPreferences(options.config, this.runtime)
    this.elicitationDisplayName = options.elicitationDisplayName
    this.isIabBackend = clientInfo.type === 'iab'
    this.cdp = new BrowserCdp(api as any, this.runtime.platform, this.performanceSpan)
    const registry = this.runtime.credentialRegistry ?? new CredentialRegistry()
    this.credentialObservationGate = registry.get(browserId, this.cdp as any)
    this.removeCredentialNavigationListeners = this.credentialObservationGate.bindNavigationEvents(this.cdp as any)
    this.clipboard = new ServiceClipboard()
    this.browserUser = new BrowserUser(api as any, this.runtime.captureTabPdfToLibrary)
    this.ui = new BrowserUi(api as any)
    this.cua = new CuaInput(this.cdp, this.ui, this.isIabBackend ? 'mouseWheel' : 'synthesizeScrollGesture', this.isIabBackend)
    this.dev = new DevLogs(this.cdp as unknown as ConstructorParameters<typeof DevLogs>[0])
    this.tabs = new ServiceTabs(api as any, options.preferredWindowId)
    this.tabLifecycle = new TabLifecycle(api as any)
    this.removeTabAttachHandler = this.isIabBackend
      ? this.cdp.addTabAttachHandler((id) => this.tabLifecycle.recordAcquired(id))
      : undefined
    this.playwright = new PlaywrightInput(
      this.cdp,
      this.cua as unknown as ConstructorParameters<typeof PlaywrightInput>[1],
      this.performanceSpan,
      this.commandTiming,
      this.isIabBackend
    )
    this.security = new CommandSecurity(
      { get: async (id) => ({ url: await api.getCommittedTabUrl(id) as string }) },
      clientInfo.type,
      this.preferences,
      this.runtime,
      this.commandTiming,
      {
        ...(options.elicitationDisplayName === undefined ? {} : { elicitationDisplayName: options.elicitationDisplayName }),
        ...(clientInfo.family === undefined ? {} : { browserFamily: clientInfo.family })
      },
      this.browserUser as unknown as ConstructorParameters<typeof CommandSecurity>[6]
    )
    this.documentResponses = new DocumentResponses(this.cdp)
    this.downloads = new Downloads(api as any, this.documentResponses, this.security, clientInfo.type)
    this.siteInstructions = new SiteInstructions(
      clientInfo.type === 'cdp' && this.runtime.gaas != null &&
      Boolean(this.runtime.env.OPERATOR_PROXY_URL || this.runtime.env.HTTP_PROXY)
    )
    this.cdp.on('event', (event) => {
      if (event.method === 'Page.frameStartedLoading' && typeof event.source.tabId === 'number')
        this.siteInstructions.clearFrame(event.source.tabId, event.params.frameId)
    })
    this.documentResponses.on('response', (id, response) => this.siteInstructions.capture(id, response))
    this.documentResponses.on('tabDetached', (id) => this.siteInstructions.clear(id))
    this.pageAssets = new PageAssets(this.cdp, this.security, this.runtime, this.filesystem, clientInfo)
    this.visibleDom = new VisibleDomSnapshot(this.cdp, this.cua.domState)
    this.webMcp = new WebMcpService(this as unknown as ConstructorParameters<typeof WebMcpService>[0])
    this.ax = new AxState(this.cdp, () => this.getCurrentSessionId(), new AxActions(this), {
      getTab: (id) => this.tabs.get(id),
      getSiteInstruction: (id, url) =>
        !registry.isUnsafe() && !this.credentialObservationGate.usedNativeCredentials &&
        registry.gates().every((gate: { usedNativeCredentials: boolean }) => !gate.usedNativeCredentials)
          ? this.siteInstructions.peek(id, url)
          : undefined,
      observeNavigations: (clientInfo.type === 'iab' || clientInfo.type === 'extension') &&
        clientInfo.apiSupportOverrides?.['Tab.ax'] === true &&
        !(this.runtime.env.BROWSER_USE_DISABLE_API_MEMBERS ?? '')
          .split(',')
          .some((member: string) => member.trim() === 'Tab.ax')
    })
    this.removeCloseListener = api.addCloseListener(() => {
      this.transportClosed = true
      void this.dispose()
    })
    api.detachTurn = async (isCurrent) => {
      await this.clipboard.cleanupPageClipboards()
      if (isCurrent()) await this.cdp.detachAllTabs()
    }
  }

  history(input: unknown) { return this.api.getUserHistory(input) }
  nameSession(input: unknown) { return this.api.nameSession(input) }
  getCurrentSessionId() { return this.api.getCurrentSessionId() }
  followSessionTab(id: number, reason = 'activity') {
    return this.environment === 'orbit' ? this.api.followSessionTab(id, reason) : Promise.resolve(false)
  }
  async supportsTabCapability(capability: string) {
    return (await this.api.getInfo().catch(() => undefined))?.capabilities?.tab?.some(({ id }) => id === capability) === true
  }
  executeUnhandledCommand(input: unknown) { return this.api.executeUnhandledCommand(input) }
  screenshot(params: Parameters<typeof captureTabScreenshot>[0]) {
    return captureTabScreenshot(params, this)
  }
  handleJsDialog(params: Parameters<typeof interactionCommandHandlers.tab_handle_js_dialog>[0]) {
    return interactionCommandHandlers.tab_handle_js_dialog(params, this)
  }
  async dispose() {
    this.disposePromise ??= (async () => {
      this.removeCloseListener()
      this.removeTabAttachHandler?.()
      this.removeCredentialNavigationListeners()
      this.api.detachTurn = undefined
      await this.clipboard.dispose()
      await this.cdp.detachAllTabs()
      this.ax.dispose()
      if (!this.transportClosed) await this.api.close()
    })()
    await this.disposePromise
  }
}
