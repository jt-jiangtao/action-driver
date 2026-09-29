// @vitest-environment node
import { expect, test } from 'vitest'
import * as own from '../../src/tab-apis'
import { originalClient } from '../original-client'
async function compare(run: (api: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await run(own)).toEqual(await run(baselineApi))
}
function fixture(api: any, name: string, response: any = { state: 'state', data: 'AAH/' }) {
  const calls: any[] = []
  const scope = {
    browserId: 'b',
    tabId: 't',
    transport: {
      async send(request: any) {
        calls.push({
          json: request.command.toJSON(),
          keys: Object.keys(request),
          timeoutMs: request.timeoutMs
        })
        return response
      },
      async display(value: any) {
        calls.push({ display: value })
      }
    }
  }
  return { instance: new api[name](scope), calls, scope }
}
test('AX observation modes, binary decoding, diff option and output match original', async () => {
  await compare(async (api) => {
    const { instance: ax, calls } = fixture(api, 'AXAPI')
    const values = []
    for (const mode of [undefined, 'state', 'screenshot', 'both', 'other']) {
      values.push(await ax.get(mode, { disableDiffing: false }))
      await ax.write(mode)
    }
    return { values, calls, keys: Reflect.ownKeys(ax) }
  })
})
test('AX capture validates state, screenshot and missing screenshot fallback', async () => {
  for (const response of [
    { state: 'ok', screenshot_unavailable: 'hidden' },
    { data: 'AA==' },
    { state: 1, data: 'AA==' },
    { state: 'ok', data: '!invalid' }
  ])
    await compare(async (api) => {
      const { instance: ax, calls } = fixture(api, 'AXAPI', response),
        values = []
      for (const mode of ['state', 'screenshot', 'both']) {
        try {
          values.push(await ax.get(mode))
        } catch (e) {
          values.push((e as Error).message)
        }
      }
      return { values, calls }
    })
})
test('AX all actions preserve optional fields and caller parameters', async () => {
  await compare(async (api) => {
    const { instance: ax, calls } = fixture(api, 'AXAPI')
    await ax.click(1)
    await ax.click({ x: 1, y: 2 }, { mouseButton: 'right', clickCount: 2 })
    await ax.drag(1, 2)
    await ax.paste(null, 'x')
    await ax.paste(1, 'x', { format: 'html' })
    await ax.performSecondaryAction(1, 'open')
    await ax.pressKey(null, 'Enter')
    await ax.scroll(1, 'down')
    await ax.scroll(1, 'up', 2)
    await ax.selectText(1, 'x')
    await ax.selectText(1, 'x', { prefix: 'a', suffix: 'b', selectionType: 'range' })
    await ax.setValue(1, 'x')
    await ax.typeText(null, 'x')
    return calls
  })
})
test('coordinate CUA actions preserve data and type-level numeric validation', async () => {
  await compare(async (api) => {
    const { instance: cua, calls } = fixture(api, 'CUAAPI')
    await cua.click({ x: 1, y: 2, button: 1, keypress: ['Shift'] })
    await cua.double_click({ x: 0, y: 0 })
    await cua.scroll({ x: 1, y: 2, scrollX: 0, scrollY: 5 })
    await cua.type({ text: '' })
    await cua.keypress({ keys: ['Enter'] })
    await cua.drag({
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 2 }
      ],
      keys: ['Shift']
    })
    await cua.move({ x: NaN, y: Infinity })
    await cua.downloadMedia({ x: 1, y: 2, timeoutMs: 30 })
    return calls
  })
})
test('coordinate CUA rejects missing values and empty paths before transport', async () => {
  await compare(async (api) => {
    const { instance: cua, calls } = fixture(api, 'CUAAPI'),
      errors = []
    for (const action of [
      () => cua.click(null),
      () => cua.double_click({ x: 1 }),
      () => cua.scroll({ x: 1, y: 2 }),
      () => cua.type({ text: 1 }),
      () => cua.keypress({ keys: [] }),
      () => cua.drag({ path: [] }),
      () => cua.drag({ path: [null] }),
      () => cua.move({ x: '1', y: 2 }),
      () => cua.downloadMedia({})
    ]) {
      try {
        await action()
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { calls, errors }
  })
})
test('DOM CUA forwards nodes, observations and actions with timeout', async () => {
  await compare(async (api) => {
    const { instance: dom, calls } = fixture(api, 'DomCUAAPI')
    const value = await dom.get_visible_dom()
    await dom.click({ node_id: 'a' })
    await dom.double_click({ node_id: 'b' })
    await dom.scroll({ x: 1, y: 2 })
    await dom.scroll({ node_id: 'a', x: NaN, y: Infinity })
    await dom.type({ text: '' })
    await dom.keypress({ keys: ['Enter'] })
    await dom.downloadMedia({ node_id: 'a', timeoutMs: 30 })
    return { calls, value }
  })
})
test('DOM CUA node validation preserves required/type/empty errors', async () => {
  await compare(async (api) => {
    const { instance: dom, calls } = fixture(api, 'DomCUAAPI'),
      errors = []
    for (const action of [
      ...[undefined, null, 1, ''].map((node_id) => () => dom.click({ node_id })),
      () => dom.double_click({ node_id: '' }),
      () => dom.scroll({ node_id: null, x: 1, y: 2 }),
      () => dom.scroll({ x: '1', y: 2 }),
      () => dom.type({ text: 1 }),
      () => dom.keypress({ keys: [] }),
      () => dom.downloadMedia({})
    ]) {
      try {
        await action()
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { calls, errors }
  })
})
test('content exports project path and preserve format protocol', async () => {
  await compare(async (api) => {
    const { instance: content, calls } = fixture(api, 'ContentAPI', { path: '/tmp/file' })
    return {
      values: [
        await content.export(),
        await content.exportGsuite('pdf'),
        await content.exportYouTubeTranscript()
      ],
      calls
    }
  })
})
test('clipboard reads/writes map metadata and entry encodings', async () => {
  await compare(async (api) => {
    const { instance: clipboard, calls } = fixture(api, 'TabClipboardAPI', {
      text: 'hello',
      items: [
        {
          presentation_style: 'inline',
          entries: [
            { mime_type: 'text/plain', text: 'x' },
            { mime_type: 'image/png', base64: 'AA==' }
          ]
        }
      ]
    })
    const values = [await clipboard.readText(), await clipboard.read()]
    await clipboard.writeText('')
    await clipboard.write([
      {
        presentationStyle: 'attachment',
        entries: [
          { mimeType: 'text/plain', text: 'x' },
          { mimeType: 'image/png', base64: 'AA==' }
        ]
      }
    ])
    const errors = []
    for (const action of [
      () => clipboard.writeText(null),
      () => clipboard.write([]),
      () => clipboard.write(null)
    ]) {
      try {
        await action()
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { values, calls, errors }
  })
})
test('developer logs normalize warning and optional filters and reject invalid options', async () => {
  await compare(async (api) => {
    const { instance: dev, calls } = fixture(api, 'TabDevAPI', { logs: ['log'] })
    const values = [
      await dev.logs(),
      await dev.logs({ filter: '', levels: ['warning', 'debug', 'error'], limit: 1 }),
      await dev.logs({ filter: null, levels: null, limit: null })
    ]
    const errors = []
    for (const options of [
      { filter: 1 },
      { levels: [] },
      { levels: ['invalid'] },
      { limit: 0 },
      { limit: 1.1 }
    ]) {
      try {
        await dev.logs(options)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { values, calls, errors }
  })
})
test('Tab API constructors snapshot only their declared scope fields', async () => {
  await compare(async (api) => {
    const scope = {
      browserId: 'b',
      tabId: 't',
      transport: {
        async send() {
          return {}
        },
        async display() {}
      }
    }
    Object.defineProperty(scope, 'unrelated', {
      enumerable: true,
      get() {
        throw new Error('unrelated getter must not run')
      }
    })
    const results = []
    for (const name of [
      'AXAPI',
      'CUAAPI',
      'DomCUAAPI',
      'ContentAPI',
      'TabClipboardAPI',
      'TabDevAPI'
    ]) {
      try {
        results.push({ name, keys: Reflect.ownKeys(new api[name](scope)) })
      } catch (e) {
        results.push((e as Error).message)
      }
    }
    return results
  })
})
test('AX output failures propagate and stop subsequent image output', async () => {
  await compare(async (api) => {
    const { instance: ax, scope } = fixture(api, 'AXAPI'),
      output: unknown[] = []
    scope.transport.display = async (value: any) => {
      output.push(value)
      throw new Error('output failed')
    }
    let error
    try {
      await ax.write('both')
    } catch (e) {
      error = (e as Error).message
    }
    return { output, error }
  })
})
test('candidate AX connects to CUA Tab facade and emits state and PNG bytes', async () => {
  const { decorateBrowserTab } = await import('../../../cua/src/tab-adapter')
  const { instance: ax, calls } = fixture(own, 'AXAPI')
  const events: unknown[] = []
  const tab = decorateBrowserTab({ ax }, () => ({
    write(value, label) {
      events.push({ value, label })
    },
    emitImage(value) {
      events.push(value)
    }
  }))
  expect(await tab.getAXStateAndScreenshot()).toEqual({
    state: 'state',
    screenshot: new Uint8Array([0, 1, 255])
  })
  expect(events).toEqual([
    { value: 'state', label: 'cua.state' },
    { bytes: new Uint8Array([0, 1, 255]), mimeType: 'image/png' }
  ])
  await tab.pressKey(null, 'Enter')
  expect(calls.at(-1).json).toEqual({
    type: 'tab_ax_action',
    browser_id: 'b',
    tab_id: 't',
    action: { kind: 'press_key', element_index: null, key: 'Enter' }
  })
})
