import {
  commandTabId,
  commandSecurityScope,
  historyRequestDisplay,
  webMcpPermissionRequest,
  ensureNavigationUrlPolicy
} from './service-command-policy.js'
import type { SecurityCommand } from './service-command-policy.js'
import {
  approveOrigin,
  approveHistory,
  approveFileTransfer,
  approveFullCdp,
  approvePageAssets,
  approveAssetOrigin,
  approveWebMcp,
  pageOrigin,
  httpOrigin
} from './service-approval-gates.js'
import { securityFailure, denyPermission } from './service-security-approval.js'
import type { SecurityOptions, Elicitation } from './service-security-approval.js'
import { bypassesSecurityCheck, withoutUserConsent, securityMode } from './service-security-mode.js'
import { SiteStatusChecker } from './service-site-status.js'
import type { SiteStatusHost } from './service-site-status.js'
import type { BrowserPreferences } from './service-preferences.js'
interface Tabs {
  get(id: number): Promise<{ url?: string }>
}
interface UserTabs {
  openTabs(): Promise<{ id: number; url?: string }[]>
}
interface Timing {
  trackElicitation<T extends (...args: never[]) => unknown>(run: T): T
}
interface Runtime extends SiteStatusHost {
  createElicitation?: Elicitation
  assertBrowserUrlAllowed?: (url: string) => unknown
}
interface Navigation {
  accessReady: Promise<void>
  finished: Promise<unknown>
}
const defaultSiteStatus = new SiteStatusChecker()
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export class CommandSecurity {
  activeCommandsByTabId = new Map<number, number>()
  pendingNavigationsByTabId = new Map<number, Navigation[]>()
  displayOptions: SecurityOptions
  constructor(
    public tabs: Tabs,
    public browserBackend: string,
    public preferences: BrowserPreferences,
    public runtime: Runtime,
    public commandTiming: Timing,
    options: SecurityOptions = {},
    public userTabs?: UserTabs,
    private siteStatus = defaultSiteStatus
  ) {
    this.displayOptions = { browserBackend, ...options }
  }
  getCreateElicitation = (): Elicitation => {
    if (typeof this.runtime.createElicitation !== 'function')
      throw Error('Browser security elicitation is unavailable')
    return this.commandTiming.trackElicitation(this.runtime.createElicitation)
  }
  async ensureCommandAllowed(command: SecurityCommand): Promise<{ expectedTabUrl: string } | void> {
    const id = commandTabId(command.params)
    if (id !== null && !['navigate_tab_url', 'close_tab'].includes(command.type)) {
      let first = this.pendingNavigationsByTabId.get(id)?.[0]
      while (first) {
        await first.accessReady
        const next = this.pendingNavigationsByTabId.get(id)?.[0]
        if (next === first) break
        first = next
      }
    }
    if (command.type === 'browser_user_history') {
      const permission =
        securityMode(this.runtime) === 'disabled-for-local-testing'
          ? await this.preferences.getPersistedHistoryPermission(this.browserBackend)
          : await this.preferences.getHistoryPermission(this.browserBackend)
      if (permission?.decision === 'deny')
        denyPermission(
          'browser-history-read',
          permission.source,
          'read browsing history',
          this.displayOptions
        )
      if (withoutUserConsent(this.runtime, 'browser-history-read')) return
      await approveHistory(
        this.getCreateElicitation,
        historyRequestDisplay(command.params),
        this.browserBackend,
        this.preferences,
        this.displayOptions
      )
      return
    }
    const scope = commandSecurityScope(command)
    switch (scope.kind) {
      case 'none':
        return
      case 'targetUrl':
        await this.ensureTargetUrlOriginAllowed(scope.url)
        return
      case 'userTab':
        return { expectedTabUrl: await this.ensureUserTabOriginAllowed(scope.tabId) }
      case 'currentTab': {
        const url = await this.ensureCurrentTabOriginAllowed(scope.tabId),
          request = webMcpPermissionRequest(command, this.displayOptions)
        if (request !== null && !withoutUserConsent(this.runtime, 'webmcp-tool-call')) {
          const audit = await approveWebMcp(
            this.getCreateElicitation,
            url as string,
            request,
            this.displayOptions
          )
          if ((await this.tabs.get(scope.tabId)).url !== url)
            securityFailure(
              {
                audit,
                check: 'webmcp-tool-call',
                options: this.displayOptions,
                reason: 'browser_context_unavailable'
              },
              `${this.browserName()} cannot use WebMCP tools because the current page changed while waiting for approval.`
            )
        }
        return
      }
    }
  }
  runNavigation<T>(
    tabId: number,
    url: string,
    run: (check: Promise<void>) => T | Promise<T>
  ): Promise<T> {
    if (typeof url !== 'string' || !url)
      return Promise.reject(Error('navigate_tab_url requires a url'))
    if (!Number.isInteger(tabId) || tabId <= 0)
      return Promise.reject(Error('navigate_tab_url requires a positive integer tab_id'))
    const queue = this.pendingNavigationsByTabId.get(tabId) ?? [],
      previous = queue.at(-1),
      ready = deferred()
    void ready.promise.catch(() => {})
    const finished = (previous?.finished ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await this.runtime.assertBrowserUrlAllowed?.(url)
        const idle = (this.activeCommandsByTabId.get(tabId) ?? 0) === 0,
          check = Promise.resolve(this.startUrlPolicyCheck(url))
        void check.catch(() => {})
        await this.ensureUrlOriginConsentAllowed(url, { siteStatusCheck: check })
        if (!idle) await check
        void check.then(
          () => ready.resolve(),
          () => {}
        )
        const [policy, result] = await Promise.allSettled([
          check,
          Promise.resolve().then(() => run(check))
        ])
        if (policy.status === 'rejected') throw policy.reason
        if (result.status === 'rejected') throw result.reason
        return result.value
      })
      .catch((error) => {
        ready.reject(error)
        throw error
      })
      .finally(() => {
        queue.shift()
        if (queue.length === 0) this.pendingNavigationsByTabId.delete(tabId)
      })
    queue.push({ accessReady: ready.promise, finished })
    this.pendingNavigationsByTabId.set(tabId, queue)
    void finished.catch(() => {})
    return finished
  }
  async runCommand<T>(
    command: SecurityCommand,
    run: (allowed: { expectedTabUrl: string } | void) => Promise<T>
  ): Promise<T> {
    const id = command.type === 'close_tab' ? null : commandTabId(command.params)
    if (id !== null)
      this.activeCommandsByTabId.set(id, (this.activeCommandsByTabId.get(id) ?? 0) + 1)
    try {
      const allowed = await this.ensureCommandAllowed(command)
      return await run(allowed)
    } finally {
      if (id !== null) {
        const count = this.activeCommandsByTabId.get(id) ?? 0
        if (count <= 1) this.activeCommandsByTabId.delete(id)
        else this.activeCommandsByTabId.set(id, count - 1)
      }
    }
  }
  async ensureDownloadSourcePolicyAllowed(id: number) {
    const url = await this.getCurrentTabFileTransferUrl(id, 'download')
    await this.ensureOriginDownloadPolicyAllowed(url)
  }
  async ensureDownloadAllowed(id: number, url: string) {
    await this.ensureUrlPolicyAllowed(url, 'file-download')
    await this.ensureOriginDownloadPolicyAllowed(url)
    const current = await this.ensureCurrentTabFileTransferAllowed(id, 'download')
    if (
      !withoutUserConsent(this.runtime, 'file-download') &&
      pageOrigin(current) !== pageOrigin(url)
    )
      await approveFileTransfer(
        this.getCreateElicitation,
        'download',
        url,
        this.preferences,
        this.displayOptions
      )
  }
  async ensureFileUploadAllowed(id: number) {
    await this.ensureCurrentTabFileTransferAllowed(id, 'upload')
  }
  async ensurePageAssetDownloadAllowed(url: string | undefined) {
    const origin = pageOrigin(url)
    if (origin !== null) await this.ensureOriginDownloadPolicyAllowed(origin, 'page-asset-download')
    if (!withoutUserConsent(this.runtime, 'page-asset-download'))
      await approvePageAssets(this.getCreateElicitation, url, this.preferences, this.displayOptions)
  }
  async ensurePageAssetFallbackFetchAllowed(pageUrl: string, assetUrl: string) {
    const origin = pageOrigin(assetUrl)
    if (origin !== null && origin !== pageOrigin(pageUrl))
      await this.ensureOriginDownloadPolicyAllowed(origin, 'page-asset-cross-origin-fetch')
    if (!withoutUserConsent(this.runtime, 'page-asset-cross-origin-fetch'))
      await approveAssetOrigin(
        this.getCreateElicitation,
        pageUrl,
        assetUrl,
        this.preferences,
        this.displayOptions
      )
  }
  async ensureFullCdpAllowed(id: number) {
    const url = (await this.tabs.get(id)).url
    if (typeof url !== 'string' || !url.trim())
      securityFailure(
        { check: 'full-cdp', options: this.displayOptions, reason: 'browser_context_unavailable' },
        `${this.browserName()} could not determine the current page URL before attempting to use raw CDP.`
      )
    await this.ensureRawCdpUrlAllowedForOperation(url, 'full-cdp')
  }
  async ensureRawCdpUrlAllowed(url: string) {
    await this.ensureRawCdpUrlAllowedForOperation(url, 'raw-cdp-destination-url')
  }
  async ensureRawCdpUrlAllowedForOperation(url: string, check: string) {
    await this.ensureUrlPolicyAllowed(url, check)
    if (bypassesSecurityCheck(this.runtime, check)) return
    const policy = await this.preferences.getOriginPolicyDecision(url, 'fullCdpAccess')
    if (policy !== null)
      this.policyFailure(
        url,
        check,
        policy,
        policy === 'deny'
          ? `${this.browserName()} cannot use raw CDP because the Browser Use origin policy blocks it.`
          : `${this.browserName()} could not verify the Browser Use origin policy before using raw CDP.`
      )
    if (!withoutUserConsent(this.runtime, check))
      await approveFullCdp(
        this.getCreateElicitation,
        url,
        this.preferences,
        this.displayOptions,
        check
      )
  }
  async ensureTargetUrlOriginAllowed(url: unknown) {
    await this.ensureUrlPolicyAllowed(url)
    await this.ensureUrlOriginConsentAllowed(url)
  }
  async ensureUrlOriginAllowed(url: unknown) {
    await this.ensureUrlPolicyAllowed(url)
    await this.ensureUrlOriginConsentAllowed(url)
  }
  async ensureUrlOriginConsentAllowed(
    url: unknown,
    {
      siteStatusCheck,
      requireConsent = true
    }: { siteStatusCheck?: Promise<void>; requireConsent?: boolean } = {}
  ) {
    if (bypassesSecurityCheck(this.runtime, 'browser-origin-access')) return
    const origin = pageOrigin(url as string)
    if (origin === null) return
    const policy = await this.preferences.getOriginPolicyDecision(origin, 'access')
    if (policy !== null) {
      await siteStatusCheck
      securityFailure(
        {
          audit: { origin },
          check: 'browser-origin-access',
          options: this.displayOptions,
          permissionSource:
            policy === 'deny' ? 'codex-network-policy' : 'codex-network-policy-unavailable',
          reason: policy === 'deny' ? 'enterprise_policy_blocked' : 'enterprise_policy_unavailable'
        },
        policy === 'deny'
          ? `${this.browserName()} cannot access ${origin} because the admin-enforced policy blocks it.`
          : `${this.browserName()} could not verify the admin-enforced policy before accessing ${origin}.`
      )
    }
    if (requireConsent && !withoutUserConsent(this.runtime, 'browser-origin-access'))
      await approveOrigin(
        this.getCreateElicitation,
        origin,
        this.preferences,
        this.displayOptions,
        siteStatusCheck,
        this.commandTiming
      )
  }
  async ensureUrlPolicyAllowed(url: unknown, check = 'browser-origin-access') {
    if (typeof url === 'string') await this.runtime.assertBrowserUrlAllowed?.(url)
    await this.startUrlPolicyCheck(url, check)
  }
  startUrlPolicyCheck(url: unknown, check = 'browser-origin-access') {
    if (!bypassesSecurityCheck(this.runtime, 'check-navigation-url-policy'))
      ensureNavigationUrlPolicy(url, this.displayOptions, check)
    return this.siteStatus.startCheck(
      this.runtime,
      url,
      this.browserBackend,
      this.displayOptions,
      check
    )
  }
  async ensureCurrentTabOriginAllowed(id: number) {
    const tab = await this.tabs.get(id)
    await this.ensureUrlOriginAllowed(tab.url)
    return tab.url
  }
  async ensureOriginDownloadPolicyAllowed(url: string, check = 'file-download') {
    if (bypassesSecurityCheck(this.runtime, check)) return
    const policy = await this.preferences.getOriginPolicyDecision(url, 'downloads')
    if (policy === null) return
    const kind = check === 'file-download' ? 'files' : 'page assets'
    this.policyFailure(
      url,
      check,
      policy,
      policy === 'deny'
        ? `${this.browserName()} cannot download ${kind} from ${url} because the Browser Use origin policy blocks it.`
        : `${this.browserName()} could not verify the Browser Use origin policy before downloading ${kind} from ${url}.`
    )
  }
  async ensureUserTabOriginAllowed(id: number) {
    const url = (await this.userTabs?.openTabs())?.find((tab) => tab.id === id)?.url
    if (typeof url !== 'string' || !url.trim())
      securityFailure(
        {
          check: 'browser-origin-access',
          options: this.displayOptions,
          reason: 'browser_context_unavailable'
        },
        `${this.browserName()} could not determine the selected user tab URL before reading its content.`
      )
    await this.ensureUrlPolicyAllowed(url)
    await this.ensureUrlOriginConsentAllowed(url, { requireConsent: false })
    return url
  }
  async getCurrentTabFileTransferUrl(id: number, kind: 'download' | 'upload') {
    const url = (await this.tabs.get(id)).url
    if (typeof url !== 'string' || !url.trim())
      securityFailure(
        {
          check: kind === 'download' ? 'file-download' : 'file-upload',
          options: this.displayOptions,
          reason: 'browser_context_unavailable'
        },
        `${this.browserName()} could not determine the current page URL before attempting to ${kind} files.`
      )
    return url
  }
  async ensureCurrentTabFileTransferAllowed(id: number, kind: 'download' | 'upload') {
    const url = await this.getCurrentTabFileTransferUrl(id, kind)
    if (kind === 'upload') {
      if (bypassesSecurityCheck(this.runtime, 'file-upload')) return url
      const policy = await this.preferences.getOriginPolicyDecision(url, 'uploads')
      if (policy !== null)
        this.policyFailure(
          url,
          'file-upload',
          policy,
          policy === 'deny'
            ? `${this.browserName()} cannot upload files to ${url} because the Browser Use origin policy blocks it.`
            : `${this.browserName()} could not verify the Browser Use origin policy before uploading files to ${url}.`
        )
      if (withoutUserConsent(this.runtime, 'file-upload')) return url
    } else {
      await this.ensureOriginDownloadPolicyAllowed(url)
      if (withoutUserConsent(this.runtime, 'file-download')) return url
    }
    await approveFileTransfer(
      this.getCreateElicitation,
      kind,
      url,
      this.preferences,
      this.displayOptions
    )
    return url
  }
  browserName() {
    return this.displayOptions.elicitationDisplayName ?? 'Browser use'
  }
  private policyFailure(
    url: string,
    check: string,
    policy: 'deny' | 'unavailable',
    message: string
  ): never {
    return securityFailure(
      {
        audit: { origin: httpOrigin(url) ?? undefined },
        check,
        options: this.displayOptions,
        permissionSource:
          policy === 'deny' ? 'codex-network-policy' : 'codex-network-policy-unavailable',
        reason: policy === 'deny' ? 'enterprise_policy_blocked' : 'enterprise_policy_unavailable'
      },
      message
    )
  }
}
