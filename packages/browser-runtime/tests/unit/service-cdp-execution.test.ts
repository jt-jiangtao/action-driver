// @vitest-environment node
import { test, expect } from 'vitest'
import { CdpExecutor } from '../../src/service-cdp-execution'
import { originalDocumentation } from '../original-service'
async function fixture(original: boolean, fail: string | undefined = undefined) {
  const base = await originalDocumentation(),
    calls: any[] = [],
    span = {
      currentCommandAttrs: () => ({ 'command.type': 'test' }),
      withSpan: async (name: any, attrs: any, run: any) => {
        calls.push(['span', name, attrs])
        return run()
      }
    },
    api = {
      addEventListener: () => () => {},
      attach: async (id: any) => calls.push(['attach', id]),
      detach: async () => {},
      executeCdp: async (params: any) => {
        calls.push(['cdp', params])
        if (fail && params.method === 'Runtime.evaluate') {
          const error = fail
          fail = undefined
          throw error
        }
        return { result: { value: 1 } }
      },
      executeCdpWithCachedExpression: async (params: any, key: any) => {
        calls.push(['cached', params, key])
        return { result: { value: 2 } }
      }
    },
    cdp = original ? new base.BaselineCdp(api, 'darwin', span) : new CdpExecutor(api, span)
  if (original) {
    cdp.tabAttachHandlers.clear()
    cdp.tabCleanupHandlers.clear()
  }
  return { cdp, calls }
}
test('CDP execution forwards target, cache, timeout and performance attributes', async () => {
  for (const options of [
    {},
    { timeoutMs: 100 },
    {
      expressionCacheKey: 'expression',
      preserveDebuggerOnTimeout: true,
      telemetryAttrs: { extra: 'value' }
    }
  ]) {
    async function exercise(original: boolean) {
      const f = await fixture(original),
        result = await f.cdp.call(
          '1',
          'Runtime.evaluate',
          { expression: '1', awaitPromise: true, returnByValue: true },
          options
        )
      return { result, calls: f.calls }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
test('execution retries top-level detached debugger once and propagates other failures', async () => {
  for (const fail of ['Debugger unattached', 'Debugger is not attached', 'other error']) {
    async function exercise(original: boolean) {
      const f = await fixture(original, fail)
      let result, error
      try {
        result = await f.cdp.call(1, 'Runtime.evaluate', { expression: '1' })
      } catch (e) {
        error = e
      }
      return { result, error, calls: f.calls }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
test('nested target does not retry debugger failure and cached commands require expressions', async () => {
  for (const target of [
    { tabId: 1, sessionId: 'nested' },
    { tabId: 1, targetId: 'frame' }
  ]) {
    async function exercise(original: boolean) {
      const f = await fixture(original, 'Debugger unattached')
      let error
      try {
        await f.cdp.callTarget(target, 'Runtime.evaluate', {})
      } catch (e) {
        error = e
      }
      return { error, calls: f.calls }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
  async function exercise(original: boolean) {
    const f = await fixture(original)
    try {
      await f.cdp.call(1, 'Runtime.evaluate', {}, { expressionCacheKey: 'key' })
    } catch (e: any) {
      return { error: e.message, calls: f.calls }
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('expired deadlines and malformed tab ids fail before transport dispatch', async () => {
  for (const id of ['invalid', 1]) {
    async function exercise(original: boolean) {
      const f = await fixture(original)
      try {
        await f.cdp.call(id, 'Page.enable', {}, { deadlineMs: 1 })
      } catch (e: any) {
        return { error: e.message, calls: f.calls }
      }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
test('prepare and before-dispatch hooks run in original order', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    await f.cdp.call(1, 'Page.getFrameTree', undefined, {
      prepareDispatch: async () => {
        f.calls.push('prepare')
      },
      beforeDispatch: () => f.calls.push('before')
    })
    return f.calls
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('CDP timeout diagnostics preserve original full-method redaction and nested target classification', async () => {
  const base = await originalDocumentation()
  for (const full of [true, false])
    for (const nested of [true, false]) {
      async function exercise(original: boolean) {
        const f = await fixture(original),
          diagnostics: any[] = [],
          capture = (error: any, options: any) =>
            diagnostics.push({ name: error.name, message: error.message, options })
        let restore = () => {}
        if (original) restore = base.configureCdpDiagnostics(capture)
        else f.cdp.captureException = capture
        f.cdp.api.executeCdp = async (params: any) => {
          if (params.method === 'Runtime.evaluate')
            throw Error('Timed out running CDP command "Runtime.evaluate"')
          return {}
        }
        try {
          try {
            await f.cdp.callTarget(
              nested ? { tabId: 1, sessionId: 'frame' } : { tabId: 1 },
              'Runtime.evaluate',
              { expression: 'secret' },
              { telemetryAttrs: full ? { 'browser_use.cdp.method': 'full' } : {} }
            )
          } catch {}
          return diagnostics
        } finally {
          restore()
        }
      }
      expect(await exercise(false)).toEqual(await exercise(true))
    }
})
