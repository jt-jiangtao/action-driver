// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/login"}
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'
import { fillAuthInput } from '../../src/service-auth-submission'

function fixture(method = 'post', action = 'https://example.com/login') {
  document.body.innerHTML = `<form method="${method}" action="${action}">
    <input id="username" type="text" name="username"><button id="submit" type="submit">Submit</button></form>`
  const input = document.querySelector('#username')!
  ;(input as HTMLElement).scrollIntoView = () => {}
  const injected = {
    retarget: (element: Element) => element,
    elementState: () => ({ matches: true }),
    fill: () => 'done',
    parseSelector: (selector: string) => selector,
    querySelectorAll: (selector: string, root: Element) => [...root.querySelectorAll(selector)]
  }
  return { input, injected }
}

test('native fill verifies same-form HTTPS POST like original page function', async () => {
  const original = await originalDocumentation()
  const arg = { operation: 'browser-auth-fill', expectedType: 'text',
    expectedOrigin: 'https://example.com', value: 'alice', nativeSubmitSelector: '#submit' }
  for (const [method, action] of [
    ['post', 'https://example.com/login'],
    ['get', 'https://example.com/login'],
    ['post', 'https://evil.example/login']
  ]) {
    const { input, injected } = fixture(method, action)
    const exercise = (run: Function) => {
      try { return { value: run(input, injected, arg) } }
      catch (error) { return { error: (error as Error).message } }
    }
    expect(exercise(fillAuthInput)).toEqual(exercise(original.baselineAuthInputPage))
  }
})
