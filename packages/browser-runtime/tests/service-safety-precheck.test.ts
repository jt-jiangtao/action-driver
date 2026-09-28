// @vitest-environment node
import { test, expect } from 'vitest'
import { createSafetyPrecheck, captureSafetyRuntime } from '../src/service-safety-precheck'
import { reviewTimeoutMessage } from '../src/service-security-approval'
import { originalDocumentation } from './original-service'
const timing = { trackElicitation: (run: any) => run }
test('automated precheck is enabled only by exact supported environment flags', async () => {
  const base = await originalDocumentation()
  for (const mode of ['', ' gaas-browser-environment ', 'disabled-for-local-testing'])
    for (const enabled of ['1', 'true', '0']) {
      const runtime = {
        env: {
          BROWSER_USE_SECURITY_MODE: mode,
          BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED: enabled
        },
        createElicitation: async () => ({ action: 'accept' })
      }
      expect(typeof createSafetyPrecheck(runtime, timing)).toBe(
        typeof base.baselineSafetyPrecheck(runtime, timing)
      )
    }
})
test('precheck matches original strict reviewer validation, request metadata and error reasons', async () => {
  const base = await originalDocumentation()
  for (const action of ['accept', 'decline', 'cancel', 'unknown'])
    for (const reviewer of [undefined, 'user', 'auto_review', 'guardian_subagent'])
      for (const message of [undefined, 'Specific denial', reviewTimeoutMessage]) {
        async function exercise(create: any) {
          const calls: any[] = [],
            runtime = {
              env: {
                BROWSER_USE_SECURITY_MODE: 'gaas-browser-environment',
                BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED: '1'
              },
              createElicitation: async (params: any) => {
                calls.push(params)
                return { action, _meta: { approvals_reviewer: reviewer, message } }
              }
            }
          try {
            const result = await create(runtime, timing, { elicitationDisplayName: 'Browser' })({
              message: 'Review action',
              toolName: ' click ',
              toolParams: { value: 1 }
            })
            return { calls, result }
          } catch (e: any) {
            return { calls, error: { message: e.message, reason: e.reason } }
          }
        }
        expect(await exercise(createSafetyPrecheck)).toEqual(
          await exercise(base.baselineSafetyPrecheck)
        )
      }
})
test('captured host identity prevents environment changes or replaced hosts bypassing prechecks', async () => {
  const base = await originalDocumentation()
  async function exercise(capture: any, create: any) {
    const calls: any[] = [],
      runtime = {
        env: {
          BROWSER_USE_SECURITY_MODE: 'gaas-browser-environment',
          BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED: '1'
        },
        createElicitation: async () => {
          calls.push('review')
          return { action: 'accept', _meta: { approvals_reviewer: 'auto_review' } }
        }
      },
      release = capture(runtime),
      results: any[] = []
    try {
      const run = create(runtime, timing)
      for (const mutate of [
        () => {},
        () => {
          runtime.env.BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED = '0'
        }
      ]) {
        mutate()
        try {
          await run({ message: 'Review', toolName: 'click', toolParams: {} })
          results.push('accept')
        } catch (e: any) {
          results.push({ reason: e.reason, message: e.message })
        }
      }
    } finally {
      release()
    }
    return { calls, results }
  }
  expect(await exercise(captureSafetyRuntime, createSafetyPrecheck)).toEqual(
    await exercise(base.baselineCaptureSafety, base.baselineSafetyPrecheck)
  )
})
test('missing elicitation and empty tool names preserve original failure boundaries', async () => {
  const base = await originalDocumentation()
  for (const hasPrompt of [true, false])
    for (const toolName of ['click', '  ']) {
      async function exercise(create: any) {
        const runtime: any = {
          env: {
            BROWSER_USE_SECURITY_MODE: 'gaas-browser-environment',
            BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED: '1'
          }
        }
        if (hasPrompt)
          runtime.createElicitation = async () => ({
            action: 'accept',
            _meta: { approvals_reviewer: 'auto_review' }
          })
        try {
          await create(runtime, timing)({ message: 'Review', toolName, toolParams: {} })
        } catch (e: any) {
          return { reason: e.reason, message: e.message }
        }
      }
      expect(await exercise(createSafetyPrecheck)).toEqual(
        await exercise(base.baselineSafetyPrecheck)
      )
    }
})
test('review audit includes measured duration on accepted and declined automatic reviews', async () => {
  const base = await originalDocumentation()
  const candidate = await import('../src/service-security-approval')
  for (const action of ['accept', 'decline']) {
    async function exercise(create: any, setAudit: any) {
      const audits: any[] = []
      setAudit((event: any) => audits.push({ ...event, durationMs: typeof event.durationMs }))
      try {
        const run = create(
          {
            env: {
              BROWSER_USE_SECURITY_MODE: 'gaas-browser-environment',
              BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED: '1'
            },
            createElicitation: async () => ({
              action,
              _meta: { approvals_reviewer: 'auto_review' }
            })
          },
          timing
        )
        try {
          await run({ message: 'Review', toolName: 'click', toolParams: {} })
        } catch {}
        return audits
      } finally {
        setAudit(undefined)
      }
    }
    expect(await exercise(createSafetyPrecheck, candidate.setSecurityAudit)).toEqual(
      await exercise(base.baselineSafetyPrecheck, base.baselineSetAudit)
    )
  }
})
