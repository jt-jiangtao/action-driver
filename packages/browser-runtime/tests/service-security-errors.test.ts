// @vitest-environment node
import { test, expect } from 'vitest'
import {
  BrowserUseSecurityError,
  checkApprovalResult,
  createApprovalRequest,
  denyPermission,
  setSecurityAudit
} from '../src/service-security-approval'
import { originalDocumentation } from './original-service'
function details(error: any) {
  return {
    message: error.message,
    name: error.name,
    decisionSource: error.decisionSource,
    reason: error.reason,
    retryable: error.retryable,
    cause: error.cause?.message
  }
}
test('all security reason properties, retry guidance and cause match original', async () => {
  const base = await originalDocumentation()
  for (const reason of Object.keys(base.baselineSecurityReasons)) {
    const cause = Error('cause')
    expect(details(new BrowserUseSecurityError(reason as any, 'context', { cause }))).toEqual(
      details(new base.BaselineSecurityError(reason, 'context', { cause }))
    )
  }
})
test('approval results produce original audit events and distinguish manual/automatic declines and cancellations', async () => {
  const base = await originalDocumentation()
  const options = {
    elicitationDisplayName: 'Browser',
    browserBackend: 'iab',
    browserFamily: 'chrome'
  }
  for (const result of [
    { action: 'accept' },
    { action: 'decline' },
    { action: 'decline', _meta: { approvals_reviewer: 'auto_review', message: 'reason' } },
    { action: 'cancel' },
    { action: 'unknown' }
  ]) {
    async function exercise(check: any, set: any) {
      const audit: any[] = []
      set((value: any) => audit.push(value))
      let error
      try {
        check('browser-origin-access', result, 'access example', options, {
          origin: 'https://example.com'
        })
      } catch (e) {
        error = details(e)
      }
      set(undefined)
      return { audit, error }
    }
    expect(await exercise(checkApprovalResult, setSecurityAudit)).toEqual(
      await exercise(base.baselineCheckApproval, base.baselineSetAudit)
    )
  }
})
test('permission denial sources preserve precise reasons and audit failures are isolated', async () => {
  const base = await originalDocumentation()
  for (const source of [
    'browser-use-persisted-state',
    'browser-use-persisted-state-unavailable',
    'codex-history-policy',
    'codex-history-policy-unavailable',
    'codex-network-policy',
    'codex-network-policy-unavailable',
    'user_decision',
    'guardian-auto-review'
  ]) {
    async function exercise(deny: any, set: any) {
      set(() => {
        throw Error('audit')
      })
      let error
      try {
        deny('check', source, 'perform action', {})
      } catch (e) {
        error = details(e)
      }
      set(undefined)
      return error
    }
    expect(await exercise(denyPermission, setSecurityAudit)).toEqual(
      await exercise(base.baselineDenyPermission, base.baselineSetAudit)
    )
  }
})
test('elicitation unavailable, exceptions and invalid results fail closed while accepted actions preserve identity', async () => {
  const base = await originalDocumentation()
  for (const scenario of [
    'missing',
    'get throws',
    'run throws',
    'invalid',
    'accept',
    'decline',
    'cancel'
  ]) {
    async function exercise(create: any) {
      const result = { action: scenario },
        getter = () => {
          if (scenario === 'get throws') throw Error('get')
          if (scenario === 'missing') return undefined
          return async () => {
            if (scenario === 'run throws') throw Error('run')
            return result
          }
        }
      try {
        const request = create(getter, { check: 'check', errorMessage: 'unavailable' }),
          received = await request({})
        expect(received).toBe(result)
        return { action: received.action }
      } catch (e) {
        return { error: details(e) }
      }
    }
    expect(await exercise(createApprovalRequest)).toEqual(
      await exercise(base.baselineCreateApprovalRequest)
    )
  }
})
