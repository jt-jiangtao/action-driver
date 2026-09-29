// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { selectorScopeFunctions } from '../../src/service-selector-scope'
import { playwrightInjectedSource } from '../../src/service-playwright-injected'
import { originalDocumentation } from '../original-service'
test('same-origin selector scopes retain frame parsing, capture indexes, visibility fallback and point transforms', async () => {
  const base = await originalDocumentation()
  function exercise(original: boolean, strict: boolean, hidden: boolean) {
    const dom = new JSDOM(
        '<body><iframe id="frame"></iframe><button class="duplicate">Visible</button><button class="duplicate" hidden>Hidden</button></body>',
        { runScripts: 'outside-only', pretendToBeVisual: true }
      ),
      w = dom.window
    const style = w.getComputedStyle.bind(w)
    w.getComputedStyle = (element) => style(element)
    w.eval(playwrightInjectedSource())
    const root = new (w as any).PlaywrightInjected.InjectedScript(w, {
      isUnderTest: false,
      sdkLanguage: 'javascript',
      testIdAttributeName: 'data-testid',
      stableRafCount: 1,
      browserName: 'chromium',
      customEngines: []
    })
    ;(w as any).__codexPlaywrightInjected = root
    const frame = w.document.querySelector('iframe')!
    frame.contentDocument!.body.innerHTML = '<button>Child</button>'
    const childStyle = frame.contentWindow!.getComputedStyle.bind(frame.contentWindow)
    frame.contentWindow!.getComputedStyle = (element) => childStyle(element)
    frame.getBoundingClientRect = () => ({
      x: 100,
      y: 60,
      left: 100,
      top: 60,
      right: 300,
      bottom: 160,
      width: 200,
      height: 100,
      toJSON: () => {}
    })
    for (const [key, value] of Object.entries({
      clientWidth: 90,
      clientHeight: 40,
      offsetWidth: 100,
      offsetHeight: 50,
      clientLeft: 5,
      clientTop: 2
    }))
      Object.defineProperty(frame, key, { value })
    frame.scrollIntoView = () => {}
    w.Element.prototype.getClientRects = function () {
      return [{ left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }] as any
    }
    frame.contentWindow!.Element.prototype.getClientRects = w.Element.prototype.getClientRects
    if (hidden) frame.style.visibility = 'hidden'
    const helpers = original
      ? base.baselineSelectorQueryPrelude + base.BaselinePlaywright.selectorScopeFunctions()
      : selectorScopeFunctions()
    let result, error
    try {
      result = w.eval(
        `(()=>{const __name=(fn)=>fn;${helpers};const injected=window.__codexPlaywrightInjected;const parsed=injected.parseSelector('iframe >> internal:control=enter-frame >> button');const scope=selectorScopeFor(injected,parsed,${strict});const sliced=sliceParsedSelector({...parsed,capture:2},2,3);const visible=querySelectorStrictWithVisibleFallback(injected,injected.parseSelector('.duplicate'),document,${strict});return {text:scope.injected.querySelectorAll(scope.parsed,scope.root).map(node=>node.textContent),chain:scope.frameChain.length,capture:sliced.capture,visible:visible.textContent,size:frameContentSize(document.querySelector('iframe')),point:scope.prepareFrameChainForPointerAction({x:10,y:15})};})()`
      )
    } catch (e: any) {
      error = e.message
    }
    dom.window.close()
    return { result, error }
  }
  for (const strict of [false, true])
    for (const hidden of [false, true])
      expect(exercise(false, strict, hidden)).toEqual(exercise(true, strict, hidden))
})
test('selector scopes reject non-frame targets and inaccessible frame windows', async () => {
  const base = await originalDocumentation()
  function exercise(original: boolean, missing: boolean) {
    const dom = new JSDOM(missing ? '<iframe></iframe>' : '<button></button>', {
        runScripts: 'outside-only'
      }),
      w = dom.window
    const style = w.getComputedStyle.bind(w)
    w.getComputedStyle = (element) => style(element)
    w.eval(playwrightInjectedSource())
    ;(w as any).__codexPlaywrightInjected = new (w as any).PlaywrightInjected.InjectedScript(w, {
      isUnderTest: false,
      sdkLanguage: 'javascript',
      testIdAttributeName: 'data-testid',
      stableRafCount: 1,
      browserName: 'chromium',
      customEngines: []
    })
    if (missing) {
      Object.defineProperty(w.document.querySelector('iframe'), 'contentWindow', {
        get: () => {
          throw Error('blocked')
        }
      })
    }
    let error
    try {
      w.eval(
        `(()=>{const __name=(fn)=>fn;${original ? base.baselineSelectorQueryPrelude + base.BaselinePlaywright.selectorScopeFunctions() : selectorScopeFunctions()};const injected=window.__codexPlaywrightInjected;return selectorScopeFor(injected,injected.parseSelector('${missing ? 'iframe' : 'button'} >> internal:control=enter-frame >> button'));})()`
      )
    } catch (e: any) {
      error = e.message
    }
    dom.window.close()
    return error
  }
  for (const missing of [false, true])
    expect(exercise(false, missing)).toEqual(exercise(true, missing))
})
