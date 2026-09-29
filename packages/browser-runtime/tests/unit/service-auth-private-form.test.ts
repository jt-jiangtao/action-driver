// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/login"}
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'
import { privateAuthFormPage, submitPrivateAuthForm } from '../../src/service-auth-private-form'

function fixture(extra = '') {
  document.body.innerHTML = `<form action="https://example.com/login" method="post" enctype="application/x-www-form-urlencoded" target="_self">
    <input id="username" type="text" name="username" autocomplete="username">
    <input id="password" type="password" name="password" autocomplete="current-password">
    ${extra}<button id="submit" type="submit">Sign in</button></form>`
  const username = document.querySelector('#username')!
  const injected = {
    retarget: (element: Element) => element,
    parseSelector: (selector: string) => selector,
    querySelectorAll: (selector: string, root: Element) => [...root.querySelectorAll(selector)],
    elementState: () => ({ matches: true })
  }
  const arg = { username: { selector: '#username', name: 'username' },
    password: { selector: '#password', name: 'password' },
    submit: { selector: '#submit', action: 'click' },
    target: { origin: 'https://example.com', url: 'https://example.com/login' } }
  return { username, injected, arg }
}

test('isolated private form preflight matches original for safe and hostile controls', async () => {
  const original = await originalDocumentation()
  for (const extra of ['', '<input type="password" name="other">',
    '<input type="file" name="upload">', '<input name="username" value="collision">']) {
    const { username, injected, arg } = fixture(extra)
    expect(privateAuthFormPage(username, injected, arg)).toBe(
      original.baselineAuthPrivateForm(username, injected, arg)
    )
  }
})

test('private submission mirrors original hidden closed-shadow form and erases hidden values', async () => {
  const original = await originalDocumentation()
  async function exercise(run: Function) {
    const { username, injected, arg } = fixture('<input name="remember" value="yes">')
    const submitted: Array<Array<[string, string]>> = []
    const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'submit')!
    Object.defineProperty(HTMLFormElement.prototype, 'submit', { configurable: true,
      value: function (this: HTMLFormElement) {
        submitted.push([...this.querySelectorAll('input')].map((input) => [input.name, input.value]))
      } })
    try {
      const result = run(username, injected, { ...arg, values: { username: 'alice', password: 'secret' } })
      const hidden = [...document.querySelectorAll('html > div')]
      return { result, submitted, closed: hidden.some((element) => element.shadowRoot == null) }
    } finally { Object.defineProperty(HTMLFormElement.prototype, 'submit', descriptor) }
  }
  expect(await exercise(privateAuthFormPage)).toEqual(await exercise(original.baselineAuthPrivateForm))
})

test('private submission binds username selector in isolated world and revalidates before values', async () => {
  const calls: string[] = []
  const playwright: any = {
    withBoundPlaywrightSelector: async (_tab: string, selector: string,
      allowed: () => Promise<boolean>, run: (bound: unknown) => Promise<void>, options: any) => {
      calls.push(`bind:${selector}:${options.isolatedWorld}`)
      if (await allowed()) await run(playwright)
    },
    evaluateOnPlaywrightSelector: async (_tab: string, _selector: string, page: Function, options: any) => {
      calls.push(`page:${page.name}:${options.isolatedWorld}`)
      return true
    }
  }
  const { arg } = fixture()
  expect(await submitPrivateAuthForm('7', 1000, arg,
    { username: 'alice', password: 'secret' }, playwright,
    async () => { calls.push('revalidate'); return null })).toBe('submitted')
  expect(calls).toEqual(['bind:#username:true', 'revalidate', 'page:privateAuthFormPage:true'])
})
