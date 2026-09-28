// @vitest-environment node
import { test, expect } from 'vitest'
import { SiteInstructions } from '../src/service-site-instructions'
import { originalDocumentation } from './original-service'
test('site instructions strip response header and reject local/non-http origins or malformed encoding', async () => {
  const base = await originalDocumentation()
  for (const enabled of [true, false])
    for (const url of [
      'https://example.com/page',
      'http://localhost',
      'http://127.0.0.1',
      'http://[::1]',
      'http://169.254.1.2',
      'http://terminal.local',
      'file:///tmp/page'
    ])
      for (const value of ['Hello%20world', '%bad']) {
        function exercise(Type: any) {
          const state = new Type(enabled),
            response = {
              frameId: 'main',
              request: { url },
              responseHeaders: [
                { name: 'X-OpenAI-Site-Instruction', value },
                { name: 'other', value: 'kept' }
              ]
            }
          state.capture(1, response)
          return {
            response,
            peek: state.peek(1, url + '#hash'),
            take: state.take(1, url),
            after: state.peek(1, url)
          }
        }
        expect(exercise(SiteInstructions)).toEqual(exercise(base.BaselineSiteInstructions))
      }
})
test('frame clear and mismatched URLs preserve exact original one-shot instruction ownership', async () => {
  const base = await originalDocumentation()
  function exercise(Type: any) {
    const state = new Type(true),
      url = 'https://example.com'
    state.capture(1, {
      frameId: 'main',
      request: { url },
      responseHeaders: [{ name: 'x-openai-site-instruction', value: 'instruction' }]
    })
    state.clearFrame(1, 'child')
    const first = state.peek(1, url)
    state.clearFrame(1, 'main')
    const second = state.peek(1, url)
    return { first, second }
  }
  expect(exercise(SiteInstructions)).toEqual(exercise(base.BaselineSiteInstructions))
})
