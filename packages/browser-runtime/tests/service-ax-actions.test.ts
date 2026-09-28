// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { AxActions } from '../src/service-ax-actions'
import { originalDocumentation } from './original-service'

async function pair(dialog: any, node: any) {
  const baseline = await originalDocumentation()
  const context = {
    cdp: {
      getJsDialog: () => dialog,
      activeJsDialog: (_id: number, dialogId: string) => ({ ...dialog, id: dialogId }),
      updateJsDialogPrompt: (_id: number, _dialogId: string, value: string) => { dialog.promptText = value }
    },
    ax: { targetForElement: (_tab: number, index: number) => node[index] },
    browserId: 'browser'
  }
  return [new AxActions(context), new baseline.BaselineAxActions(context)]
}

test('prompt editing and blocked page element behavior match original actions', async () => {
  for (const action of await pair({ id: 'd1', type: 'prompt', promptText: 'before' }, {
    2: { javaScriptDialog: { dialogID: 'd1', control: 'prompt' } },
    3: { javaScriptDialog: { dialogID: 'd1', control: 'accept' } },
    4: { javaScriptDialog: { dialogID: 'd0', control: 'prompt' } },
    5: {}
  })) {
    await action.perform(7, { kind: 'set_value', element_index: 2, value: 'after' })
    await action.perform(7, { kind: 'type_text', element_index: 2, text: '!' })
    expect(action.context.cdp.getJsDialog().promptText).toBe('after!')
    await expect(action.perform(7, { kind: 'click', target: [3, 4] })).rejects.toThrow('JavaScript dialog controls have no viewport coordinates')
    await expect(action.perform(7, { kind: 'click', target: 3, mouse_button: 'right' })).rejects.toThrow('JavaScript dialog controls only support left clicks')
    await expect(action.perform(7, { kind: 'set_value', element_index: 5, value: 'x' })).rejects.toThrow('A JavaScript dialog is blocking the requested page element')
    await expect(action.perform(7, { kind: 'set_value', element_index: 4, value: 'x' })).rejects.toThrow('JavaScript dialog is no longer active')
  }
})

test('point click, drag, scroll and viewport errors use the same native input', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const calls: any[] = []
    const cdp = {
      on() {}, removeListener() {}, getJsDialog: () => undefined,
      call: async (_id: number, method: string, params?: any) => {
        calls.push([method, params])
        if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 100, clientHeight: 80 } }
      }
    }
    const context = {
      cdp, ax: { targetForElement: () => { throw Error('unexpected node') } },
      cua: {
        clickPoint: async (value: any) => { calls.push(['clickPoint', value]) },
        dragPath: async (value: any) => { calls.push(['dragPath', value]) },
        dispatchMouseMove: async (...values: any[]) => { calls.push(['dispatchMouseMove', values]) }
      }
    }
    const actions = new Actions(context)
    await actions.perform(7, { kind: 'click', target: [20, 25] })
    await actions.perform(7, { kind: 'drag', from: [0, 0], to: [80, 60] })
    await actions.perform(7, { kind: 'scroll', target: [50, 40], direction: 'up', pages: 2 })
    expect(calls.find(([name]) => name === 'clickPoint')?.[1]).toMatchObject({ point: { x: 20, y: 25 }, tabId: 7, button: 'left', clickCount: 1 })
    expect(calls.find(([name]) => name === 'dragPath')?.[1].path).toHaveLength(9)
    expect(calls.find(([name]) => name === 'Input.dispatchMouseEvent')?.[1]).toMatchObject({ deltaX: 0, deltaY: -200 })
    await expect(actions.perform(7, { kind: 'click', target: [100, 0] })).rejects.toThrow('Coordinate is outside the active tab content viewport')
  }
})

test('indexed click resolves AX node, releases handle, and passes hit point to native input', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const calls: any[] = []
    const target = { tabId: 7 }, node = { id: 4, frameId: 'f', backendNodeId: 20, target, isOptionElement: false }
    const cdp = {
      on() {}, removeListener() {}, getJsDialog: () => undefined,
      callTarget: async (_target: any, method: string, params: any) => {
        calls.push([method, params])
        if (method === 'DOM.getContentQuads') return { quads: [[0, 0, 100, 0, 100, 40, 0, 40]] }
        if (method === 'DOM.resolveNode') return { object: { objectId: 'handle-1' } }
        if (method === 'Runtime.callFunctionOn') return { result: { value: { point: { x: 50, y: 20 }, hitsTarget: true, viewportSize: { width: 100, height: 40 } } } }
        return {}
      }
    }
    const context = {
      cdp, ax: {
        targetForElement: () => node,
        frameForId: () => ({ frameId: 'f', target, loaderId: 'l' }),
        trackDeferredPageLoad: () => {}
      },
      cua: { clickPoint: async (args: any) => { calls.push(['clickPoint', args]) } }
    }
    await new Actions(context).perform(7, { kind: 'click', target: 4 })
    expect(calls.find(([name]) => name === 'clickPoint')?.[1]).toMatchObject({
      button: 'left', clickCount: 1, point: { x: 50, y: 20 }, inputPoint: { x: 50, y: 20 }, tabId: 7
    })
    expect(calls.at(-1)?.[0]).toBe('clickPoint')
    expect(calls.some(([name]) => name === 'Runtime.releaseObject')).toBe(true)
  }
})

test('dialog opening during an action reports interruption and clears listeners', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const listeners = new Set<(event: any) => void>()
    let dialog: any
    const cdp = {
      on: (_name: string, callback: any) => { listeners.add(callback) },
      removeListener: (_name: string, callback: any) => { listeners.delete(callback) },
      getJsDialog: () => dialog,
      activeJsDialog: () => dialog,
      call: async () => ({ cssVisualViewport: { clientWidth: 100, clientHeight: 100 } })
    }
    const actions = new Actions({ cdp, ax: { targetForElement: () => undefined }, cua: {
      clickPoint: async () => {
        dialog = { id: 'd', type: 'alert', promptText: '' }
        for (const callback of listeners) callback({ method: 'Page.javascriptDialogOpening', source: { tabId: 7 }, params: { type: 'alert' } })
        throw Error('blocked by dialog')
      }
    } })
    await expect(actions.perform(7, { kind: 'click', target: [5, 5] })).rejects.toThrow('Browser action "click" interrupted by JavaScript alert')
    expect(listeners.size).toBe(0)
  }
})

test('secondary action requires advertised expand or collapse before clicking', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const calls: string[] = []
    const target = { tabId: 7 }
    const node = { id: 4, frameId: 'f', backendNodeId: 20, target, actionDescriptions: ['Expand'] }
    const context = {
      cdp: {
        on() {}, removeListener() {}, getJsDialog: () => undefined,
        callTarget: async (_target: any, method: string) => {
          calls.push(method)
          if (method === 'DOM.getContentQuads') return { quads: [[0, 0, 100, 0, 100, 40, 0, 40]] }
          if (method === 'DOM.resolveNode') return { object: { objectId: 'handle' } }
          if (method === 'Runtime.callFunctionOn') return { result: { value: { point: { x: 50, y: 20 }, hitsTarget: true, viewportSize: { width: 100, height: 40 } } } }
          return {}
        }
      },
      ax: { targetForElement: () => node, frameForId: () => ({ frameId: 'f', target }), trackDeferredPageLoad() {} },
      cua: { clickPoint: async () => { calls.push('clickPoint') } }
    }
    const actions = new Actions(context)
    await expect(actions.perform(7, { kind: 'perform_secondary_action', element_index: 4, action: 'Collapse' })).rejects.toThrow('does not support secondary action')
    expect(calls).toEqual([])
    await actions.perform(7, { kind: 'perform_secondary_action', element_index: 4, action: 'Expand' })
    expect(calls).toContain('clickPoint')
  }
})

test('AX set_value rejects explicitly unsettable nodes before DOM resolution', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const calls: string[] = []
    const context = { cdp: { on() {}, removeListener() {}, getJsDialog: () => undefined,
      callTarget: async (_target: any, method: string) => { calls.push(method); return {} } },
      ax: { targetForElement: () => ({ id: 5, isValueSettable: false, target: { tabId: 7 }, backendNodeId: 12 }) } }
    await expect(new Actions(context).perform(7, { kind: 'set_value', element_index: 5, value: 'x' })).rejects.toThrow('Accessibility element 5 has no settable value')
    expect(calls).toEqual([])
  }
})

test('AX type_text focuses indexed node and sends native text and newline events', async () => {
  const baseline = await originalDocumentation()
  const results: any[] = []
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const calls: any[] = []
    const target = { tabId: 7 }
    const context = {
      cdp: { on() {}, removeListener() {}, getJsDialog: () => undefined,
        callTarget: async (_target: any, method: string, params: any) => { calls.push([method, params]); return {} } },
      ax: { targetForElement: () => ({ id: 4, backendNodeId: 20, target }) },
      playwright: { focusNode: async () => ({ target }) }
    }
    await new Actions(context).perform(7, { kind: 'type_text', element_index: 4, text: 'A\n' })
    results.push(calls)
  }
  expect(results[0]).toEqual(results[1])
  expect(results[0].map(([name, value]: any) => [name, value.type])).toEqual([
    ['Input.dispatchKeyEvent', 'rawKeyDown'], ['Input.dispatchKeyEvent', 'char'],
    ['Input.dispatchKeyEvent', 'keyUp'], ['Input.dispatchKeyEvent', 'rawKeyDown'],
    ['Input.dispatchKeyEvent', 'keyUp']
  ])
})

test('AX press_key normalizes modifier names and focuses before keyboard dispatch', async () => {
  const calls: any[] = []
  const target = { tabId: 7 }
  const context = {
    cdp: { on() {}, removeListener() {}, getJsDialog: () => undefined },
    ax: { targetForElement: () => ({ id: 4, target }) },
    playwright: { focusNode: async () => { calls.push('focus'); return { target } } },
    keyboard: { clipboardShortcut: () => null,
      dispatchKeys: async (_cdp: any, actual: any, key: string) => { calls.push([actual, key]) } }
  }
  await new AxActions(context).perform(7, { kind: 'press_key', element_index: 4, key: 'Shift_L+A' })
  expect(calls).toEqual(['focus', [target, 'Shift+A']])
})

test('set_value executes the page setter through CDP and releases the node handle', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const input = document.createElement('input'); document.body.append(input)
    const calls: string[] = []
    const target = { tabId: 7 }
    const context = {
      cdp: { on() {}, removeListener() {}, getJsDialog: () => undefined,
        callTarget: async (_target: any, method: string, params: any) => {
          calls.push(method)
          if (method === 'DOM.resolveNode') return { object: { objectId: 'node' } }
          if (method === 'Runtime.callFunctionOn') {
            const fn = new Function(`return (${params.functionDeclaration})`)()
            return { result: { value: fn.call(input, params.arguments[0].value) } }
          }
          return {}
        } },
      ax: { targetForElement: () => ({ id: 4, target, backendNodeId: 20, isValueSettable: true }) }
    }
    await new Actions(context).perform(7, { kind: 'set_value', element_index: 4, value: 'Ada' })
    expect(input.value).toBe('Ada')
    expect(calls).toEqual(['DOM.resolveNode', 'Runtime.callFunctionOn', 'Runtime.releaseObject'])
    input.remove()
  }
})

test('covered AX element scrolls into view and retries hit testing before native click', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const calls: string[] = []
    let checks = 0
    const target = { tabId: 7 }, node = { id: 4, frameId: 'f', backendNodeId: 20, target }
    const context = {
      cdp: { on() {}, removeListener() {}, getJsDialog: () => undefined,
        callTarget: async (_target: any, method: string) => {
          calls.push(method)
          if (method === 'DOM.getContentQuads') return { quads: [[0, 0, 100, 0, 100, 40, 0, 40]] }
          if (method === 'DOM.resolveNode') return { object: { objectId: 'handle' } }
          if (method === 'Runtime.callFunctionOn') return { result: { value: { point: { x: 50, y: 20 },
            hitsTarget: ++checks > 1, hitTag: 'DIV', viewportSize: { width: 100, height: 40 } } } }
          return {}
        } },
      ax: { targetForElement: () => node, frameForId: () => ({ frameId: 'f', target }), trackDeferredPageLoad() {} },
      cua: { clickPoint: async () => { calls.push('clickPoint') } }
    }
    await new Actions(context).perform(7, { kind: 'click', target: 4 })
    expect(calls).toContain('DOM.scrollIntoViewIfNeeded')
    expect(calls.at(-1)).toBe('clickPoint')
  }
})

test('select_text applies AX text range through resolved page node and releases handle', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const input = document.createElement('input'); input.value = 'Ada Lovelace'; document.body.append(input)
    const calls: string[] = [], target = { tabId: 7 }
    const context = {
      cdp: { on() {}, removeListener() {}, getJsDialog: () => undefined,
        callTarget: async (_target: any, method: string, params: any) => {
          calls.push(method)
          if (method === 'DOM.resolveNode') return { object: { objectId: 'node' } }
          if (method === 'Runtime.callFunctionOn') {
            const fn = new Function(`return (${params.functionDeclaration})`)()
            return { result: { value: fn.call(input, params.arguments[0].value) } }
          }
          return {}
        } },
      ax: { targetForElement: () => ({ id: 4, target, backendNodeId: 20 }) }
    }
    await new Actions(context).perform(7, { kind: 'select_text', element_index: 4, text: 'Lovelace' })
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 12])
    expect(calls.at(-1)).toBe('Runtime.releaseObject')
    input.remove()
  }
})

test('dialog interruption aborts remaining AX type_text key events', async () => {
  const baseline = await originalDocumentation()
  for (const Actions of [AxActions, baseline.BaselineAxActions]) {
    const listeners = new Set<(event: any) => void>(), calls: string[] = []
    let dialog: any
    const target = { tabId: 7 }
    const context = {
      cdp: { on: (_name: string, callback: any) => { listeners.add(callback) },
        removeListener: (_name: string, callback: any) => { listeners.delete(callback) },
        getJsDialog: () => dialog, activeJsDialog: () => dialog,
        callTarget: async (_target: any, method: string, params: any) => {
          calls.push(params.type)
          dialog = { id: 'd', type: 'alert', message: 'Stop' }
          for (const callback of listeners) callback({ method: 'Page.javascriptDialogOpening', source: { tabId: 7 }, params: { type: 'alert' } })
          return {}
        } },
      ax: { targetForElement: () => ({ id: 4, target }) },
      playwright: { focusNode: async () => ({ target }) }
    }
    await expect(new Actions(context).perform(7, { kind: 'type_text', element_index: 4, text: 'abc' })).rejects.toThrow('interrupted by JavaScript alert')
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual(['rawKeyDown'])
  }
})
