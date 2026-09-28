import { guardianOriginCache } from './service-guardian-cache.js'
import type { GuardianApproval, GuardianReview } from './service-guardian-cache.js'
import { autoReviewed } from './service-permission-state.js'
import type { PromptResult } from './service-permission-state.js'
import { BrowserUseSecurityError } from './service-security-approval.js'
import {
  emitSecurityAudit,
  approvalSucceeded,
  createApprovalRequest,
  checkApprovalResult,
  denyPermission,
  securityFailure
} from './service-security-approval.js'
import type { SecurityOptions, Elicitation } from './service-security-approval.js'
import type { BrowserPreferences, PermissionDecision } from './service-preferences.js'
type GetElicitation = () => Elicitation | null | undefined
type Preferences = Pick<
  BrowserPreferences,
  | 'getHistoryPermission'
  | 'getFileTransferPermission'
  | 'getFullCdpPermission'
  | 'isPersistentApprovalAllowed'
  | 'allowsGlobalPersistentApproval'
  | 'handleHistoryPromptResult'
  | 'handleFileTransferPromptResult'
  | 'handleFullCdpPromptResult'
>
const label = (options: SecurityOptions) => options.elicitationDisplayName ?? 'Browser use'
export function pageOrigin(input: string | null | undefined): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  try {
    const url = new URL(input)
    if (url.protocol === 'file:') {
      url.search = ''
      url.hash = ''
      return url.href
    }
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null
  } catch {
    return null
  }
}
export function httpOrigin(input: string | null | undefined): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  try {
    const url = new URL(input)
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null
  } catch {
    return null
  }
}
function savedDecision(
  check: string,
  decision: PermissionDecision | null,
  action: string,
  options: SecurityOptions,
  audit?: Record<string, unknown>
) {
  if (decision?.decision === 'approve') {
    approvalSucceeded(check, options, decision.source, audit)
    return true
  }
  if (decision?.decision === 'deny') denyPermission(check, decision.source, action, options, audit)
  return false
}
export async function approveHistory(
  get: GetElicitation,
  params: Record<string, unknown>,
  backend: string,
  prefs: Preferences,
  options: SecurityOptions = {}
) {
  const name = label(options),
    check = 'browser-history-read',
    action = 'read browsing history'
  if (savedDecision(check, await prefs.getHistoryPermission(backend), action, options)) return
  const ask = createApprovalRequest(get, {
      check,
      errorMessage: `${name} could not obtain an approval decision for browsing history. Browser Use is failing closed; no explicit denial was made.`,
      options
    }),
    persistent = await prefs.allowsGlobalPersistentApproval(),
    result = await ask({
      message: `Allow ${name} to use your browsing history for this task?`,
      meta: {
        codex_approval_kind: 'mcp_tool_call',
        connector_id: 'browser-use',
        connector_name: name,
        ...(persistent ? { persist: 'always' } : {}),
        subtitle:
          'ChatGPT can use records of pages visited, including from earlier sessions, to help with this task.',
        tool_params: params,
        sensitive_data: 'browsing_history'
      }
    })
  await prefs.handleHistoryPromptResult(result, backend)
  checkApprovalResult(check, result, action, options)
}
export async function approveFileTransfer(
  get: GetElicitation,
  kind: 'upload' | 'download',
  url: string,
  prefs: Preferences,
  options: SecurityOptions = {}
) {
  const audit = { origin: httpOrigin(url) ?? undefined },
    name = label(options),
    check = kind === 'download' ? 'file-download' : 'file-upload',
    action = kind === 'download' ? 'download files from' : 'upload files to',
    origin = pageOrigin(url)
  if (origin === null)
    securityFailure(
      { audit, check, options, reason: 'browser_context_unavailable' },
      `${name} could not determine the current page origin before attempting to ${kind} files from ${url}.`
    )
  if (
    savedDecision(
      check,
      await prefs.getFileTransferPermission(kind, origin),
      `${action} ${url}`,
      options,
      audit
    )
  )
    return
  const ask = createApprovalRequest(get, {
      audit,
      check,
      options,
      errorMessage: `${name} could not complete the permission request to ${kind} files on ${url}. Please use another source or try another approach.`
    }),
    persistent = await prefs.isPersistentApprovalAllowed(origin),
    result = await ask({
      message: kind === 'download' ? `Allow download from ${url}?` : `Allow upload to ${url}?`,
      meta: {
        codex_approval_kind: 'mcp_tool_call',
        connector_id: 'browser-use',
        connector_name: name,
        persist: persistent ? ['session', 'always'] : 'session',
        tool_name: kind === 'download' ? 'download_browser_files' : 'upload_browser_files',
        tool_title: kind === 'download' ? 'Download browser files' : 'Upload browser files',
        tool_params: { origin },
        file_transfer: kind,
        origin
      }
    })
  await prefs.handleFileTransferPromptResult(kind, origin, result)
  checkApprovalResult(check, result, `${action} ${url}`, options, audit)
}
export async function approveFullCdp(
  get: GetElicitation,
  url: string,
  prefs: Preferences,
  options: SecurityOptions = {},
  check = 'full-cdp'
) {
  const name = label(options),
    origin = httpOrigin(url),
    audit = { origin: origin ?? undefined }
  if (origin === null)
    securityFailure(
      { audit, check, options, reason: 'browser_context_unavailable' },
      'Raw CDP requires an HTTP(S) page. Navigate to the tab first then use the CDP capability.'
    )
  const action = `use raw CDP on ${origin}`
  if (savedDecision(check, await prefs.getFullCdpPermission(origin), action, options, audit)) return
  const ask = createApprovalRequest(get, {
      audit,
      check,
      options,
      errorMessage: `${name} could not complete the permission request to use raw CDP on ${origin}. Please try another approach.`
    }),
    persistent = await prefs.isPersistentApprovalAllowed(origin),
    result = await ask({
      message: `Allow ${name} to use full Chrome Developer Tools access on ${origin}`,
      meta: {
        codex_approval_kind: 'mcp_tool_call',
        connector_id: 'browser-use',
        connector_name: name,
        persist: persistent ? 'always' : undefined,
        riskLevel: 'high',
        tool_name: 'access_browser_origin_with_raw_cdp',
        tool_title: 'Use raw CDP on browser origin',
        tool_params: { origin },
        tool_params_display: [],
        full_cdp_access: true,
        origin
      }
    })
  await prefs.handleFullCdpPromptResult(origin, result)
  checkApprovalResult(check, result, action, options, audit)
}
async function approveAssetDownload(
  get: GetElicitation,
  origin: string,
  check: string,
  message: string,
  prefs: Preferences,
  options: SecurityOptions
) {
  const audit = { origin: httpOrigin(origin) ?? undefined },
    action = `download page assets from ${origin}`,
    name = label(options)
  if (
    savedDecision(
      check,
      await prefs.getFileTransferPermission('download', origin),
      action,
      options,
      audit
    )
  )
    return
  const ask = createApprovalRequest(get, {
      audit,
      check,
      options,
      errorMessage: `${name} could not complete the permission request to download page assets from ${origin}. Please use another source or try another approach.`
    }),
    persistent = await prefs.isPersistentApprovalAllowed(origin),
    result = await ask({
      message,
      meta: {
        codex_approval_kind: 'mcp_tool_call',
        connector_id: 'browser-use',
        connector_name: name,
        persist: persistent ? ['session', 'always'] : 'session',
        tool_params: { asset_origins: [origin] },
        tool_params_display: [
          { name: 'asset_origins', display_name: 'Download from', value: origin }
        ]
      }
    })
  await prefs.handleFileTransferPromptResult('download', origin, result)
  checkApprovalResult(check, result, action, options, audit)
}
export async function approvePageAssets(
  get: GetElicitation,
  url: string | null | undefined,
  prefs: Preferences,
  options: SecurityOptions = {}
) {
  const name = label(options),
    origin = pageOrigin(url)
  if (origin === null)
    securityFailure(
      { check: 'page-asset-download', options, reason: 'browser_context_unavailable' },
      `${name} could not determine the current page origin before attempting to download page assets from ${url ?? 'the current page'}.`
    )
  await approveAssetDownload(
    get,
    origin,
    'page-asset-download',
    `I need your permission to download assets used by ${new URL(origin).host || origin}`,
    prefs,
    options
  )
}
export async function approveAssetOrigin(
  get: GetElicitation,
  pageUrl: string,
  assetUrl: string,
  prefs: Preferences,
  options: SecurityOptions = {}
) {
  const origin = pageOrigin(assetUrl)
  if (origin === null || origin === pageOrigin(pageUrl)) {
    emitSecurityAudit(() => ({
      check: 'page-asset-cross-origin-fetch',
      outcome: 'bypassed',
      permissionSource: 'config',
      policy: 'not-cross-origin',
      origin: httpOrigin(pageUrl) ?? undefined,
      backend: options.browserBackend,
      browserFamily: options.browserFamily
    }))
    return
  }
  await approveAssetDownload(
    get,
    origin,
    'page-asset-cross-origin-fetch',
    `I need your permission to download an asset from ${new URL(origin).host || origin}`,
    prefs,
    options
  )
}
interface WebMcpPermissionRequest {
  type: string
  toolName?: string | undefined
  toolTitle?: string | undefined
  toolDescription?: string | undefined
  toolOrigin?: string | undefined
  input?: unknown
}
function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(jsonValue)
  return typeof value === 'object' && Object.values(value).every(jsonValue)
}
export async function approveWebMcp(
  get: GetElicitation,
  pageUrl: string,
  request: WebMcpPermissionRequest,
  options: SecurityOptions = {}
) {
  const check = 'webmcp-tool-call',
    audit = {
      connectorId: 'browser-use',
      origin: httpOrigin(pageUrl) ?? undefined,
      toolName: request.type === 'webmcp_invoke_tool' ? request.toolName : undefined
    },
    name = label(options),
    page = pageOrigin(pageUrl)
  if (page === null)
    securityFailure(
      { audit, check, options, reason: 'browser_context_unavailable' },
      `${name} could not determine the current page origin before attempting to use WebMCP tools.`
    )
  if (request.type === 'webmcp_list_tools') return audit
  const origin = pageOrigin(request.toolOrigin)
  if (origin === null)
    securityFailure(
      { audit, check, options, reason: 'browser_context_unavailable' },
      `${name} could not determine the WebMCP tool origin before requesting approval.`
    )
  audit.origin = httpOrigin(origin) ?? undefined
  const ask = createApprovalRequest(get, {
    audit,
    check,
    options,
    errorMessage: `${name} could not obtain an approval decision to use WebMCP tools on ${page}. Browser Use is failing closed; no explicit denial was made.`
  })
  let sanitized: string | undefined
  try {
    const url = new URL(pageUrl)
    if (['http:', 'https:'].includes(url.protocol)) {
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      sanitized = url.href
    }
  } catch {}
  const host = new URL(origin).host,
    toolName = request.toolName!,
    nameKey = `webmcp:${encodeURIComponent(host)}:${encodeURIComponent(toolName)}`,
    title = request.toolTitle == null ? toolName : `${request.toolTitle} (${toolName})`
  if (!jsonValue(request.input))
    securityFailure(
      { audit, check, options, reason: 'browser_context_unavailable' },
      `${name} could not serialize the WebMCP tool arguments before requesting approval.`
    )
  const result = await ask({
    message: `Allow ${name} to invoke WebMCP tool ${toolName} on ${origin}?`,
    meta: {
      codex_approval_kind: 'mcp_tool_call',
      codex_request_type: 'approval_request',
      codex_strict_auto_review: true,
      codex_sensitive_action: true,
      connector_id: 'browser-use',
      connector_name: name,
      tool_name: nameKey,
      tool_title: `Invoke ${title} on ${host}`,
      tool_description: request.toolDescription,
      tool_params: request.input,
      origin,
      ...(sanitized == null ? {} : { page_url: sanitized })
    }
  })
  checkApprovalResult(
    check,
    result,
    `use WebMCP tools on ${origin}`,
    options,
    audit,
    'guardian-auto-review'
  )
  return audit
}
type OriginPreferences = Pick<
  BrowserPreferences,
  | 'captureOriginRequestContext'
  | 'getOriginPermission'
  | 'isAutoReviewDisabled'
  | 'isOriginAutoReviewDisabled'
  | 'isPersistentApprovalAllowed'
  | 'handleOriginPromptResult'
>
interface ApprovalTiming {
  trackElicitation: (
    run: (value: Promise<unknown>) => Promise<unknown>
  ) => (value: Promise<unknown>) => Promise<unknown>
}
export async function approveOrigin(
  get: GetElicitation,
  origin: string,
  prefs: OriginPreferences,
  options: SecurityOptions = {},
  beforePrompt?: Promise<unknown>,
  timing: ApprovalTiming = { trackElicitation: (run) => run }
) {
  const context = prefs.captureOriginRequestContext(origin),
    name = label(options),
    audit = { origin: httpOrigin(origin) ?? undefined },
    check = 'browser-origin-access',
    disabled = async () =>
      (await prefs.isAutoReviewDisabled()) || (await prefs.isOriginAutoReviewDisabled(origin))
  const checkDeny = (permission: PermissionDecision | null) => {
    if (permission?.decision === 'deny')
      denyPermission(check, permission.source, `access ${origin}`, options, audit)
  }
  for (;;) {
    const prior = guardianOriginCache.get(context.guardianOrigin),
      permission = await prefs.getOriginPermission(origin, context)
    if (permission?.decision === 'approve') {
      if (
        context.guardianMode === 'v2' &&
        permission.source === 'guardian-origin-cache' &&
        (prior == null || guardianOriginCache.get(context.guardianOrigin) !== prior)
      )
        continue
      approvalSucceeded(check, options, permission.source, audit)
      return
    }
    await beforePrompt
    checkDeny(permission)
    const autoDisabled = await disabled(),
      persistent = await prefs.isPersistentApprovalAllowed(origin),
      errorMessage = autoDisabled
        ? `${name} could not obtain an approval decision for ${origin}. Browser Use is failing closed; no explicit denial was made.`
        : `Auto-review could not complete for ${origin}. Browser Use is failing closed; no explicit denial was made.`
    const request = async (review?: GuardianReview) => {
      const ask = createApprovalRequest(get, { audit, check, errorMessage, options }),
        result = await ask({
          message: `Allow ${name} to access ${origin}?`,
          meta: {
            codex_approval_kind: 'mcp_tool_call',
            codex_sensitive_action: true,
            ...(autoDisabled ? {} : { codex_request_type: 'approval_request' }),
            connector_id: 'browser-use',
            connector_name: name,
            persist: persistent ? 'always' : undefined,
            tool_name: 'access_browser_origin',
            tool_title: 'Access browser origin',
            tool_params: { origin },
            tool_params_display: [],
            origin
          }
        })
      if (
        context.guardianMode === 'v2' &&
        !autoDisabled &&
        context.guardianOrigin != null &&
        result.action === 'accept' &&
        !autoReviewed(result)
      )
        checkDeny(
          await prefs.getOriginPermission(origin, context, { requireSavedPermissions: true })
        )
      await prefs.handleOriginPromptResult(origin, result, context, {
        guardianReview: review,
        guardianReviewRequested: !autoDisabled
      })
      return result
    }
    let decision: { result: PromptResult; approval: GuardianApproval | undefined }
    const guardian =
      context.guardianMode === 'v2' && !autoDisabled ? context.guardianOrigin : undefined
    if (guardian == null) decision = { result: await request(), approval: undefined }
    else {
      const pending = guardianOriginCache.start(guardian, prior, request)
      if (pending.kind === 'retry') continue
      if (pending.shared) {
        try {
          decision = (await timing.trackElicitation((value) => value)(
            pending.decision
          )) as typeof decision
        } catch (error) {
          if (!(error instanceof BrowserUseSecurityError)) throw error
          if (!['approval_failed_closed', 'approval_unavailable'].includes(error.reason)) continue
          securityFailure({ audit, check, options, reason: error.reason }, errorMessage, error)
        }
        if (decision.result.action !== 'cancel' && !autoReviewed(decision.result)) continue
      } else decision = (await pending.decision) as typeof decision
    }
    if (context.guardianMode === 'v2' && decision.result.action === 'accept') {
      const automatic = autoReviewed(decision.result)
      if (!(!automatic && (autoDisabled || context.guardianOrigin == null))) {
        checkDeny(
          await prefs.getOriginPermission(origin, context, {
            requireSavedPermissions: !autoDisabled && context.guardianOrigin != null
          })
        )
        if (automatic && !autoDisabled) {
          if (await disabled()) continue
          if (
            context.guardianOrigin != null &&
            (decision.approval == null ||
              guardianOriginCache.get(context.guardianOrigin) !== decision.approval)
          )
            continue
        }
      }
    }
    checkApprovalResult(check, decision.result, `access ${origin}`, options, audit)
    return
  }
}
