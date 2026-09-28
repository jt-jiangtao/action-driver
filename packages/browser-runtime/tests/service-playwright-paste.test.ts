// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { originalDocumentation } from './original-service'
const candidate = async () =>
  ((await import('../src/service-playwright-paste').catch(() => ({}))) as any).pastePage
const items = (text: string) => [
  { entries: [{ mime_type: 'text/plain', text }], presentation_style: 'unspecified' }
]
test('virtual clipboard paste preserves input selection, replacement, events and IAB focus token', async () => {
  const own = await candidate()
  expect(typeof own).toBe('function')
  const base = await originalDocumentation()
  async function exercise(
    page: any,
    kind: string,
    replace: boolean,
    token: boolean,
    wrongToken: boolean
  ) {
    const dom = new JSDOM(
        `<body><${kind} id="input" ${kind === 'input' ? 'value="before"' : ''}>${kind === 'textarea' ? 'before' : ''}</${kind}></body>`,
        { runScripts: 'outside-only', pretendToBeVisual: true }
      ),
      w = dom.window,
      el = w.document.querySelector('#input') as HTMLInputElement,
      events: string[] = []
    el.addEventListener('input', () => events.push('input'))
    el.addEventListener('paste', () => events.push('paste'))
    el.focus()
    el.setSelectionRange(1, 3)
    if (token)
      Object.defineProperty(el, '__codexIabInputTargetToken', {
        configurable: true,
        value: 'expected',
        writable: true
      })
    let result, error
    try {
      result = await w.eval('(' + page.toString() + ')')({
        action: 'paste',
        clipboardItems: items('new'),
        replaceInputValue: replace,
        requireDocumentFocus: false,
        ...(token ? { iabInputTargetToken: wrongToken ? 'different' : 'expected' } : {})
      })
    } catch (e: any) {
      error = e.message
    }
    const state = {
      result,
      error,
      value: el.value,
      selection: [el.selectionStart, el.selectionEnd],
      events
    }
    w.close()
    return state
  }
  for (const kind of ['input', 'textarea'])
    for (const replace of [false, true])
      for (const token of [false, true])
        for (const wrongToken of token ? [false, true] : [false]) {
          const result = await exercise(own, kind, replace, token, wrongToken)
          expect(result).toEqual(
            await exercise(base.baselineClipboardPage, kind, replace, token, wrongToken)
          )
          if (!wrongToken) {
            expect(result.error).toBeUndefined()
            expect(result.events).toContain('input')
          } else expect(result.error).toContain('target token mismatch')
        }
})
test('clipboard action installs trusted bridge, executes in selected context and wraps page errors like original', async () => {
  const own = ((await import('../src/service-playwright-paste').catch(() => ({}))) as any)
    .runClipboardPageAction
  expect(typeof own).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, mode: string) {
    const dom = new JSDOM('<body><input id="text" value="old"></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true
      }),
      w = dom.window,
      element = w.document.querySelector('#text') as HTMLInputElement,
      calls: any[] = []
    element.focus()
    const ctx = {
      clipboard: {
        ensurePageClipboard: async (_cdp: any, target: any) => calls.push(['bridge', target])
      },
      cdp: {
        callTarget: async (target: any, method: string, params: any) => {
          calls.push([
            'cdp',
            target,
            method,
            {
              contextId: params.contextId,
              returnByValue: params.returnByValue,
              awaitPromise: params.awaitPromise
            }
          ])
          if (mode === 'exception')
            return { exceptionDetails: { exception: { description: 'boom' } } }
          if (mode === 'invalid') return { result: { value: { garbage: true } } }
          return { result: { value: await w.eval(params.expression) } }
        }
      }
    }
    let result, error
    try {
      result = await run({
        args: {
          action: 'paste',
          clipboardItems: items(mode === 'no-items' ? '' : 'new'),
          replaceInputValue: true
        },
        commandType: 'playwright_locator_fill',
        ctx,
        pageFunction:
          mode === 'fail'
            ? () => {
                throw Error('page failure')
              }
            : base.baselineClipboardPage,
        tabId: 3,
        target: { tabId: 3, sessionId: 'child' },
        executionContextId: 7
      })
    } catch (e: any) {
      error = e.message
    }
    const state = { result, error, value: element.value, calls }
    w.close()
    return state
  }
  for (const mode of ['success', 'exception', 'invalid', 'fail'])
    expect(await exercise(own, mode)).toEqual(await exercise(base.baselineClipboardAction, mode))
})
