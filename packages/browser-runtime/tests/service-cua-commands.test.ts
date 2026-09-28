import { expect, test, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { originalDocumentation } from './original-service'

vi.mock('../src/service-keyboard-input', () => ({
  clipboardShortcut: (keys: string[]) => keys.join('+') === 'Meta+Control+v' ? 'blocked' : null
}))

const handlers = async () =>
  ((await import('../src/service-cua-commands')) as any).cuaCommandHandlers

const baselineNames: Record<string, string> = {
  cua_click: 'baselineCuaClick',
  cua_double_click: 'baselineCuaDoubleClick',
  cua_drag: 'baselineCuaDrag',
  cua_keypress: 'baselineCuaKeypress',
  cua_move: 'baselineCuaMove',
  cua_scroll: 'baselineCuaScroll',
  cua_type: 'baselineCuaType',
  dom_cua_click: 'baselineDomCuaClick',
  dom_cua_double_click: 'baselineDomCuaDoubleClick',
  dom_cua_keypress: 'baselineDomCuaKeypress',
  dom_cua_scroll: 'baselineDomCuaScroll',
  dom_cua_type: 'baselineDomCuaType'
}

async function exercise(run: any, type: string, params: Record<string, unknown>) {
  const calls: unknown[] = []
  const cua = Object.fromEntries(
    ['clickPoint', 'dragPath', 'dispatchKeyPress', 'dispatchMouseMove', 'scrollPoint', 'clickDomCuaNode', 'scrollDomCuaNode'].map(
      (name) => [name, async (...args: unknown[]) => calls.push([name, ...args])]
    )
  )
  const context = {
    cua,
    runtime: { platform: 'darwin' },
    cdp: {
      platform: 'darwin',
      call: async (...args: unknown[]) => {
        calls.push(['cdp', ...args])
        return { cssVisualViewport: { clientWidth: 801, clientHeight: 601 } }
      }
    }
  }
  let result: unknown, error: string | undefined
  try {
    result = await run(params, context)
  } catch (cause) {
    error = (cause as Error).message
  }
  return { result, error, calls }
}

test('coordinate CUA actions preserve modifiers, button, timing and dispatch order', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  expect(own).toBeDefined()
  const cases = [
    ['cua_click', { tab_id: '12', x: 2.5, y: 3, button: 3, keys: ['ControlOrMeta', 'Shift'] }],
    ['cua_double_click', { tab_id: 12, x: 2.5, y: 3, keys: ['Alt'] }],
    ['cua_drag', { tab_id: 12, path: [{ x: 0, y: 3 }, { x: 4, y: 5 }], keys: ['Control'] }],
    ['cua_move', { tab_id: 12, x: 2.5, y: 3, keys: ['ControlOrMeta'] }],
    ['cua_scroll', { tab_id: 12, x: 2.5, y: 3, scroll_x: -7, scroll_y: 9, keys: ['Shift'] }]
  ] as const
  for (const [type, params] of cases)
    expect(await exercise(own[type], type, params)).toEqual(
      await exercise(baseline[baselineNames[type]], type, params)
    )
})

test('plain CUA typing pastes into the focused input with a matching token and selected target', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  async function type(run: any, command: string, wrongToken: boolean) {
    const dom = new JSDOM('<body><input id="entry" value="old"></body>', {
      runScripts: 'outside-only', pretendToBeVisual: true
    })
    const input = dom.window.document.querySelector('#entry') as HTMLInputElement
    input.focus()
    input.setSelectionRange(1, 2)
    Object.defineProperty(input, '__codexIabInputTargetToken', { value: 'expected' })
    const calls: unknown[] = []
    const context = {
      tabs: { get: async () => { throw Error('rich text should be skipped') } },
      clipboard: {
        runExclusive: async (run: () => Promise<unknown>) => { calls.push('exclusive'); return await run() },
        ensurePageClipboard: async (_cdp: unknown, target: unknown) => calls.push(['bridge', target])
      },
      cdp: {
        callTarget: async (target: unknown, method: string, args: any) => {
          calls.push(['cdp', target, method, args.contextId])
          return { result: { value: await dom.window.eval(args.expression) } }
        }
      }
    }
    let result, error
    try {
      result = await run({
        tab_id: 3, text: 'new', includeRichText: false, replaceInputValue: true,
        inputTargetToken: wrongToken ? 'other' : 'expected',
        target: { tabId: 3, sessionId: 'child' }, executionContextId: 7
      }, context)
    } catch (cause) { error = (cause as Error).message }
    const state = { result, error, calls, value: input.value }
    dom.window.close()
    return state
  }
  for (const command of ['cua_type', 'dom_cua_type'])
    for (const wrongToken of [false, true])
      expect(await type(own[command], command, wrongToken)).toEqual(
        await type(baseline[baselineNames[command]], command, wrongToken)
      )
})

test('plain CUA type validates text and tab before clipboard access and propagates page errors', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  for (const command of ['cua_type', 'dom_cua_type'])
    for (const params of [
      { tab_id: 3, includeRichText: false },
      { tab_id: 0, text: 'hello', includeRichText: false },
      { tab_id: 3, text: 'hello', includeRichText: false }
    ]) {
      async function type(run: any) {
        const calls: unknown[] = []
        const context = {
          clipboard: {
            runExclusive: async (fn: () => Promise<unknown>) => { calls.push('exclusive'); return await fn() },
            ensurePageClipboard: async () => calls.push('bridge')
          },
          cdp: { callTarget: async () => ({ result: { value: { ok: false, error: 'page failed' } } }) }
        }
        let result, error
        try { result = await run(params, context) } catch (cause) { error = (cause as Error).message }
        return { result, error, calls }
      }
      expect(await type(own[command])).toEqual(await type(baseline[baselineNames[command]]))
    }
})

test('Google Sheets uses plain text even with default rich-text setting', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  async function type(run: any) {
    const calls: unknown[] = []
    const context = {
      tabs: { get: async (id: number) => {
        calls.push(['tab', id])
        return { url: 'https://docs.google.com/spreadsheets/d/abc/edit' }
      } },
      clipboard: {
        runExclusive: async (fn: () => Promise<unknown>) => { calls.push('exclusive'); return await fn() },
        ensurePageClipboard: async () => calls.push('bridge')
      },
      cdp: { callTarget: async () => ({ result: { value: { ok: true, data: {} } } }) }
    }
    return { result: await run({ tab_id: 3, text: '**plain**' }, context), calls }
  }
  for (const command of ['cua_type', 'dom_cua_type'])
    expect(await type(own[command])).toEqual(await type(baseline[baselineNames[command]]))
})

test('rich CUA typing sends original plain+HTML clipboard payload and fallback flag', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  for (const command of ['cua_type', 'dom_cua_type']) {
    async function exercise(run: any, text: string) {
      const calls: string[] = []
      const context = {
        tabs: { get: async () => ({ url: 'https://example.com/login' }) },
        clipboard: {
          runExclusive: async (action: () => Promise<unknown>) => { calls.push('exclusive'); return await action() },
          ensurePageClipboard: async () => { calls.push('bridge') }
        },
        cdp: { callTarget: async (_target: unknown, method: string, params: any) => {
          calls.push(method)
          const items = baseline.baselineRichTextClipboardItems(text, true)
          expect(params.expression).toContain(JSON.stringify(items))
          expect(params.expression).toContain('"richTextFallback":true')
          return { result: { value: { ok: true, data: {} } } }
        } }
      }
      return { result: await run({ tab_id: 3, text }, context), calls }
    }
    for (const source of ['**rich**', '  line\nnext  ', '<script>alert(1)</script>'])
      expect(await exercise(own[command], source)).toEqual(
        await exercise(baseline[baselineNames[command]], source)
      )
  }
})

test('rich CUA typing inserts rendered HTML in a focused editable page like original', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  async function exercise(run: any) {
    const dom = new JSDOM('<body><div id="editor" contenteditable="true"></div></body>', {
      runScripts: 'outside-only', url: 'https://example.com/'
    })
    const view = dom.window, editor = view.document.querySelector('#editor') as HTMLElement
    const calls: unknown[] = []
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    ;(view.document as any).execCommand = (action: string, _showUi: boolean, value: string) => {
      calls.push([action, value])
      return true
    }
    editor.focus()
    const context = {
      tabs: { get: async () => ({ url: 'https://example.com/' }) },
      clipboard: { runExclusive: async (action: () => Promise<unknown>) => await action(),
        ensurePageClipboard: async () => undefined },
      cdp: { callTarget: async (_target: unknown, _method: string, params: any) => {
        try { return { result: { value: await view.eval(params.expression) } } }
        catch (error) { return { exceptionDetails: { text: String(error) } } }
      } }
    }
    let result: unknown, error: string | undefined
    try { result = await run({ tab_id: 3, text: '**bold**' }, context) }
    catch (cause) { error = String(cause) }
    view.close()
    return { result, error, calls }
  }
  const actual = await exercise(own.cua_type)
  expect(actual).toEqual(await exercise(baseline.baselineCuaType))
  expect(actual.error).toBeUndefined()
  expect(actual.calls).toContainEqual(['insertHTML', '<strong>bold</strong>'])
})

test('coordinate CUA rejects malformed coordinates, buttons, paths and tab IDs before input', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  const cases = [
    ['cua_click', { tab_id: 1, x: Infinity, y: 2 }],
    ['cua_click', { tab_id: 1, x: 2, y: 2, button: 4 }],
    ['cua_drag', { tab_id: 1, path: [] }],
    ['cua_drag', { tab_id: 1 }],
    ['cua_drag', { tab_id: 1, path: [{ x: NaN, y: 2 }] }],
    ['cua_move', { tab_id: 0, x: 2, y: 2 }],
    ['cua_scroll', { tab_id: 1, x: 2, y: -Infinity }]
  ] as const
  for (const [type, params] of cases)
    expect(await exercise(own[type], type, params)).toEqual(
      await exercise(baseline[baselineNames[type]], type, params)
    )
})

test('DOM CUA validates node IDs and scrolls from viewport center when node is omitted', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  const cases = [
    ['dom_cua_click', { tab_id: 1, node_id: '2', timeout_ms: 42 }],
    ['dom_cua_double_click', { tab_id: 1, node_id: '2' }],
    ['dom_cua_click', { tab_id: 1 }],
    ['dom_cua_double_click', { tab_id: 1, node_id: '' }],
    ['dom_cua_scroll', { tab_id: 1, node_id: '2', scroll_x: 3, scroll_y: -4 }],
    ['dom_cua_scroll', { tab_id: 1, scroll_x: 3, scroll_y: -4 }]
  ] as const
  for (const [type, params] of cases)
    expect(await exercise(own[type], type, params)).toEqual(
      await exercise(baseline[baselineNames[type]], type, params)
    )
})

test('CUA keypress handlers dispatch ordinary keys and preserve input validation errors', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  for (const type of ['cua_keypress', 'dom_cua_keypress'])
    for (const params of [{ tab_id: 1, keys: ['a'] }, { tab_id: 1, keys: [] }, { tab_id: 0, keys: ['a'] }])
      expect(await exercise(own[type], type, params)).toEqual(
        await exercise(baseline[baselineNames[type]], type, params)
      )
})

test('native clipboard shortcuts blocked by keyboard policy never reach page input', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  for (const type of ['cua_keypress', 'dom_cua_keypress']) {
    const params = { tab_id: 1, keys: ['Meta', 'Control', 'v'] }
    expect(await exercise(own[type], type, params)).toEqual(
      await exercise(baseline[baselineNames[type]], type, params)
    )
  }
})

test('visible DOM command returns the snapshot and validates tab IDs before CDP reads', async () => {
  const own = await handlers(), baseline = await originalDocumentation()
  async function capture(run: any, id: number) {
    const calls: string[] = []
    const context = {
      cdp: {
        addTabCleanupHandler: () => {},
        call: async (_tabId: number, method: string) => {
          calls.push(method)
          return { frameTree: { frame: { id: 'main', loaderId: 'document' } } }
        },
        callTarget: async (_target: unknown, method: string) => {
          calls.push(method)
          if (method === 'Page.createIsolatedWorld') return { executionContextId: 9 }
          return {
            result: {
              value: {
                viewport: { left: 0, right: 400, top: 0, bottom: 300 },
                items: [{ ref: '1', line: '<button node_id=1>Save</button>' }],
                frameElements: []
              }
            }
          }
        }
      }
    }
    let result, error
    try { result = await run({ tab_id: id }, context) } catch (cause) { error = (cause as Error).message }
    return { result, error, calls }
  }
  for (const id of [1, 0])
    expect(await capture(own.dom_cua_get_visible_dom, id)).toEqual(
      await capture(baseline.baselineDomCuaGetVisibleDom, id)
    )
})
