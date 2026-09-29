// @vitest-environment node
import { test, expect } from 'vitest'
import { waitForFileChooser, setFileChooserFiles } from '../../src/service-file-chooser'
import { originalDocumentation } from '../original-service'
function context(event: any, failure?: unknown) {
  const calls: any[] = []
  return {
    calls,
    cdp: {
      fileChoosersById: new Map(),
      call: async (...args: any[]) => {
        calls.push(args)
        if (args[1] === 'DOM.setFileInputFiles' && failure !== undefined) throw failure
      },
      waitForEvent: async (_id: number, predicate: any, options: any) => {
        await options.action()
        if (!predicate(event)) throw Error(options.timeoutMessage)
        return event
      }
    },
    security: {
      ensureFileUploadAllowed: async (id: number) => {
        calls.push(['authorize', id])
      }
    },
    clientInfo: { family: 'chrome' }
  }
}
test('file chooser event is registered and interception always released, rejecting nested targets', async () => {
  const base = await originalDocumentation()
  for (const source of [{ tabId: 1 }, { tabId: 1, sessionId: 'child' }, { tabId: 2 }]) {
    async function exercise(run: any) {
      const f = context({
        source,
        method: 'Page.fileChooserOpened',
        params: { backendNodeId: 20, mode: 'selectMultiple' }
      })
      let result, error
      try {
        result = await run({ tab_id: 1, timeout_ms: 50 }, f)
      } catch (e: any) {
        error = e.message
      }
      return {
        result: result ? { ...result, file_chooser_id: 'id' } : undefined,
        error,
        calls: f.calls,
        chooser: [...f.cdp.fileChoosersById.values()]
      }
    }
    expect(await exercise(waitForFileChooser)).toEqual(await exercise(base.baselineWaitFileChooser))
  }
})
test('file submission enforces tab ownership, multiplicity and permission and only consumes on success', async () => {
  const base = await originalDocumentation()
  for (const [tabId, files, isMultiple, failure] of [
    [1, ['/file'], false, undefined],
    [2, ['/file'], false, undefined],
    [1, [], true, undefined],
    [1, ['/a', '/b'], false, undefined],
    [1, ['/file'], false, 'Not allowed'],
    [1, ['/file'], false, Error('broken')]
  ] as const) {
    async function exercise(run: any) {
      const f = context({}, failure)
      f.cdp.fileChoosersById.set('id', { tabId: 1, backendNodeId: 20, isMultiple })
      let result, error
      try {
        result = await run({ tab_id: tabId, file_chooser_id: 'id', files }, f)
      } catch (e: any) {
        error = e.message
      }
      return { result, error, calls: f.calls, retained: f.cdp.fileChoosersById.has('id') }
    }
    expect(await exercise(setFileChooserFiles)).toEqual(
      await exercise(base.baselineSetChooserFiles)
    )
  }
})
