// @vitest-environment node
import { expect, test } from 'vitest'
import { JSDOM } from 'jsdom'
import { playwrightCommandHandlers } from '../../src/service-playwright-commands'
import { originalDocumentation } from '../original-service'

test('playwright_evaluate command routes to isolated readonly evaluation like original', async () => {
  const base = await originalDocumentation()
  async function exercise(run: any) {
    const dom = new JSDOM('<body><p>Ready</p></body>', {
      runScripts: 'outside-only',
      url: 'https://example.test/'
    })
    const cdp = {
      call: async (_id: number, method: string, params: any) => {
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
        if (method === 'Runtime.evaluate')
          return { result: { value: await dom.window.eval(params.expression) } }
        return {}
      },
      callTarget: async () => {
        throw Error('unexpected target call')
      }
    }
    let result: unknown
    let error: string | undefined
    try {
      result = await run(
        { tab_id: 777, script: 'return document.querySelector("p").textContent' },
        { cdp }
      )
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    dom.window.close()
    return { result, error }
  }
  expect(await exercise(playwrightCommandHandlers.playwright_evaluate)).toEqual(
    await exercise(base.baselineReadonlyEvaluate)
  )
})
