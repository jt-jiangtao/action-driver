import {
  approvalDuration,
  approvalSucceeded,
  createApprovalRequest,
  isReviewTimeout,
  securityFailure
} from './service-security-approval.js'
import type { Elicitation, SecurityOptions, SecurityReason } from './service-security-approval.js'
import { autoReviewed } from './service-permission-state.js'
import { securityMode } from './service-security-mode.js'
export interface SafetyRuntime {
  env: Record<string, string | undefined>
  createElicitation?: Elicitation
}
interface Timing {
  trackElicitation(run: Elicitation): Elicitation
}
interface CapturedRuntime {
  env: SafetyRuntime['env']
  mode: string | undefined
  enabled: boolean
  createElicitation: Elicitation | undefined
}
let captured: CapturedRuntime | undefined
/** Pin trusted host identity for the lifetime of one service assembly. */
export function captureSafetyRuntime(runtime: SafetyRuntime) {
  if (captured !== undefined) return () => {}
  const state = Object.freeze({
    env: runtime.env,
    mode: runtime.env.BROWSER_USE_SECURITY_MODE,
    enabled: runtime.env.BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED === '1',
    createElicitation: runtime.createElicitation
  })
  captured = state
  return () => {
    if (captured === state) captured = undefined
  }
}
const enabled = (runtime: SafetyRuntime) =>
  captured !== undefined
    ? captured.mode?.trim() === 'gaas-browser-environment' && captured.enabled
    : securityMode(runtime) === 'gaas-browser-environment' &&
      runtime.env.BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED === '1'
const identityMatches = (runtime: SafetyRuntime) =>
  captured === undefined ||
  (runtime.env === captured.env &&
    runtime.env.BROWSER_USE_SECURITY_MODE === captured.mode &&
    (runtime.env.BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED === '1') === captured.enabled)
export function createSafetyPrecheck(
  runtime: SafetyRuntime,
  timing: Timing,
  options: SecurityOptions = {}
) {
  if (!enabled(runtime)) return undefined
  const name = options.elicitationDisplayName ?? 'Browser use'
  const fail = (reason: SecurityReason, message: string, durationMs?: number): never =>
    securityFailure(
      {
        check: 'automated-safety-precheck',
        durationMs,
        options,
        ...(reason === 'guardian_denied' || reason === 'guardian_timed_out'
          ? { permissionSource: 'guardian-auto-review' }
          : {}),
        reason
      },
      `${message} ${name} stopped before creating a user prompt or action.`
    )
  const request = createApprovalRequest(
    () => {
      const prompt =
        captured === undefined
          ? runtime.createElicitation
          : identityMatches(runtime)
            ? captured.createElicitation
            : undefined
      if (captured === undefined && typeof prompt !== 'function')
        throw Error('Browser security elicitation is unavailable')
      return prompt === undefined ? undefined : timing.trackElicitation(prompt)
    },
    {
      check: 'automated-safety-precheck',
      errorMessage: `Auto-review could not complete the required safety review for this ${name} action.`,
      options
    }
  )
  return async ({
    message,
    toolName,
    toolParams
  }: {
    message: string
    toolName: string
    toolParams: unknown
  }) => {
    if (!enabled(runtime) || !identityMatches(runtime))
      fail(
        'approval_unavailable',
        `The required auto-review functionality for this ${name} feature is not supported in this environment.`
      )
    if (!toolName.trim()) throw Error('Auto-review safety precheck requires a tool name')
    const result = await request({
        message,
        requestedSchema: { type: 'object', properties: {}, additionalProperties: false },
        meta: {
          codex_request_type: 'approval_request',
          codex_approval_kind: 'mcp_tool_call',
          codex_strict_auto_review: true,
          codex_sensitive_action: true,
          connector_id: 'browser-use',
          connector_name: name,
          tool_name: `automated_safety_precheck.${toolName.trim()}`,
          tool_description: message,
          tool_params: toolParams
        }
      }),
      reviewed = autoReviewed(result),
      declined =
        result.action === 'decline' && (reviewed || result._meta?.approvals_reviewer == null)
    if (result.action === 'accept' && reviewed) {
      approvalSucceeded(
        'automated-safety-precheck',
        options,
        'guardian-auto-review',
        undefined,
        approvalDuration(result)
      )
      return result
    }
    const messageText = result._meta?.message,
      denial =
        typeof messageText === 'string' && messageText.trim()
          ? messageText
          : 'Auto-review did not grant approval for this browser action.'
    fail(
      isReviewTimeout(result)
        ? 'guardian_timed_out'
        : declined
          ? 'guardian_denied'
          : result.action === 'cancel' && reviewed
            ? 'approval_cancelled'
            : 'approval_failed_closed',
      declined ? denial : 'Auto-review did not return a valid safety approval for this action.',
      declined ? approvalDuration(result) : undefined
    )
  }
}
