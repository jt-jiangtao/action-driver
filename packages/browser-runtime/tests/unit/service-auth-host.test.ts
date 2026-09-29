// @vitest-environment node
import { expect, test } from 'vitest'
import { createAuthHostAdapter } from '../../src/service-auth-host'

test('host adapter inspects form fields with real selector APIs and rejects duplicate controls', async () => {
  const calls: string[] = []
  const playwright: any = {
    evaluateOnPlaywrightSelector: async (_tab: string, selector: string) => {
      calls.push(`inspect:${selector}`)
      return { accessible_name: selector, autocomplete: null, input_type: 'text',
        input_mode: null, input_name: selector, required: true }
    },
    evaluateOnPlaywrightSelectorAll: async () => 1,
    readElementState: async () => true,
    selectorsResolveToDistinctElements: async () => false
  }
  const adapter = createAuthHostAdapter({ playwright })
  const params: any = { tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'one', selector: '#one', type: 'text', label: 'One', required: true },
      { id: 'two', selector: '#two', type: 'text', label: 'Two', required: true }] }
  expect(await adapter.validateForm(params)).toBe(false)
  expect(await adapter.inspectFields(params)).toBeNull()
  expect(calls).toEqual([])
})

test('host adapter accepts original Enter, selector option and grouped OTP actions', () => {
  const adapter = createAuthHostAdapter({ playwright: {} })
  const params: any = { fields: [{ id: 'username', selector: '#username' }],
    submit: { action: 'press_enter', selector: '#username' } }
  expect(adapter.canSubmit(params)).toBe(true)
  expect(adapter.canSubmit({ ...params, submit: { action: 'click', selector: '#submit' },
    options: [{ id: 'choose', selector: '#option', field_ids: [] }] })).toBe(true)
  expect(adapter.canSubmit(params, { fillFields: [{ fields: [{}, {}, {}, {}] }] })).toBe(true)
  expect(adapter.canSubmit({ ...params, submit: { action: 'click', selector: '#submit' } })).toBe(true)
})

test('frame selectors use target-scoped element identity before accepting form', async () => {
  let frameChecks = 0
  const playwright: any = {
    evaluateOnPlaywrightSelectorAll: async () => 1,
    readElementState: async () => true,
    selectorsResolveToDistinctElements: async () => true,
    evaluateOnPlaywrightSelectorWithTarget: async () => { frameChecks++; return { result: 'same-node',
      target: { tabId: 7, sessionId: 'frame-session' } } }
  }
  const adapter = createAuthHostAdapter({ playwright })
  const params: any = { tab_id: '7', fields: [
    { selector: '#frame >> internal:control=enter-frame >> #user' },
    { selector: '#frame >> internal:control=enter-frame >> input[name=user]' }
  ] }
  expect(await adapter.validateForm(params)).toBe(false)
  expect(frameChecks).toBe(2)
})

test('host Enter submission dispatches real CDP key events through bound locator focus', async () => {
  const calls: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: number, selector: string,
      allowed: () => Promise<boolean>, run: (bound: unknown) => Promise<unknown>) => {
      calls.push(`bind:${selector}`)
      if (await allowed()) await run(playwright)
    },
    focusLocator: async ({ selector }: { selector: string }) => {
      calls.push(`focus:${selector}`)
      return { target: { tabId: 7 } }
    }
  }
  const adapter = createAuthHostAdapter({ playwright,
    cdp: { platform: 'darwin', call: async (_id: number, method: string, params: any) => {
      calls.push(`${method}:${params.key}`)
    } } })
  expect(await adapter.submitCredentials({ tab_id: '7', origin: 'https://example.com', fields: [],
    submit: { selector: '#code', action: 'press_enter' } }, {}, undefined,
  async () => null)).toBe('submitted')
  expect(calls).toContain('focus:#code')
  expect(calls.filter((call) => call.startsWith('Input.dispatchKeyEvent:'))).toHaveLength(2)
})
