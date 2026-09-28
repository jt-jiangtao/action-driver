// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from './original-service'
import { executeBrowserAuthCommand, findInvisibleAuthField, inspectAuthFields } from '../src/service-auth-command'

const page = {
  id: 'frame-1', loaderId: 'loader-1', securityOrigin: 'https://example.com',
  url: 'https://example.com/login', domainAndRegistry: 'example.com'
}
const params = {
  browser_id: 'browser', tab_id: '7', origin: 'https://example.com',
  fields: [{ id: 'password', label: 'Password', type: 'password', required: true, selector: '#password' }]
}
function context(frame = page) {
  const calls: string[] = []
  return {
    calls,
    clientInfo: { name: 'Test Browser', type: 'cdp', capabilities: { tab: [{ id: 'browserAuth' }] } },
    cdp: { call: async (_id: number, method: string) => { calls.push(method); return { frameTree: { frame } } } }
  }
}
test('auth command rejects duplicate selectors before page access like original', async () => {
  const original = await originalDocumentation()
  const invalid = { ...params, fields: [...params.fields, { ...params.fields[0], id: 'second' }] }
  const ours = context()
  const baseline = context()
  expect(await executeBrowserAuthCommand(invalid, ours)).toEqual(
    await original.baselineBrowserAuthCommand(invalid, baseline)
  )
  expect(ours.calls).toEqual([])
  expect(baseline.calls).toEqual([])
})

test('user-visible field check reports the first explicitly hidden input with original selector options', async () => {
  const original = await originalDocumentation()
  const values = new Map([['#password', true], ['#otp', false]])
  const fields = [params.fields[0], { id: 'otp', label: 'Code', type: 'text', required: true, selector: '#otp' }]
  async function exercise(run: Function) {
    const calls: any[] = []
    const result = await run({ ...params, fields }, {
      playwright: { evaluateOnPlaywrightSelector: async (tab: string, selector: string, _evaluate: Function, options: any) => {
        calls.push([tab, selector, options])
        return values.get(selector)
      } }
    })
    return { result, calls }
  }
  expect(await exercise(findInvisibleAuthField)).toEqual(await exercise(original.baselineAuthInvisibleField))
})

test('field inspection derives trusted label metadata and required state like original', async () => {
  const original = await originalDocumentation()
  async function exercise(run: Function, missing = false) {
    const calls: any[] = []
    const result = await run(params, {
      playwright: { evaluateOnPlaywrightSelector: async (tab: string, selector: string, _evaluate: Function, options: any) => {
        calls.push([tab, selector, options])
        return missing ? null : {
          accessible_name: 'Password', autocomplete: 'current-password', input_type: 'password',
          input_mode: null, input_name: 'password', required: true
        }
      } }
    }, true, true)
    return { result, calls }
  }
  expect(await exercise(inspectAuthFields)).toEqual(await exercise(original.baselineAuthInspectFields))
  expect(await exercise(inspectAuthFields, true)).toEqual(await exercise(original.baselineAuthInspectFields, true))
})

test('auth command rejects origin and incomplete document identity like original', async () => {
  const original = await originalDocumentation()
  for (const frame of [
    { ...page, securityOrigin: 'https://other.example.com' },
    { ...page, url: 'https://other.example.com/login' },
    { ...page, loaderId: '' }
  ]) {
    expect(await executeBrowserAuthCommand(params, context(frame))).toEqual(
      await original.baselineBrowserAuthCommand(params, context(frame))
    )
  }
})

test('auth command reports an explicitly hidden field with original locator error', async () => {
  const original = await originalDocumentation()
  const make = () => ({
    ...context(),
    playwright: { evaluateOnPlaywrightSelector: async () => false }
  })
  expect(await executeBrowserAuthCommand(params, make())).toEqual(
    await original.baselineBrowserAuthCommand(params, make())
  )
})

test('auth command reports unsupported capability before touching browser', async () => {
  const original = await originalDocumentation()
  const ours = context()
  const baseline = context()
  ours.clientInfo.capabilities.tab = []
  baseline.clientInfo.capabilities.tab = []
  let expected
  try { await original.baselineBrowserAuthCommand(params, baseline) } catch (error) { expected = (error as Error).message }
  await expect(executeBrowserAuthCommand(params, ours)).rejects.toThrow(expected)
  expect(ours.calls).toEqual([])
})

test('auth command binds form, rechecks page, then opens secure broker prompt', async () => {
  const events: string[] = []
  const authParams = { ...params, fields: [
    { id: 'username', label: 'Username', type: 'text', required: true, selector: '#username' },
    params.fields[0]
  ], submit: { action: 'click', selector: '#submit' } }
  const ctx = {
    ...context(),
    playwright: {
      evaluateOnPlaywrightSelector: async (_tab: string, _selector: string, _fn: Function, options: any) =>
        options.arg.operation === 'browser-auth-submission-origin'
          ? { origin: 'https://example.com', url: 'https://example.com/login' }
          : null,
      evaluateOnPlaywrightSelectorWithTarget: async () => ({
        frameIdentity: { frameId: 'frame-1', loaderId: 'loader-1', url: 'https://example.com/login', domainAndRegistry: 'example.com' },
        result: 'https://example.com/login',
        target: { tabId: 7, sessionId: 'session-1', targetId: 'target-1' }
      })
    },
    runtime: {
      env: { BROWSER_AUTH_BROKER_CREDENTIAL_BINDING_VERSION: '1' },
      requestMeta: { 'x-codex-turn-metadata': { session_id: 'session-1' } },
      createElicitation: async (request: any) => {
        events.push('prompt')
        expect(request.meta.fields.map((field: any) => field.id)).toEqual(['username', 'password'])
        return { action: 'accept' }
      },
      gaas: { getBrowserAuthBrokerChallenge: async (_fields: unknown, _options: unknown, metadata: any) => {
        expect(metadata.credentialBinding).toEqual({
          fields: [{ id: 'username', kind: 'username' }, { id: 'password', kind: 'password' }],
          session_id: 'session-1', submission_origin: 'https://example.com'
        })
        events.push('broker')
        return {
          id: 'a'.repeat(32), hasSubmission: true,
          waitForSubmission: async () => ({ fields: { username: 'alice', password: 'secret' } }),
          complete: async (status: string) => { events.push(`complete:${status}`); return status },
          close: () => { events.push('close') }
        }
      } }
    },
    auth: {
      inspectFields: async () => [
        { ...authParams.fields[0], labelMetadata: { accessible_name: 'Username', autocomplete: 'username', input_type: 'text', input_mode: null, input_name: 'username' } },
        { ...authParams.fields[1], labelMetadata: { accessible_name: 'Password', autocomplete: 'current-password', input_type: 'password', input_mode: null, input_name: 'password' } }
      ],
      validateForm: async () => true,
      validateOptions: async () => true,
      submitCredentials: async () => { events.push('fill'); return 'submitted' }
    }
  }
  expect(await executeBrowserAuthCommand(authParams, ctx)).toEqual({ status: 'submitted' })
  expect(events).toEqual(['broker', 'prompt', 'fill', 'complete:submitted', 'close'])
})

test('auth command fails closed if required automated review is unavailable', async () => {
  let brokerCalled = false
  const ctx = {
    ...context(),
    playwright: {
      evaluateOnPlaywrightSelector: async () => null,
      evaluateOnPlaywrightSelectorWithTarget: async () => ({
        frameIdentity: { frameId: 'frame-1', loaderId: 'loader-1', url: 'https://example.com/login' },
        result: 'https://example.com/login', target: { tabId: 7 }
      })
    },
    runtime: {
      env: { BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED: '1', BROWSER_USE_SECURITY_MODE: 'gaas-browser-environment' },
      gaas: { getBrowserAuthBrokerChallenge: async () => { brokerCalled = true; throw Error('must not register') } }
    },
    auth: {
      inspectFields: async () => [{ ...params.fields[0], labelMetadata: { input_type: 'password' } }],
      validateForm: async () => true,
      validateOptions: async () => true,
      submitCredentials: async () => 'submitted'
    }
  }
  await expect(executeBrowserAuthCommand(params, ctx)).rejects.toMatchObject({
    name: 'BrowserUseSecurityError', reason: 'approval_unavailable',
    decisionSource: 'approval', retryable: true,
    cause: { message: 'Documentation is not available: browserAuthSafetyPrecheck' }
  })
  expect(brokerCalled).toBe(false)
})

test('a bare review callback cannot bypass the missing original safety checkpoint', async () => {
  let reviewed = false
  const ctx = {
    ...context(),
    playwright: {
      evaluateOnPlaywrightSelector: async () => null,
      evaluateOnPlaywrightSelectorWithTarget: async () => ({
        frameIdentity: { frameId: 'frame-1', loaderId: 'loader-1',
          url: 'https://example.com/login', domainAndRegistry: 'example.com' },
        result: 'https://example.com/login', target: { tabId: 7 }
      })
    },
    runtime: { env: { BROWSER_USE_AUTOMATED_SAFETY_PRECHECKS_ENABLED: '1',
      BROWSER_USE_SECURITY_MODE: 'gaas-browser-environment' } },
    auth: {
      inspectFields: async () => [{ ...params.fields[0], labelMetadata: { input_type: 'password' } }],
      validateForm: async () => true,
      validateOptions: async () => true,
      review: async () => { reviewed = true; return null },
      submitCredentials: async () => 'submitted'
    }
  }
  await expect(executeBrowserAuthCommand(params, ctx)).rejects.toMatchObject({
    name: 'BrowserUseSecurityError', reason: 'approval_unavailable',
    decisionSource: 'approval', retryable: true,
    cause: { message: 'Documentation is not available: browserAuthSafetyPrecheck' }
  })
  expect(reviewed).toBe(false)
})

test('auth command rejects a cross-origin form until frame trust is established', async () => {
  let brokerCalled = false
  const ctx = {
    ...context(),
    playwright: {
      evaluateOnPlaywrightSelector: async () => null,
      evaluateOnPlaywrightSelectorWithTarget: async () => ({
        frameIdentity: { frameId: 'frame-1', loaderId: 'loader-1', url: 'https://other.example.com/login' },
        result: 'https://other.example.com/login', target: { tabId: 7 }
      })
    },
    runtime: { env: {}, gaas: { getBrowserAuthBrokerChallenge: async () => { brokerCalled = true; throw Error('must not register') } } },
    auth: {
      inspectFields: async () => [{ ...params.fields[0], labelMetadata: { input_type: 'password' } }],
      validateForm: async () => true,
      validateOptions: async () => true,
      submitCredentials: async () => 'submitted'
    }
  }
  expect(await executeBrowserAuthCommand(params, ctx)).toEqual({ status: 'locator_invalid' })
  expect(brokerCalled).toBe(false)
})

test('trusted cross-site frame records its origin in the credential prompt', async () => {
  let prompt: any
  let filledFrame: string | undefined
  const ctx = {
    ...context(),
    playwright: {
      evaluateOnPlaywrightSelector: async () => true,
      evaluateOnPlaywrightSelectorWithTarget: async () => ({
        frameIdentity: { frameId: 'frame-2', loaderId: 'loader-2',
          url: 'https://login.other.com/signin', domainAndRegistry: 'other.com' },
        result: 'https://login.other.com/signin', target: { tabId: 7 }
      })
    },
    runtime: { env: {}, createElicitation: async (request: any) => {
      prompt = request.meta
      return { action: 'accept' }
    }, gaas: { getBrowserAuthBrokerChallenge: async () => ({
      id: 'a'.repeat(32), hasSubmission: true,
      waitForSubmission: async () => ({ fields: { password: 'secret' } }),
      complete: async (status: string) => status, close: () => {}
    }) } },
    auth: {
      inspectFields: async () => [{ ...params.fields[0], labelMetadata: { input_type: 'password' } }],
      validateForm: async () => true,
      validateOptions: async () => true,
      submitCredentials: async (_values: unknown, _option: unknown, _revalidate: unknown,
        _plan: unknown, frameOrigin: string) => { filledFrame = frameOrigin; return 'submitted' }
    }
  }
  expect(await executeBrowserAuthCommand(params, ctx)).toEqual({ status: 'submitted' })
  expect(prompt.cross_origin_iframe).toEqual({ origin: 'https://login.other.com' })
  expect(prompt.origin).toBe('https://example.com')
  expect(prompt.frame_origin).toBe('https://login.other.com')
  expect(filledFrame).toBe('https://login.other.com')
})
