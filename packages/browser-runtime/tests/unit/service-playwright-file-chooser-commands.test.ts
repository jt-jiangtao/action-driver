// @vitest-environment node
import { expect, test } from 'vitest'
import { playwrightCommandHandlers } from '../../src/service-playwright-commands'
import { originalDocumentation } from '../original-service'

test('file chooser command registration preserves validation, security and cleanup behavior', async () => {
  const original = await originalDocumentation()
  async function exercise(run: any, kind: 'wait' | 'set', variant: string) {
    const calls: string[] = [], chooser = new Map<string, any>([
      ['known', { tabId: variant === 'wrong-tab' ? 2 : 1, backendNodeId: 44, isMultiple: false }]
    ])
    const context = {
      cdp: {
        fileChoosersById: chooser,
        call: async (_id: number, method: string) => { calls.push(method); return {} },
        waitForEvent: async () => { throw Error('timeout fixture') }
      },
      security: { ensureFileUploadAllowed: async () => { calls.push('approved') } },
      clientInfo: { family: 'chrome' }
    }
    const params = kind === 'wait'
      ? { tab_id: variant === 'bad-tab' ? 0 : 1, timeout_ms: 0 }
      : { tab_id: 1, file_chooser_id: variant === 'unknown' ? 'missing' : 'known',
          files: variant === 'empty' ? [] : ['file.txt'] }
    let result: unknown, error: string | undefined
    try { result = await run(params, context) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    return { result, error, calls, retained: chooser.has('known') }
  }
  for (const variant of ['bad-tab', 'timeout'])
    expect(await exercise((playwrightCommandHandlers as any).playwright_wait_for_file_chooser, 'wait', variant)).toEqual(
      await exercise(original.baselineWaitForFileChooser, 'wait', variant))
  for (const variant of ['unknown', 'wrong-tab', 'empty', 'success'])
    expect(await exercise((playwrightCommandHandlers as any).playwright_file_chooser_set_files, 'set', variant)).toEqual(
      await exercise(original.baselineSetFileChooserFiles, 'set', variant))
})
