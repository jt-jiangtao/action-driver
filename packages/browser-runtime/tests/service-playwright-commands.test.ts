// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { EventEmitter } from 'node:events'
import { PlaywrightInput } from '../src/service-playwright-input'
import { CommandTiming } from '../src/service-command-timing'
import { originalDocumentation } from './original-service'
const handlers = async () =>
  ((await import('../src/service-playwright-commands').catch(() => ({}))) as any)
    .playwrightCommandHandlers
const names = {
  playwright_locator_click: 'baselineLocatorClick',
  playwright_locator_dblclick: 'baselineLocatorDblclick',
  playwright_locator_count: 'baselineLocatorCount',
  playwright_locator_is_enabled: 'baselineLocatorEnabled',
  playwright_locator_is_visible: 'baselineLocatorVisible',
  playwright_locator_get_attribute: 'baselineLocatorAttribute',
  playwright_locator_inner_text: 'baselineLocatorInnerText',
  playwright_locator_all_text_contents: 'baselineLocatorAllText',
  playwright_locator_text_content: 'baselineLocatorText',
  playwright_locator_read_all: 'baselineLocatorReadAll',
  playwright_locator_select_option: 'baselineLocatorSelect',
  playwright_locator_set_checked: 'baselineLocatorChecked',
  playwright_locator_wait_for: 'baselineLocatorWait'
}
test('locator command reads, credential redaction, selection and checkbox actions match original on real DOM', async () => {
  const own = await handlers()
  expect(own).toBeDefined()
  const base = await originalDocumentation()
  async function exercise(run: any, type: string, variant: number) {
    const dom = new JSDOM(
        '<body><div class="item" data-id="first"><span>First</span></div><div class="item"><span>Second</span></div><input id="secret" type="password" value="hidden"><input id="check" type="checkbox"><select id="select" multiple><option value="a">Alpha</option><option value="b">Beta</option></select></body>',
        { runScripts: 'outside-only', pretendToBeVisual: true }
      ),
      w = dom.window,
      calls: any[] = []
    const style = w.getComputedStyle.bind(w)
    w.getComputedStyle = (el) => style(el)
    w.Element.prototype.scrollIntoView = function () {
      calls.push(['scroll', this.id])
    }
    w.Element.prototype.getClientRects = () =>
      [{ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }] as any
    w.Element.prototype.getBoundingClientRect = () =>
      ({ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }) as any
    const cdp = Object.assign(new EventEmitter(), {
        platform: 'darwin',
        callTarget: async (_target: any, method: string, params: any) => {
          if (method === 'Runtime.evaluate')
            return { result: { value: await w.eval(params.expression) } }
          return {}
        }
      }),
      cua = {
        clickPoint: async (action: any) => {
          calls.push(['click', action.clickCount])
          ;(w.document.querySelector('#check') as HTMLElement).click()
        }
      },
      api = new PlaywrightInput(
        cdp as any,
        cua,
        { currentPlaywrightOperation: (f) => f },
        new CommandTiming()
      )
    const params: any = { tab_id: 1, selector: '.item', timeout_ms: 0 }
    if (type.includes('click') || type.includes('checked'))
      Object.assign(params, { selector: '#check', checked: variant === 0 })
    if (type.includes('attribute'))
      Object.assign(params, {
        selector: variant === 0 ? '#secret' : '.item',
        name: variant === 0 ? 'value' : 'data-id'
      })
    if (type.includes('select_option'))
      Object.assign(params, {
        selector: '#select',
        selections: [variant === 0 ? { value: 'b' } : { label: 'Alpha' }]
      })
    if (type.includes('read_all')) params.relative_selector = variant === 0 ? undefined : 'span'
    if (type.includes('wait_for'))
      Object.assign(params, {
        selector: variant === 0 ? '.item' : '#absent',
        state: variant === 0 ? 'attached' : 'hidden'
      })
    let result, error
    try {
      result = await run(params, { playwright: api })
    } catch (e: any) {
      error = e.message
    }
    const state = {
      checked: (w.document.querySelector('#check') as any).checked,
      selected: Array.from((w.document.querySelector('#select') as any).selectedOptions).map(
        (el: any) => el.value
      )
    }
    w.close()
    return { result, error, state, calls }
  }
  for (const [type, name] of Object.entries(names))
    for (const variant of [0, 1])
      expect(await exercise(own[type], type, variant)).toEqual(
        await exercise(base[name], type, variant)
      )
})
test('invalid checked, attribute and wait states fail before evaluation; radio uncheck is rejected', async () => {
  const own = await handlers()
  expect(own).toBeDefined()
  const base = await originalDocumentation()
  for (const [type, name, params] of [
    ['playwright_locator_set_checked', 'baselineLocatorChecked', { checked: 'yes' }],
    ['playwright_locator_set_checked', 'baselineLocatorChecked', { checked: false }],
    ['playwright_locator_get_attribute', 'baselineLocatorAttribute', { name: '' }],
    ['playwright_locator_wait_for', 'baselineLocatorWait', { state: 'ready' }]
  ] as const) {
    async function exercise(run: any) {
      const calls: any[] = [],
        ctx = {
          playwright: {
            readCheckedState: async () => {
              calls.push('read')
              return { checked: true, isRadio: true }
            },
            clickLocator: async () => calls.push('click')
          }
        }
      let error
      try {
        await run(params, ctx)
      } catch (e: any) {
        error = e.message
      }
      return { error, calls }
    }
    expect(await exercise(own[type])).toEqual(await exercise(base[name]))
  }
})
test('sequential typing dispatches Unicode characters, stops on focus/target drift and cleans token after failure', async () => {
  const own = await handlers()
  expect(typeof own?.playwright_locator_press_sequentially).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, mode: string) {
    const dom = new JSDOM('<body><input id="text"></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true
      }),
      w = dom.window,
      events: any[] = []
    w.Element.prototype.scrollIntoView = () => {}
    w.Element.prototype.getClientRects = () =>
      [{ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }] as any
    w.Element.prototype.getBoundingClientRect = () =>
      ({ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }) as any
    const style = w.getComputedStyle.bind(w)
    w.getComputedStyle = (el) => style(el)
    const cdp = Object.assign(new EventEmitter(), {
        platform: 'darwin',
        call: async (_id: number, method: string, params: any) => {
          events.push([method, params])
          if (mode === 'blur') (w.document.activeElement as HTMLElement).blur()
          if (mode === 'dispatch-fail') throw Error('native dispatch failed')
        },
        callTarget: async (_target: any, method: string, params: any) => {
          if (method === 'Runtime.evaluate')
            return { result: { value: await w.eval(params.expression) } }
          return {}
        }
      }),
      api = new PlaywrightInput(
        cdp as any,
        {} as any,
        { currentPlaywrightOperation: (f) => f },
        new CommandTiming()
      )
    const evaluate = api.evaluateOnPlaywrightSelectorWithTarget.bind(api)
    api.evaluateOnPlaywrightSelectorWithTarget = async (...args: any[]) => {
      const result = await evaluate(...(args as [any, any, any, any]))
      return {
        ...result,
        target: args[3]?.retry === false && mode === 'changed' ? { tabId: 2 } : result.target
      }
    }
    let result, error
    try {
      result = await run(
        { tab_id: 1, selector: '#text', value: 'a😀', timeout_ms: 200 },
        { playwright: api, cdp }
      )
    } catch (e: any) {
      error = e.message
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      w.document.querySelector('#text'),
      '__codexPressSequentiallyTargetToken'
    )
    w.close()
    return { result, error, events, tokenRemaining: descriptor != null }
  }
  for (const mode of ['success', 'blur', 'changed', 'dispatch-fail']) {
    const actual = await exercise(own.playwright_locator_press_sequentially, mode)
    expect(actual).toEqual(await exercise(base.baselineLocatorSequential, mode))
    expect(actual.tokenRemaining).toBe(false)
    if (mode === 'success') {
      expect(actual.error).toBeUndefined()
      expect(actual.events).toHaveLength(3)
      expect(actual.events.at(-1)).toEqual(['Input.insertText', { text: '😀' }])
    } else
      expect(actual.error).toContain(
        mode === 'dispatch-fail' ? 'native dispatch failed' : 'target changed or lost focus'
      )
  }
})
test('fill command uses native Playwright fill for date fields and guarded virtual paste for text', async () => {
  const own = await handlers()
  expect(typeof own?.playwright_locator_fill).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, kind: string, replace: boolean, value: any) {
    const dom = new JSDOM(
        `<body><input id="field" type="${kind}" value="${kind === 'date' ? '2024-01-01' : 'old'}"></body>`,
        { runScripts: 'outside-only', pretendToBeVisual: true }
      ),
      w = dom.window,
      element = w.document.querySelector('#field') as HTMLInputElement,
      calls: any[] = []
    element.focus()
    w.Element.prototype.scrollIntoView = () => {}
    w.Element.prototype.getClientRects = () =>
      [{ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }] as any
    w.Element.prototype.getBoundingClientRect = () =>
      ({ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }) as any
    const style = w.getComputedStyle.bind(w)
    w.getComputedStyle = (el) => style(el)
    const cdp = Object.assign(new EventEmitter(), {
        platform: 'darwin',
        callTarget: async (_target: any, method: string, params: any) => {
          calls.push(method)
          if (method === 'Runtime.evaluate')
            return { result: { value: await w.eval(params.expression) } }
          return {}
        }
      }),
      clipboard = {
        ensurePageClipboard: async () => {
          calls.push('bridge')
        },
        runExclusive: async (run: any) => await run()
      },
      api = new PlaywrightInput(
        cdp as any,
        {} as any,
        { currentPlaywrightOperation: (f) => f },
        new CommandTiming()
      )
    let result, error
    try {
      result = await run(
        { tab_id: 1, selector: '#field', value, replace, timeout_ms: 100 },
        { playwright: api, cdp, clipboard }
      )
    } catch (e: any) {
      error = e.message
    }
    const state = { result, error, value: element.value, calls }
    w.close()
    return state
  }
  for (const kind of ['text', 'date'])
    for (const replace of [true, false])
      for (const value of [kind === 'date' ? '2026-09-28' : 'new', 7]) {
        const result = await exercise(own.playwright_locator_fill, kind, replace, value)
        expect(result).toEqual(await exercise(base.baselineLocatorFill, kind, replace, value))
        if (typeof value === 'string') {
          expect(result.error).toBeUndefined()
          if (replace) expect(result.value).toBe(value)
        } else expect(result.error).toBe('playwright_locator_fill requires string value')
      }
})
test('download path and wait handlers preserve single-tab intent, timeout cap and cleanup', async () => {
  const own = await handlers()
  expect(typeof own?.playwright_wait_for_download).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, type: string, scenario: string) {
    const calls: any[] = [],
      downloads = {
        getPath: (key: string) => {
          calls.push(['path', key])
          return '/tmp/file'
        },
        withDownload: async (id: number, callback: any) => {
          calls.push(['exclusive', id])
          return await callback()
        },
        enableDownload: async (id: number) => calls.push(['enable', id]),
        waitForDownload: async (id: number, timeout: number) => {
          calls.push(['wait', id, timeout])
          if (scenario === 'fail') throw Error('download failed')
          return { id: 'download-1' }
        },
        disableDownload: async (id: number) => calls.push(['disable', id])
      }
    let result, error
    try {
      result = await run(
        {
          tab_id: scenario === 'invalid' ? 0 : 3,
          download_id: scenario === 'no-id' ? '' : 'one',
          timeout_ms: scenario === 'cap' ? 999999 : 100
        },
        { downloads }
      )
    } catch (e: any) {
      error = e.message
    }
    return { result, error, calls }
  }
  for (const type of ['playwright_download_path', 'playwright_wait_for_download'])
    for (const scenario of ['success', 'fail', 'invalid', 'no-id', 'cap']) {
      const original =
        type === 'playwright_download_path' ? base.baselineDownloadPath : base.baselineWaitDownload
      expect(await exercise(own[type], type, scenario)).toEqual(
        await exercise(original, type, scenario)
      )
    }
})
test('media download resolves current URL in selected frame, arms scoped intent and releases it on every outcome', async () => {
  const own = await handlers()
  expect(typeof own?.playwright_locator_download_media).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, scenario: string) {
    const calls: any[] = [],
      enable = async () => {
        calls.push('disable')
      },
      downloads = {
        withDownload: async (id: number, callback: any) => {
          calls.push(['exclusive', id])
          return await callback()
        },
        enableMediaDownload: async (id: number, url: string, frame: string) => {
          calls.push(['enable', id, url, frame])
          return enable
        },
        waitForDownload: async (id: number, timeout: number) => {
          calls.push(['wait', id, timeout])
          if (scenario === 'wait-fail') throw Error('download failed')
          return { filename: 'file.pdf' }
        }
      },
      security = {
        ensureDownloadSourcePolicyAllowed: async (id: number) => calls.push(['policy', id])
      },
      playwright = {
        evaluateOnPlaywrightSelectorWithTarget: async (
          _id: number,
          _selector: string,
          page: any,
          options: any
        ) => {
          calls.push(['read', options.includeFrameIdentity, options.timeoutMs > 0])
          if (scenario === 'no-url')
            return {
              result: await page({
                scrollIntoView: () => {},
                closest: () => null,
                querySelector: () => null,
                currentSrc: '',
                src: '',
                href: '',
                getAttribute: () => ''
              })
            }
          return {
            result: 'https://example.test/media.pdf',
            frameIdentity: scenario === 'no-frame' ? null : { frameId: 'child' }
          }
        },
        evaluateOnPlaywrightSelector: async (
          _id: number,
          _selector: string,
          page: any,
          options: any
        ) => {
          calls.push(['trigger', options.arg])
          if (scenario === 'click-fail') throw Error('click failed')
          return true
        }
      }
    let result, error
    try {
      result = await run(
        { tab_id: scenario === 'invalid' ? 0 : 3, selector: '#media', timeout_ms: 200 },
        { downloads, security, playwright }
      )
    } catch (e: any) {
      error = e.message
    }
    return {
      result,
      error,
      calls: calls.map((item) =>
        Array.isArray(item) && item[0] === 'wait'
          ? [item[0], item[1], item[2] > 0 && item[2] <= 200]
          : item
      )
    }
  }
  for (const scenario of ['success', 'wait-fail', 'click-fail', 'no-frame', 'no-url', 'invalid'])
    expect(await exercise(own.playwright_locator_download_media, scenario)).toEqual(
      await exercise(base.baselineDownloadMedia, scenario)
    )
})
test('ARIA snapshot recursively expands visible frames and removes presentation-only nodes', async () => {
  const own = await handlers()
  expect(typeof own?.playwright_dom_snapshot).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, mode: string, iab: boolean) {
    const calls: any[] = [],
      root = {
        full: '- main:\n  - generic [ref=g]:\n    - button "Go" [ref=b]\n  - iframe [ref=f]:\n  - img [ref=im]',
        iframeRefs: ['f'],
        iframeDepths: { f: 1 }
      },
      child = {
        full: '- generic:\n  - link "Next" [ref=link]\n  - iframe [ref=deep]',
        iframeRefs: ['deep'],
        iframeDepths: { deep: 1 }
      },
      deep = { full: '- paragraph: hello', iframeRefs: [], iframeDepths: {} }
    const ctx = {
      isIabBackend: iab,
      playwright: {
        evaluateOnPlaywrightPage: async (_id: number, _page: any, options: any) => {
          calls.push(['root', options.timeoutMs])
          return root
        },
        evaluateOnPlaywrightSelector: async (
          _id: number,
          selector: string,
          _page: any,
          options: any
        ) => {
          calls.push([
            'frame',
            selector,
            options.retry,
            options.scrollFrameIntoView,
            options.timeoutMs <= 500
          ])
          if (mode === 'failure' && selector.includes('aria-ref=f'))
            throw Error('frame inaccessible')
          return selector.includes('aria-ref=deep') ? deep : child
        }
      }
    }
    let result, error
    try {
      result = await run({ tab_id: 3, timeout_ms: 200 }, ctx)
    } catch (e: any) {
      error = e.message
    }
    return {
      result,
      error,
      calls: calls.map((call) => (call[0] === 'frame' ? [...call.slice(0, 4), call[4]] : call))
    }
  }
  for (const mode of ['ok', 'failure'])
    for (const iab of [false, true])
      expect(await exercise(own.playwright_dom_snapshot, mode, iab)).toEqual(
        await exercise(base.baselineDomSnapshot, mode, iab)
      )
})
test('ARIA root page program is self-contained when serialized into an isolated browser realm', async () => {
  const own = await handlers(),
    base = await originalDocumentation()
  async function exercise(run: any) {
    const dom = new JSDOM('<body><button>Go</button></body>', { runScripts: 'outside-only' }),
      w = dom.window,
      calls: any[] = []
    const ctx = {
      isIabBackend: false,
      playwright: {
        evaluateOnPlaywrightPage: async (_id: number, page: any) => {
          calls.push('page')
          return await w.eval('(' + page.toString() + ')')({
            incrementalAriaSnapshot: () => ({
              full: '- button "Go" [ref=b]',
              iframeRefs: [],
              iframeDepths: {}
            })
          })
        },
        evaluateOnPlaywrightSelector: async () => {
          throw Error('unexpected frame')
        }
      }
    }
    let result, error
    try {
      result = await run({ tab_id: 1, timeout_ms: 100 }, ctx)
    } catch (e: any) {
      error = e.message
    }
    w.close()
    return { result, error, calls }
  }
  expect(await exercise(own.playwright_dom_snapshot)).toEqual(
    await exercise(base.baselineDomSnapshot)
  )
})
test('ARIA iframe page program stays self-contained across serialized frame evaluation', async () => {
  const own = await handlers(),
    base = await originalDocumentation()
  async function exercise(run: any) {
    const dom = new JSDOM('<body><iframe id="nested" name="inner"></iframe></body>', {
        runScripts: 'outside-only'
      }),
      w = dom.window,
      iframe = w.document.querySelector('iframe')!,
      calls: any[] = []
    const injected = {
      incrementalAriaSnapshot: (element: any) =>
        element === w.document.body
          ? { full: '- iframe [ref=f]', iframeRefs: ['f'], iframeDepths: { f: 1 } }
          : { full: '- paragraph: child', iframeRefs: [], iframeDepths: {} },
      parseSelector: (value: string) => value,
      querySelectorAll: () => [iframe],
      elementState: () => ({ matches: true })
    }
    const ctx = {
      isIabBackend: false,
      playwright: {
        evaluateOnPlaywrightPage: async (_id: number, page: any) => {
          calls.push('root')
          return await w.eval('(' + page.toString() + ')')(injected)
        },
        evaluateOnPlaywrightSelector: async (_id: number, selector: string, page: any) => {
          calls.push(selector)
          return await w.eval('(' + page.toString() + ')')({ id: 'child' }, injected)
        }
      }
    }
    let result, error
    try {
      result = await run({ tab_id: 1, timeout_ms: 100 }, ctx)
    } catch (e: any) {
      error = e.message
    }
    w.close()
    return { result, error, calls }
  }
  expect(await exercise(own.playwright_dom_snapshot)).toEqual(
    await exercise(base.baselineDomSnapshot)
  )
})
test('locator press validates text, focuses target and dispatches ordinary macOS key chords', async () => {
  const own = await handlers()
  expect(typeof own?.playwright_locator_press).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, value: any) {
    const calls: any[] = [],
      target = { tabId: 3, sessionId: 'frame' },
      ctx = {
        playwright: {
          focusLocator: async (_params: any, options: any) => {
            calls.push(['focus', options])
            return { target, blockClosedShadowInput: false }
          }
        },
        cdp: {
          platform: 'darwin',
          call: async (...args: any[]) => calls.push(['call', ...args]),
          callTarget: async (...args: any[]) => calls.push(['target', ...args])
        },
        clipboard: { runExclusive: async (run: any) => await run() }
      }
    let result, error
    try {
      result = await run({ tab_id: 3, selector: '#field', value, timeout_ms: 100 }, ctx)
    } catch (e: any) {
      error = e.message
    }
    return {
      result,
      error,
      calls: calls.map((call) =>
        call[0] === 'target'
          ? [
              call[0],
              call[1],
              call[2],
              call[3],
              { deadlineMs: typeof call[4]?.deadlineMs === 'number' }
            ]
          : call
      )
    }
  }
  for (const value of ['Enter', 'Meta+a', 'a', '', 7]) {
    const result = await exercise(own.playwright_locator_press, value)
    expect(result).toEqual(await exercise(base.baselineLocatorPress, value))
    if (value === 'Enter' || value === 'a')
      expect(result.calls.some((call) => call[0] === 'target')).toBe(true)
  }
})
test('locator clipboard shortcuts use virtual clipboard and commit cut only after captured data is stored', async () => {
  const own = await handlers(),
    base = await originalDocumentation()
  async function exercise(run: any, value: string, mode: string) {
    const calls: any[] = [],
      clipboardItems = [
        {
          entries: [{ mime_type: 'text/plain', text: 'virtual' }],
          presentation_style: 'unspecified'
        }
      ],
      target = { tabId: 3 },
      cdp = {
        platform: 'darwin',
        callTarget: async (_target: any, method: string, params: any) => {
          calls.push([
            'cdp',
            method,
            method === 'Runtime.evaluate'
              ? { contextId: params.contextId, returnByValue: params.returnByValue }
              : params
          ])
          if (method === 'Runtime.evaluate' && params.returnByValue === false) return { result: {} }
          if (method === 'Runtime.evaluate')
            return {
              result: {
                value: {
                  ok: true,
                  data: mode === 'empty' ? {} : { items: clipboardItems, cutToken: 'cut-1' }
                }
              }
            }
          return {}
        }
      },
      clipboard = {
        read: () => {
          calls.push(['read'])
          return clipboardItems
        },
        write: (items: any, name: any) => calls.push(['write', items, name]),
        runExclusive: async (run: any) => {
          calls.push(['exclusive'])
          return await run()
        },
        ensurePageClipboard: async (_cdp: any, where: any) => calls.push(['bridge', where])
      },
      playwright = {
        focusLocator: async (_params: any, options: any) => {
          calls.push(['focus', options])
          return { target }
        }
      }
    let result, error
    try {
      result = await run(
        { tab_id: 3, selector: '#field', value, timeout_ms: 100 },
        { cdp, clipboard, playwright }
      )
    } catch (e: any) {
      error = e.message
    }
    return {
      result,
      error,
      calls: calls.map((call) =>
        call[0] === 'cdp' && call[1] === 'Runtime.evaluate' ? [call[0], call[1], call[2]] : call
      )
    }
  }
  for (const value of ['Meta+v', 'Meta+c', 'Meta+x', 'Meta+Shift+v', 'Meta+Shift+c'])
    for (const mode of ['normal', 'empty'])
      expect(await exercise(own.playwright_locator_press, value, mode)).toEqual(
        await exercise(base.baselineLocatorPress, value, mode)
      )
})
test('virtual clipboard follows focused same-process and OOPIF frames with object release', async () => {
  const own = await handlers(),
    base = await originalDocumentation()
  async function exercise(run: any, mode: string) {
    const calls: any[] = [],
      root = { tabId: 3 },
      child = { tabId: 3, sessionId: 'child' },
      seen = new Set<string>()
    const cdp = {
        platform: 'darwin',
        callTarget: async (target: any, method: string, params: any) => {
          calls.push([
            target,
            method,
            method === 'Runtime.evaluate'
              ? { contextId: params.contextId, returnByValue: params.returnByValue }
              : params
          ])
          if (method === 'Runtime.evaluate' && params.returnByValue === false) {
            const key = target.sessionId ?? params.contextId ?? 'root'
            if (!seen.has(key)) {
              seen.add(key)
              return { result: { objectId: 'owner' } }
            }
            return { result: {} }
          }
          if (method === 'DOM.describeNode') return { node: { frameId: 'child-frame' } }
          if (method === 'Page.createIsolatedWorld') return { executionContextId: 4 }
          if (method === 'Runtime.evaluate') return { result: { value: { ok: true, data: {} } } }
          return {}
        },
        targetForFrameOrAttach: async () => (mode === 'oopif' ? child : null)
      },
      clipboard = {
        read: () => [{ entries: [{ mime_type: 'text/plain', text: 'hello' }] }],
        runExclusive: async (run: any) => await run(),
        ensurePageClipboard: async (_cdp: any, target: any) => calls.push(['bridge', target])
      },
      playwright = { focusLocator: async () => ({ target: root }) }
    let result, error
    try {
      result = await run(
        { tab_id: 3, selector: '#input', value: 'Meta+v', timeout_ms: 100 },
        { cdp, clipboard, playwright }
      )
    } catch (e: any) {
      error = e.message
    }
    return { result, error, calls }
  }
  for (const mode of ['same-process', 'oopif'])
    expect(await exercise(own.playwright_locator_press, mode)).toEqual(
      await exercise(base.baselineLocatorPress, mode)
    )
})
