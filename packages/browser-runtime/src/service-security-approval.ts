import { securityPolicyError } from './service-preferences.js'
import { autoReviewed } from './service-permission-state.js'
import type { PromptResult } from './service-permission-state.js'
const reasons = {
  approval_cancelled: [
    'approval',
    'The permission request was dismissed before a decision was made.',
    true
  ],
  approval_failed_closed: [
    'approval',
    'The permission request could not complete, so access was not granted.',
    true
  ],
  approval_unavailable: ['approval', 'Browser Use could not request permission.', true],
  browser_capability_blocked: [
    'browser',
    'The browser capability policy blocks this action.',
    false
  ],
  browser_capability_unavailable: [
    'browser',
    'The browser capability policy could not be verified, so access was not granted.',
    true
  ],
  browser_context_unavailable: [
    'browser',
    'The browser context needed for this action is unavailable.',
    true
  ],
  browser_navigation_blocked: [
    'browser',
    'The browser blocked this navigation; this was not a site-status decision or a user rejection.',
    false
  ],
  enterprise_policy_blocked: ['enterprise', 'The admin-enforced policy blocks this action.', false],
  enterprise_policy_unavailable: [
    'enterprise',
    'The admin-enforced policy could not be verified, so access was not granted.',
    true
  ],
  guardian_denied: [
    'guardian',
    'Auto-review denied this action; this was not a manual user rejection.',
    false
  ],
  guardian_timed_out: [
    'guardian',
    'Auto-review timed out without an approval decision; this was not a determination that the action was unsafe. You may retry once.',
    true
  ],
  navigation_url_policy_blocked: ['browser', 'The browser URL policy blocks this action.', false],
  persisted_user_denied: [
    'user_persisted_setting',
    'A saved user permission setting blocks this action.',
    false
  ],
  site_status_blocked: [
    'site_status',
    'The site-safety policy blocks this action; no user permission prompt or Auto-review was attempted.',
    false
  ],
  site_status_unavailable: ['site_status', 'The site-safety check was unavailable.', true],
  user_declined: ['user_decision', 'The user declined permission for this action.', false]
} as const
export type SecurityReason = keyof typeof reasons
export class BrowserUseSecurityError extends Error {
  decisionSource: string
  retryable: boolean
  constructor(
    public reason: SecurityReason,
    context: string,
    options?: ErrorOptions
  ) {
    const [source, message, retryable] = reasons[reason],
      detail = `${message} ${context}`
    super(
      retryable
        ? `Browser Use could not complete this action because a browser security check was unavailable. Reason: ${detail} This failure may be temporary. The agent may retry after the issue is resolved, but must not bypass browser security controls or use an indirect workaround.`
        : securityPolicyError(detail).message,
      options
    )
    this.name = 'BrowserUseSecurityError'
    this.decisionSource = source
    this.retryable = retryable
  }
}
export interface SecurityOptions {
  elicitationDisplayName?: string
  browserBackend?: string
  browserFamily?: string
}
export interface SecurityAudit extends Record<string, unknown> {
  check: string
  outcome: string
}
let auditHandler: ((event: SecurityAudit) => unknown) | undefined
export function setSecurityAudit(handler: typeof auditHandler) {
  auditHandler = handler
}
export function emitSecurityAudit(event: () => SecurityAudit) {
  try {
    const result = auditHandler?.(event())
    if (result != null) void Promise.resolve(result).catch(() => {})
  } catch {}
}
export function approvalSucceeded(
  check: string,
  options: SecurityOptions | undefined,
  source: string | undefined,
  details?: Record<string, unknown>,
  durationMs?: number
) {
  emitSecurityAudit(() => ({
    ...details,
    backend: options?.browserBackend,
    browserFamily: options?.browserFamily,
    check,
    durationMs,
    outcome: 'success',
    permissionSource: source
  }))
}
interface Failure {
  check: string
  reason: SecurityReason
  options?: SecurityOptions | undefined
  audit?: Record<string, unknown> | undefined
  durationMs?: number | undefined
  permissionSource?: string | undefined
}
export function securityFailure(input: Failure, message: string, cause?: unknown): never {
  const error = new BrowserUseSecurityError(
    input.reason,
    message,
    cause === undefined ? undefined : { cause }
  )
  emitSecurityAudit(() => ({
    ...input.audit,
    backend: input.options?.browserBackend,
    browserFamily: input.options?.browserFamily,
    check: input.check,
    durationMs: input.durationMs,
    outcome: error.retryable ? 'error_fail_closed' : 'denied',
    permissionSource: input.permissionSource,
    reason: input.reason
  }))
  throw error
}
const deniedSources: Record<string, [SecurityReason, string]> = {
  'browser-use-persisted-state': [
    'persisted_user_denied',
    'the user has a saved preference that blocks it.'
  ],
  'browser-use-persisted-state-unavailable': [
    'approval_unavailable',
    'saved browser permissions could not be verified. Please try again later.'
  ],
  'codex-history-policy': [
    'browser_capability_blocked',
    'the Browser Use history-access policy blocks it.'
  ],
  'codex-history-policy-unavailable': [
    'browser_capability_unavailable',
    'the Browser Use history-access policy could not be verified. Please try again later.'
  ],
  'codex-network-policy': ['enterprise_policy_blocked', 'the admin-enforced policy blocks it.'],
  'codex-network-policy-unavailable': [
    'enterprise_policy_unavailable',
    'the admin-enforced policy could not be verified. Please try again later.'
  ],
  user_decision: ['user_declined', 'the user denied permission for this request.']
}
export function denyPermission(
  check: string,
  source: string,
  action: string,
  options?: SecurityOptions,
  details?: Record<string, unknown>,
  durationMs?: number,
  guardian?: { message?: string | undefined; timedOut?: boolean }
): never {
  let [reason, explanation] = deniedSources[source] ?? [
    'user_declined',
    'the user denied permission for this request.'
  ]
  if (source === 'guardian-auto-review') {
    reason = guardian?.timedOut ? 'guardian_timed_out' : 'guardian_denied'
    explanation = guardian?.timedOut
      ? 'Auto-review did not finish before it could grant permission for this request.'
      : 'Auto-review denied permission for this request.'
    if (guardian?.message?.trim()) explanation += '\n' + guardian.message
  }
  return securityFailure(
    { audit: details, check, durationMs, options, permissionSource: source, reason },
    `${options?.elicitationDisplayName ?? 'Browser use'} cannot ${action} because ${explanation}`
  )
}
export const reviewTimeoutMessage =
  'The automatic permission approval review did not finish before its deadline. Do not assume the action is unsafe based on the timeout alone. You may retry once, or ask the user for guidance or explicit approval.'
export function isReviewTimeout(result: PromptResult) {
  const message = result._meta?.message
  return (
    result.action === 'decline' &&
    autoReviewed(result) &&
    typeof message === 'string' &&
    message.trim().replace(/[ \t\r\n]+/g, ' ') === reviewTimeoutMessage
  )
}
const durations = new WeakMap<object, number>()
export const approvalDuration = (result: PromptResult) => durations.get(result)
export function checkApprovalResult(
  check: string,
  result: PromptResult,
  action: string,
  options?: SecurityOptions,
  details?: Record<string, unknown>,
  defaultSource = 'user_decision'
) {
  let source: string | undefined,
    message: string | undefined,
    timedOut = false
  try {
    source = autoReviewed(result) ? 'guardian-auto-review' : defaultSource
    timedOut = isReviewTimeout(result)
    if (typeof result._meta?.message === 'string') message = result._meta.message
  } catch {}
  const duration = source === 'guardian-auto-review' ? durations.get(result) : undefined,
    request = `${options?.elicitationDisplayName ?? 'Browser use'} cannot ${action} because the permission request`
  if (result.action === 'accept')
    return approvalSucceeded(check, options, source, details, duration)
  if (result.action === 'decline')
    return denyPermission(check, source ?? defaultSource, action, options, details, duration, {
      message,
      timedOut
    })
  securityFailure(
    {
      audit: details,
      check,
      options,
      reason: result.action === 'cancel' ? 'approval_cancelled' : 'approval_failed_closed'
    },
    result.action === 'cancel'
      ? `${request} was dismissed; no explicit denial was made.`
      : `${request} returned an unrecognized action; no explicit denial was made.`
  )
}
export type Elicitation = (params: Record<string, unknown>) => Promise<PromptResult>
export function createApprovalRequest(
  get: () => Elicitation | null | undefined,
  input: {
    check: string
    errorMessage: string
    options?: SecurityOptions
    audit?: Record<string, unknown>
  }
): Elicitation {
  let create: Elicitation | null | undefined
  const fail = (reason: SecurityReason, cause?: unknown): never =>
    securityFailure(
      { audit: input.audit, check: input.check, options: input.options, reason },
      input.errorMessage,
      cause
    )
  try {
    create = get()
  } catch (error) {
    return fail('approval_unavailable', error)
  }
  if (create == null) return fail('approval_unavailable')
  const run = create
  return async (params) => {
    let result: PromptResult
    const start = performance.now()
    try {
      result = await run(params)
      durations.set(result, Math.round(Math.max(0, performance.now() - start)))
    } catch (error) {
      return fail('approval_failed_closed', error)
    }
    if (!['accept', 'decline', 'cancel'].includes(result?.action))
      return fail('approval_failed_closed')
    return result
  }
}
