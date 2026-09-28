// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.com/login"}
import { expect, test } from 'vitest'
import { originalDocumentation } from './original-service'
import { fillAuthInput } from '../src/service-auth-submission'

test('isolated input fallback has the original value and input-event behavior', async () => {
  const original = await originalDocumentation()
  async function exercise(run: Function) {
    document.body.innerHTML = '<input id="username" type="text">'
    const input = document.querySelector('input')!
    input.scrollIntoView = () => {}
    const events: Array<[string, string | null]> = []
    input.addEventListener('input', (event) => events.push([
      (event as InputEvent).inputType, (event as InputEvent).data
    ]))
    const injected = {
      retarget: (element: Element) => element,
      elementState: () => ({ matches: true }),
      fill: () => 'needsinput'
    }
    run(input, injected, { operation: 'browser-auth-fill', value: 'alice',
      expectedType: 'text', expectedOrigin: 'https://example.com' })
    return { value: input.value, events }
  }
  expect(await exercise(fillAuthInput)).toEqual(await exercise(original.baselineAuthInputPage))
})
