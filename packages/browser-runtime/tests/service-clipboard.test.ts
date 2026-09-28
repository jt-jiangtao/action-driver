// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { ServiceClipboard } from '../src/service-clipboard'
import { originalDocumentation } from './original-service'
function transport() {
  const cdp: any = new EventEmitter(),
    calls: any[] = [],
    cleanup = new Set<any>(),
    contexts = new Map<string, any>()
  cdp.addTabCleanupHandler = (run: any) => {
    cleanup.add(run)
    return () => cleanup.delete(run)
  }
  cdp.callTarget = async (target: any, method: string, params: any) => {
    const key = JSON.stringify(target)
    let context = contexts.get(key)
    if (!context) {
      context = {
        navigator: {},
        document: { querySelectorAll: () => [] },
        Blob,
        DOMException,
        atob,
        btoa,
        addEventListener: () => {},
        removeEventListener: () => {}
      }
      context.parent = context
      vm.createContext(context)
      contexts.set(key, context)
    }
    calls.push([
      target,
      method,
      params.name ? 'binding' : (params.identifier ?? (params.expression ? 'expression' : 'script'))
    ])
    if (method === 'Runtime.addBinding')
      context[params.name] = (payload: string) =>
        cdp.emit('event', {
          source: target,
          method: 'Runtime.bindingCalled',
          params: { name: params.name, executionContextId: 1, payload }
        })
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      vm.runInContext(params.source, context)
      return { identifier: 'script' }
    }
    if (method === 'Runtime.evaluate')
      return { result: { value: vm.runInContext(params.expression, context) } }
    if (method === 'Runtime.removeBinding') delete context[params.name]
    return {}
  }
  return { cdp, calls, contexts, cleanup }
}
test('clipboard data validation and cloned reads preserve original wire contract', async () => {
  const base = await originalDocumentation()
  for (const items of [
    [],
    [{ entries: [] }],
    [{ entries: [{ mime_type: 'text/plain', text: 'text' }] }],
    [{ entries: [{ mime_type: 'image/png', base64: 'AQID' }], presentation_style: 'inline' }],
    [{ entries: [{ mime_type: 'text/plain', text: 'text', base64: 'AQID' }] }],
    [{ entries: [{ mime_type: 'image/png', base64: '%%%' }] }]
  ]) {
    function exercise(Type: any) {
      const state = new Type()
      try {
        state.write(items, 'clipboard.write')
        const first = state.read()
        first[0].entries[0].mime_type = 'changed'
        return state.read()
      } catch (e: any) {
        return e.message
      }
    }
    expect(exercise(ServiceClipboard)).toEqual(exercise(base.BaselineClipboard))
  }
})
test('page clipboard bridge installs once per target and exchanges read/write data with state', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const t = transport(),
      state = new Type()
    state.write([{ entries: [{ mime_type: 'text/plain', text: 'initial' }] }], 'write')
    const target = { tabId: 1 }
    await Promise.all([
      state.ensurePageClipboard(t.cdp, target),
      state.ensurePageClipboard(t.cdp, target)
    ])
    const context = t.contexts.get(JSON.stringify(target)),
      clip = context.navigator.clipboard,
      first = await clip.readText()
    await clip.writeText('changed')
    const after = state.read()
    await state.cleanupPageClipboards()
    await state.dispose()
    let error
    try {
      await state.ensurePageClipboard(t.cdp, target)
    } catch (e: any) {
      error = e.message
    }
    return { first, after, calls: t.calls, error, final: state.read(), cleanup: t.cleanup.size }
  }
  expect(await exercise(ServiceClipboard)).toEqual(await exercise(base.BaselineClipboard))
})
test('clipboard exclusive operations serialize and recover after rejection', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const state = new Type(),
      order: any[] = []
    const first = state.runExclusive(async () => {
        order.push('first')
        throw Error('failure')
      }),
      second = state.runExclusive(async () => {
        order.push('second')
        return 'ok'
      })
    const results = await Promise.allSettled([first, second])
    return {
      order,
      results: results.map((result: any) =>
        result.status === 'fulfilled' ? result.value : result.reason.message
      )
    }
  }
  expect(await exercise(ServiceClipboard)).toEqual(await exercise(base.BaselineClipboard))
})
test('detached page installations invalidate and reinstall before later clipboard operations', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const t = transport(),
      state = new Type(),
      target = { tabId: 1, sessionId: 'frame' }
    await state.ensurePageClipboard(t.cdp, target)
    t.cdp.emit('tabDetached', 1)
    await state.ensurePageClipboard(t.cdp, target)
    await state.dispose()
    return { calls: t.calls, cleanup: t.cleanup.size }
  }
  expect(await exercise(ServiceClipboard)).toEqual(await exercise(base.BaselineClipboard))
})
