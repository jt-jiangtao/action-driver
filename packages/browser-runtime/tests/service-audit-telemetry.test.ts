// @vitest-environment node
import { test, expect } from 'vitest'
import { securityAuditTelemetry } from '../src/service-audit-telemetry'
import { originalDocumentation } from './original-service'
test('audit telemetry preserves decisions, permissions, policy sources and bounded suppression', async () => {
  const base = await originalDocumentation()
  const checks = [
    'automated-safety-precheck',
    'browser-history-read',
    'browser-origin-access',
    'check-navigation-url-policy',
    'check-url-site-status',
    'file-download',
    'file-upload',
    'full-cdp',
    'page-asset-cross-origin-fetch',
    'page-asset-download',
    'raw-cdp-destination-url',
    'webmcp-tool-call',
    'unknown'
  ]
  const outcomes = [
    'success',
    'success_cache_hit',
    'denied',
    'bypassed',
    'error_fail_open',
    'error_fail_closed',
    'unknown'
  ]
  const sources = [
    undefined,
    'guardian-auto-review',
    'guardian-origin-cache',
    'user_decision',
    'browser-use-turn-cache',
    'browser-use-persisted-state',
    'browser-use-persisted-state-unavailable',
    'codex-history-policy',
    'codex-history-policy-unavailable',
    'codex-network-policy',
    'codex-network-policy-unavailable',
    'navigation-url-policy',
    'site-status',
    'security-mode',
    'config',
    'unknown'
  ]
  for (const check of checks)
    for (const outcome of outcomes)
      for (const permissionSource of sources)
        for (const override of [
          {},
          { background: true },
          { cached: true },
          { reason: 'approval_cancelled' },
          { authorization: 'file-upload' }
        ]) {
          const audit = {
            check,
            outcome,
            permissionSource,
            ...override,
            policy: 'enterprise',
            origin: 'https://example.com',
            connectorId: 'connector',
            toolName: 'tool',
            backend: 'extension',
            durationMs: 10,
            httpStatus: 403
          }
          expect(securityAuditTelemetry(audit)).toEqual(base.baselineAuditTelemetry(audit))
        }
})
