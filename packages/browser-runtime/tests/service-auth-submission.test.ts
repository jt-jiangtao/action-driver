// @vitest-environment node
import { expect, test } from 'vitest'
import { submitBrowserAuthForm } from '../src/service-auth-submission'

test('ordinary credential submission binds each field and submit action to a fresh revalidation', async () => {
  const calls: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: number, selector: string, allowed: () => Promise<boolean>,
      run: (bound: unknown) => Promise<unknown>) => {
      calls.push(`bind:${selector}`)
      if (await allowed()) return await run(playwright)
    },
    evaluateOnPlaywrightSelectorWithTarget: async (_tab: number, selector: string, _page: Function, options: any) => {
      calls.push(`fill:${selector}:${options.arg.value}`)
    },
    clickLocator: async ({ selector }: { selector: string }) => { calls.push(`click:${selector}`) }
  }
  const params = {
    tab_id: '7', origin: 'https://example.com', timeout_ms: 1000,
    fields: [{ id: 'username', selector: '#username', type: 'text' },
      { id: 'password', selector: '#password', type: 'password' }],
    submit: { selector: '#submit', action: 'click' }
  }
  const result = await submitBrowserAuthForm(params, { username: 'alice', password: 'secret' },
    undefined, { playwright, revalidate: async () => { calls.push('revalidate'); return null } })
  expect(result).toBe('submitted')
  expect(calls).toEqual([
    'bind:#username', 'revalidate', 'fill:#username:alice',
    'bind:#password', 'revalidate', 'fill:#password:secret',
    'bind:#submit', 'revalidate', 'click:#submit'
  ])
})

test('revalidation failure prevents credential fill', async () => {
  let filled = false
  const result = await submitBrowserAuthForm({ tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'password', selector: '#password', type: 'password' }] },
  { password: 'secret' }, undefined, { playwright: {
    withBoundPlaywrightSelector: async (_tab: number, _selector: string,
      allowed: () => Promise<boolean>) => { await allowed() },
    evaluateOnPlaywrightSelectorWithTarget: async () => { filled = true }
  }, revalidate: async () => 'page_changed' })
  expect(result).toBe('page_changed')
  expect(filled).toBe(false)
})

test('native delivery keeps fill and submit bound in isolated world with same-form target', async () => {
  const calls: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: number, selector: string, allowed: () => Promise<boolean>,
      run: (bound: unknown) => Promise<unknown>, options: any) => {
      calls.push(`bind:${selector}:${options.isolatedWorld}`)
      if (await allowed()) await run(playwright)
    },
    evaluateOnPlaywrightSelectorWithTarget: async (_tab: string, _selector: string, _page: Function, options: any) => {
      calls.push(`fill:${options.isolatedWorld}:${options.arg.nativeSubmitSelector}`)
    },
    evaluateOnPlaywrightSelector: async (_tab: string, _selector: string, _page: Function, options: any) => {
      calls.push(`submit-check:${options.isolatedWorld}`)
      return true
    },
    clickLocator: async () => { calls.push('click') }
  }
  const params = { tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'password', selector: '#password', type: 'password' }],
    submit: { selector: '#submit', action: 'click' } }
  expect(await submitBrowserAuthForm(params, { password: 'secret' }, undefined,
    { playwright, nativeDelivery: true, revalidate: async () => null })).toBe('submitted')
  expect(calls).toEqual([
    'bind:#password:true', 'fill:true:#submit',
    'bind:#submit:true', 'submit-check:true', 'click'
  ])
})

test('original OTP plan splits numeric code into bound single-key presses before Enter', async () => {
  const calls: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: number, selector: string,
      allowed: () => Promise<boolean>, run: (bound: unknown) => Promise<unknown>) => {
      calls.push(`bind:${selector}`)
      if (await allowed()) await run(playwright)
    },
    evaluateOnPlaywrightSelectorWithTarget: async () => { calls.push('fill') },
    pressLocator: async ({ selector, value }: { selector: string; value: string }) => {
      calls.push(`press:${selector}:${value}`)
    }
  }
  const fields = Array.from({ length: 4 }, (_, index) => ({
    id: `digit${index}`, selector: `#digit${index}`, type: 'text'
  }))
  const result = await submitBrowserAuthForm({ tab_id: '7', origin: 'https://example.com', fields,
    submit: { selector: '#digit3', action: 'press_enter' } }, { otp: '12-34' }, undefined,
  { playwright, revalidate: async () => { calls.push('revalidate'); return null },
    credentialPlan: { fillFields: [{ promptId: 'otp', fields }] } } as any)
  expect(result).toBe('submitted')
  expect(calls).toEqual([
    'bind:#digit0', 'revalidate', 'press:#digit0:1',
    'bind:#digit1', 'revalidate', 'press:#digit1:2',
    'bind:#digit2', 'revalidate', 'press:#digit2:3',
    'bind:#digit3', 'revalidate', 'press:#digit3:4',
    'bind:#digit3', 'revalidate', 'press:#digit3:Enter'
  ])
})

test('selector-only option clicks without filling credentials or invoking submit', async () => {
  const calls: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: number, selector: string,
      allowed: () => Promise<boolean>, run: (bound: unknown) => Promise<unknown>) => {
      calls.push(`bind:${selector}`)
      if (await allowed()) await run(playwright)
    },
    clickLocator: async ({ selector }: { selector: string }) => { calls.push(`click:${selector}`) }
  }
  const result = await submitBrowserAuthForm({ tab_id: '7', origin: 'https://example.com',
    fields: [], options: [{ id: 'sso', selector: '#sso', field_ids: [] }],
    submit: { selector: '#submit', action: 'click' } }, {}, 'sso',
  { playwright, revalidate: async () => { calls.push('revalidate'); return null } })
  expect(result).toBe('submitted')
  expect(calls).toEqual(['bind:#sso', 'revalidate', 'click:#sso'])
})

test('OTP auto-submit detected after final digit prevents a second Enter', async () => {
  const calls: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: number, selector: string,
      allowed: () => Promise<boolean>, run: (bound: unknown) => Promise<unknown>) => {
      if (await allowed()) await run(playwright)
    },
    evaluateOnPlaywrightSelectorAll: async () => 0,
    pressLocator: async ({ value }: { value: string }) => { calls.push(value) }
  }
  const fields = Array.from({ length: 4 }, (_, index) => ({
    id: `digit${index}`, selector: `#digit${index}`, type: 'text'
  }))
  expect(await submitBrowserAuthForm({ tab_id: '7', origin: 'https://example.com', fields,
    submit: { selector: '#digit3', action: 'press_enter' } }, { otp: '1234' }, undefined,
  { playwright, revalidate: async () => null,
    credentialPlan: { fillFields: [{ promptId: 'otp', fields }] } } as any)).toBe('submitted')
  expect(calls).toEqual(['1', '2', '3', '4'])
})

test('selected option maps all physical OTP field ids back to one prompt id', async () => {
  const pressed: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: number, _selector: string,
      allowed: () => Promise<boolean>, run: (bound: unknown) => Promise<unknown>) => {
      if (await allowed()) await run(playwright)
    },
    pressLocator: async ({ value }: { value: string }) => { pressed.push(value) }
  }
  const fields = Array.from({ length: 4 }, (_, index) => ({
    id: `digit${index}`, selector: `#digit${index}`, type: 'text'
  }))
  expect(await submitBrowserAuthForm({ tab_id: '7', origin: 'https://example.com', fields,
    options: [{ id: 'code', field_ids: fields.map(({ id }) => id) }] },
  { otp: '1234' }, 'code', { playwright, revalidate: async () => null,
    credentialPlan: { fillFields: [{ promptId: 'otp', fields }] } } as any)).toBe('submitted')
  expect(pressed).toEqual(['1', '2', '3', '4'])
})
