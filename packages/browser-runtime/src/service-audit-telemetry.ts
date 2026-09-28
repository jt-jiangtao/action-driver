import type { SecurityAudit } from './service-security-approval.js'
const outcomes: Record<string, { decision: string; decision_context: string }> = {
  success: { decision: 'allowed', decision_context: 'evaluated' },
  success_cache_hit: { decision: 'allowed', decision_context: 'cached' },
  denied: { decision: 'denied', decision_context: 'evaluated' },
  bypassed: { decision: 'allowed', decision_context: 'not_required' },
  error_fail_open: { decision: 'allowed', decision_context: 'error' },
  error_fail_closed: { decision: 'denied', decision_context: 'error' }
}
const sources: Record<string, string> = {
  'guardian-auto-review': 'automated_review',
  'guardian-origin-cache': 'automated_review',
  user_decision: 'user',
  'browser-use-turn-cache': 'user',
  'browser-use-persisted-state': 'saved_user_permission',
  'browser-use-persisted-state-unavailable': 'saved_user_permission',
  'codex-history-policy': 'history_policy',
  'codex-history-policy-unavailable': 'history_policy',
  'codex-network-policy': 'network_policy',
  'codex-network-policy-unavailable': 'network_policy',
  'navigation-url-policy': 'builtin_rule',
  'site-status': 'openai_site_policy',
  'security-mode': 'security_mode',
  config: 'builtin_rule'
}
const permissions: Record<string, string> = {
  'automated-safety-precheck': 'browser_auth',
  'browser-history-read': 'browser_history',
  'browser-origin-access': 'origin_access',
  'check-navigation-url-policy': 'origin_access',
  'check-url-site-status': 'origin_access',
  'file-download': 'file_download',
  'file-upload': 'file_upload',
  'full-cdp': 'full_cdp_access',
  'page-asset-cross-origin-fetch': 'page_asset_cross_origin_fetch',
  'page-asset-download': 'page_asset_download',
  'raw-cdp-destination-url': 'raw_cdp_destination',
  'webmcp-tool-call': 'webmcp_access'
}
export function securityAuditTelemetry(event: SecurityAudit) {
  if (
    event.background ||
    (['check-navigation-url-policy', 'check-url-site-status'].includes(event.check) &&
      event.outcome !== 'denied')
  )
    return undefined
  const decision = { ...outcomes[event.outcome] }
  if (event.reason === 'approval_cancelled') decision.decision_context = 'cancelled'
  else if (
    event.cached ||
    (event.outcome === 'success' &&
      ['guardian-origin-cache', 'browser-use-turn-cache'].includes(
        event.permissionSource as string
      ))
  )
    decision.decision_context = 'cached'
  return {
    schema_version: 1,
    permission: permissions[(event.authorization ?? event.check) as string],
    ...decision,
    decided_by:
      event.permissionSource === undefined ? 'unknown' : sources[event.permissionSource as string],
    policy: event.policy,
    reason: event.reason,
    origin: event.origin,
    connector_id: event.connectorId,
    tool_name: event.toolName,
    backend: event.backend,
    duration_ms: event.durationMs,
    http_status: event.httpStatus
  }
}
