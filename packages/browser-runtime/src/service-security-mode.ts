import { emitSecurityAudit } from './service-security-approval.js'
export interface SecurityModeHost {
  env: Record<string, string | undefined>
}
export function securityMode(
  host: SecurityModeHost
): '' | 'disabled-for-local-testing' | 'gaas-browser-environment' {
  const mode = host.env.BROWSER_USE_SECURITY_MODE?.trim()
  return mode === 'disabled-for-local-testing' || mode === 'gaas-browser-environment' ? mode : ''
}
const localConsent = new Set([
  'browser-history-read',
  'browser-origin-access',
  'file-download',
  'file-upload',
  'full-cdp',
  'page-asset-cross-origin-fetch',
  'page-asset-download',
  'raw-cdp-destination-url',
  'webmcp-tool-call'
])
const localChecks = new Set(
  [...localConsent]
    .filter((value) => value !== 'webmcp-tool-call')
    .concat(['check-navigation-url-policy', 'check-url-site-status'])
)
const cloudConsent = new Set([
  'browser-history-read',
  'file-download',
  'page-asset-cross-origin-fetch',
  'page-asset-download'
])
function decision(host: SecurityModeHost, check: string, consent: boolean) {
  const mode = securityMode(host),
    bypassed =
      mode === 'disabled-for-local-testing'
        ? (consent ? localConsent : localChecks).has(check)
        : mode === 'gaas-browser-environment' && consent && cloudConsent.has(check)
  if (bypassed)
    emitSecurityAudit(() => ({
      check,
      outcome: 'bypassed',
      permissionSource: 'security-mode',
      policy: mode
    }))
  return bypassed
}
export function bypassesSecurityCheck(host: SecurityModeHost, check: string) {
  return decision(host, check, false)
}
export function withoutUserConsent(host: SecurityModeHost, check: string) {
  return decision(host, check, true)
}
