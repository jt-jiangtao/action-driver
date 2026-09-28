import { guardianOriginCache } from './service-guardian-cache.js'
import type { GuardianReview } from './service-guardian-cache.js'
import {
  contextForOrigin,
  tableFor,
  modeFor,
  defaultConversation,
  snapshotFor,
  tableMatches,
  validSession,
  turnApproved,
  recordTurnApproval,
  unavailableSnapshot,
  persistenceScope,
  allSites,
  autoReviewed,
  userReviewed,
  persistResource
} from './service-permission-state.js'
import type { PermissionRequest, PromptResult } from './service-permission-state.js'
import { readOriginPolicy, accessPolicyDecision } from './service-network-policy.js'
import type { OriginPolicy } from './service-network-policy.js'
import type { createBrowserConfig } from './service-config.js'
export type BrowserConfig = ReturnType<typeof createBrowserConfig>
type Data = Record<string, unknown>
const field = (data: unknown, name: string) => (data == null ? undefined : (data as Data)[name])
const requirement = (data: unknown, name: string) =>
  field(field(field(data, 'requirements'), 'browserUse'), name)
interface PreferenceHost {
  env: Record<string, string | undefined>
  requestMeta?: Record<string, unknown> | undefined
}
export interface PermissionDecision {
  decision: 'deny' | 'approve'
  scope: 'global' | 'conversation' | 'turn'
  source: string
}
export function securityPolicyError(reason: string) {
  return Error(
    `Browser Use rejected this action due to browser security policy. Reason: ${reason} The agent must not attempt to achieve the same outcome via workaround, indirect execution, raw CDP or browser commands, alternate browser surfaces, or policy circumvention. Proceed only with a materially safer alternative that does not require this blocked browser action; if none exists, stop and request user input.`
  )
}
export class BrowserPreferences {
  constructor(
    public config: BrowserConfig,
    public runtime: PreferenceHost
  ) {}
  async getOriginPolicyDecision(
    origin: string,
    action: keyof OriginPolicy
  ): Promise<'deny' | 'unavailable' | null> {
    if (action === 'access') return accessPolicyDecision(origin, this.config)
    try {
      return (await readOriginPolicy(origin, this.config))[action] === 'deny' ? 'deny' : null
    } catch {
      return 'unavailable'
    }
  }
  async isFullCdpEnabled() {
    return (await this.fullCdpAccessState()).enabled
  }
  async fullCdpAccessState(): Promise<{ enabled: true } | { enabled: false; reason: string }> {
    const cloud = this.runtime.env.BROWSER_USE_SECURITY_MODE?.trim() === 'gaas-browser-environment',
      disabled = (reason: string) => ({ enabled: false as const, reason })
    if (cloud && this.runtime.env.BROWSER_USE_FULL_CDP_ACCESS_ENABLED !== '1')
      return disabled('Full CDP access is disabled for this deployment.')
    try {
      const [enabled, requirements] = await Promise.all([
        cloud ? null : this.config.global.get('full_cdp_access_enabled'),
        this.config.readRequirements()
      ])
      if (
        field(
          field(field(requirements, 'requirements'), 'featureRequirements'),
          'browser_use_full_cdp_access'
        ) === false
      )
        return disabled('Full CDP access is disabled by enterprise policy.')
      if (!cloud && enabled !== true)
        return disabled('Full CDP access is disabled in browser config.')
      return { enabled: true }
    } catch {
      return disabled(
        'Full CDP access could not be verified from browser config and enterprise policy.'
      )
    }
  }
  async assertFullCdpEnabled() {
    const state = await this.fullCdpAccessState()
    if (!state.enabled) throw securityPolicyError(state.reason)
  }
  async isWebMcpEnabled() {
    try {
      const value = await this.config.global.get('webmcp_enabled')
      return value == null || value === true
    } catch {
      return false
    }
  }
  async getHistoryPermission(type: string): Promise<PermissionDecision | null> {
    const deny = (source: string): PermissionDecision => ({
      decision: 'deny',
      scope: 'global',
      source
    })
    try {
      const [requirements, all] = await Promise.allSettled([
        this.config.readRequirements(),
        this.config.readAll()
      ])
      if (
        (requirements.status === 'fulfilled' &&
          requirement(requirements.value, 'allowHistoryAccess') === false) ||
        (all.status === 'fulfilled' &&
          field(
            all.value == null
              ? undefined
              : (all.value as { config: { browser_use?: unknown } }).config.browser_use,
            'allow_history_access'
          ) === false)
      )
        return deny('codex-history-policy')
      if (requirements.status === 'rejected' || all.status === 'rejected')
        return deny('codex-history-policy-unavailable')
    } catch {
      return deny('codex-history-policy-unavailable')
    }
    return this.getPersistedHistoryPermission(type)
  }
  async getPersistedHistoryPermission(type: string): Promise<PermissionDecision | null> {
    try {
      const key = type === 'iab' ? 'iab_history_approval_mode' : 'history_approval_mode',
        value = await this.config.global.get(key)
      if (value !== 'disabled' && value !== 'never_ask') return null
      if (value === 'never_ask' && !(await this.allowsGlobalPersistentApproval())) return null
      return {
        decision: value === 'never_ask' ? 'approve' : 'deny',
        scope: 'global',
        source: 'browser-use-persisted-state'
      }
    } catch {
      return null
    }
  }
  async isAutoReviewDisabled() {
    try {
      if ((await this.config.global.get('disable_auto_review')) === true) return true
    } catch {}
    try {
      return requirement(await this.config.readRequirements(), 'disableAutoReview') === true
    } catch {
      return false
    }
  }
  async isOriginAutoReviewDisabled(origin: string) {
    try {
      return (await readOriginPolicy(origin, this.config)).autoReview === 'deny'
    } catch {
      return true
    }
  }
  async isPersistentApprovalAllowed(origin: string) {
    try {
      return (await readOriginPolicy(origin, this.config)).persistentApproval
    } catch {
      return false
    }
  }
  async allowsGlobalPersistentApproval() {
    try {
      return (
        requirement(await this.config.readRequirements(), 'allowGlobalPersistentApproval') !== false
      )
    } catch {
      return false
    }
  }
  captureOriginRequestContext(origin: string) {
    return contextForOrigin(this.runtime, origin)
  }
  async getOriginPermission(
    origin: string,
    context = this.captureOriginRequestContext(origin),
    options: { requireSavedPermissions?: boolean } = {}
  ) {
    return this.maybeAutoAnswerBrowserUseRequest({
      ...context,
      requireSavedPermissions: options.requireSavedPermissions ?? false,
      resource: { kind: 'origin', origin }
    })
  }
  async getFileTransferPermission(transferKind: 'download' | 'upload', origin: string) {
    const context = this.captureOriginRequestContext(origin)
    return this.maybeAutoAnswerBrowserUseRequest({
      preferenceSessionId: context.preferenceSessionId,
      turn: context.turn,
      resource: { kind: 'fileTransfer', origin, transferKind }
    })
  }
  async getFullCdpPermission(origin: string) {
    const result = await this.getOriginPermission(origin)
    if (result?.decision === 'deny') return result
    const context = this.captureOriginRequestContext(origin)
    return this.maybeAutoAnswerBrowserUseRequest({
      preferenceSessionId: context.preferenceSessionId,
      turn: context.turn,
      resource: { kind: 'fullCdp', origin }
    })
  }
  async maybeAutoAnswerBrowserUseRequest(
    request: PermissionRequest
  ): Promise<PermissionDecision | null> {
    const policy =
        request.resource.kind === 'origin'
          ? await this.getOriginPolicyDecision(request.resource.origin, 'access')
          : null,
      policyDeny =
        policy === null
          ? null
          : {
              decision: 'deny' as const,
              scope: 'global' as const,
              source:
                policy === 'deny' ? 'codex-network-policy' : 'codex-network-policy-unavailable'
            }
    let globalDeny: PermissionDecision | null = null
    try {
      const persistent = await this.isPersistentApprovalAllowed(request.resource.origin),
        table = tableFor(request.resource),
        mode = modeFor(request.resource),
        refresh = request.resource.kind === 'origin' && request.guardianMode === 'v2',
        global = await snapshotFor(
          this.config.global,
          [...(mode == null ? [] : [mode]), ...(table == null ? [] : [table])],
          refresh
        )
      if (tableMatches(global, table, 'denied', request.resource.origin))
        globalDeny = { decision: 'deny', scope: 'global', source: 'browser-use-persisted-state' }
      const conversation = table != null && validSession(request.preferenceSessionId)
        ? await snapshotFor(this.config.session(request.preferenceSessionId), [table], refresh)
        : {}
      const reviewedTurn = turnApproved(request, true)
      if (tableMatches(conversation, table, 'denied', request.resource.origin))
        return { decision: 'deny', scope: 'conversation', source: 'browser-use-persisted-state' }
      if (globalDeny) return globalDeny
      if (policyDeny) return policyDeny
      if (reviewedTurn)
        return { decision: 'approve', scope: 'turn', source: 'guardian-origin-cache' }
      if (
        request.guardianMode === 'v2' &&
        request.guardianOrigin != null &&
        guardianOriginCache.get(request.guardianOrigin) != null &&
        global.disable_auto_review !== true &&
        !(await this.isAutoReviewDisabled()) &&
        !(await this.isOriginAutoReviewDisabled(request.resource.origin)) &&
        guardianOriginCache.get(request.guardianOrigin) != null
      )
        return { decision: 'approve', scope: 'conversation', source: 'guardian-origin-cache' }
      if (turnApproved(request, false))
        return { decision: 'approve', scope: 'turn', source: 'browser-use-turn-cache' }
      if (
        tableMatches(conversation, table, 'allowed', request.resource.origin) &&
        (request.resource.kind !== 'origin' ||
          (await this.originApprovalLifetime(request.resource.origin)) === 'thread')
      )
        return { decision: 'approve', scope: 'conversation', source: 'browser-use-persisted-state' }
      if (persistent && tableMatches(global, table, 'allowed', request.resource.origin))
        return { decision: 'approve', scope: 'global', source: 'browser-use-persisted-state' }
      if (
        mode != null &&
        global[mode] === 'never_ask' &&
        persistent &&
        (await this.allowsGlobalPersistentApproval())
      )
        return { decision: 'approve', scope: 'global', source: 'browser-use-persisted-state' }
      return null
    } catch (error) {
      if (request.guardianMode === 'v2' && globalDeny) return globalDeny
      if (
        error === unavailableSnapshot ||
        (request.guardianMode === 'v2' && request.requireSavedPermissions === true)
      )
        return (
          policyDeny ?? {
            decision: 'deny',
            scope: 'global',
            source: 'browser-use-persisted-state-unavailable'
          }
        )
      return policyDeny
    }
  }
  private async originApprovalLifetime(origin: string) {
    try {
      return (await readOriginPolicy(origin, this.config)).accessApprovalLifetime
    } catch {
      return null
    }
  }
  async handleOriginPromptResult(
    origin: string,
    result: PromptResult,
    context = this.captureOriginRequestContext(origin),
    options: { guardianReview?: GuardianReview | undefined; guardianReviewRequested?: boolean } = {}
  ) {
    await this.savePrompt({ ...context, ...options, resource: { kind: 'origin', origin } }, result)
  }
  async handleFileTransferPromptResult(
    transferKind: 'download' | 'upload',
    origin: string,
    result: PromptResult
  ) {
    const context = this.captureOriginRequestContext(origin)
    await this.savePrompt(
      {
        preferenceSessionId: context.preferenceSessionId,
        turn: context.turn,
        resource: { kind: 'fileTransfer', origin, transferKind }
      },
      result
    )
  }
  async handleFullCdpPromptResult(origin: string, result: PromptResult) {
    const context = this.captureOriginRequestContext(origin)
    await this.savePrompt(
      {
        preferenceSessionId: context.preferenceSessionId,
        turn: context.turn,
        resource: { kind: 'fullCdp', origin }
      },
      result
    )
  }
  async handleHistoryPromptResult(result: PromptResult, type: string) {
    if (
      result.action === 'accept' &&
      userReviewed(result) &&
      persistenceScope(result) === 'global' &&
      (await this.allowsGlobalPersistentApproval())
    )
      try {
        await this.config.global.set(
          type === 'iab' ? 'iab_history_approval_mode' : 'history_approval_mode',
          'never_ask'
        )
      } catch {}
  }
  private async savePrompt(request: PermissionRequest, result: PromptResult) {
    try {
      if (autoReviewed(result)) {
        if (result.action === 'accept') {
          if (request.guardianMode === 'v1') recordTurnApproval(request, true)
          else if (
            request.guardianMode === 'v2' &&
            request.guardianOrigin != null &&
            request.guardianReviewRequested !== false
          )
            guardianOriginCache.record(request.guardianOrigin, request.guardianReview)
        } else if (
          request.guardianOrigin != null &&
          request.guardianReviewRequested !== false &&
          request.guardianReview?.revoked !== true &&
          result.action === 'decline' &&
          !this.reviewTimedOut(result)
        )
          guardianOriginCache.revoke(request.guardianOrigin)
        return
      }
      if (!userReviewed(result)) return
      if (result.action === 'decline' && request.guardianOrigin != null)
        guardianOriginCache.revoke(request.guardianOrigin)
      const decision =
        result.action === 'accept' ? 'approve' : result.action === 'decline' ? 'deny' : null
      if (decision === null) return
      let scope =
        persistenceScope(result) ?? (defaultConversation(request.resource) ? 'conversation' : null)
      if (scope === null) return
      const all = request.resource.kind === 'origin' && allSites(result)
      if (
        decision === 'approve' &&
        scope === 'global' &&
        (!(await this.isPersistentApprovalAllowed(request.resource.origin)) ||
          (all && !(await this.allowsGlobalPersistentApproval())))
      )
        scope = defaultConversation(request.resource) ? 'conversation' : null
      if (scope === null) return
      if (
        request.resource.kind === 'origin' &&
        decision === 'approve' &&
        scope === 'conversation'
      ) {
        const lifetime = await this.originApprovalLifetime(request.resource.origin)
        if (lifetime === null) return
        if (lifetime === 'turn') {
          recordTurnApproval(request, false)
          return
        }
      }
      if (decision === 'approve' && scope === 'global' && all) {
        await this.config.global.set('approval_mode', 'never_ask')
        return
      }
      const store =
        scope === 'global'
          ? this.config.global
          : validSession(request.preferenceSessionId)
            ? this.config.session(request.preferenceSessionId)
            : undefined
      if (store) await persistResource(store, request.resource, decision)
    } catch {}
  }
  private reviewTimedOut(result: PromptResult) {
    const message = result._meta?.message
    return (
      typeof message === 'string' &&
      message.trim().replace(/[ \t\r\n]+/g, ' ') ===
        'The automatic permission approval review did not finish before its deadline. Do not assume the action is unsafe based on the timeout alone. You may retry once, or ask the user for guidance or explicit approval.'
    )
  }
}
