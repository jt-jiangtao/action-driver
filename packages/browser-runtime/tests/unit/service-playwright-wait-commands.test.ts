// @vitest-environment node
import { expect, test } from 'vitest'
import { playwrightCommandHandlers } from '../../src/service-playwright-commands'
import { originalDocumentation } from '../original-service'

test('Playwright wait command wrappers return original shapes and preserve validation order', async () => {
  const original = await originalDocumentation()
  for (const [name, baseline, variants] of [
    ['playwright_wait_for_timeout', original.baselineWaitForTimeout, [
      { tab_id: 1, timeout_ms: 0 }, { tab_id: 0, timeout_ms: 0 }
    ]],
    ['playwright_wait_for_load_state', original.baselineWaitForLoadState, [
      { tab_id: 1, state: 'load', timeout_ms: 0 }, { tab_id: 0, state: 'load', timeout_ms: 0 }
    ]],
    ['playwright_wait_for_url', original.baselineWaitForUrl, [
      { tab_id: 1, url: 'https://example.test/**', timeout_ms: 0 },
      { tab_id: 1, url: '', timeout_ms: 0 }
    ]]
  ] as const) {
    for (const params of variants) {
      async function exercise(run: any) {
        const calls: string[] = []
        const cdp = {
          call: async (_id: number, method: string) => {
            calls.push(method)
            return { frameTree: { frame: { id: 'main' } } }
          },
          waitForEvent: async () => undefined,
          readDocumentState: async () => ({ readyState: 'complete', href: 'https://example.test/page' })
        }
        let result: unknown, error: string | undefined
        try { result = await run(params, { cdp }) }
        catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
        return { result, error, calls }
      }
      expect(await exercise((playwrightCommandHandlers as any)[name])).toEqual(await exercise(baseline))
    }
  }
})
