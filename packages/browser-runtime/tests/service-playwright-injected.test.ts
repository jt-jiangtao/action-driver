// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { playwrightInjectedSource, patchPlaywrightSource } from '../src/service-playwright-injected'
import { originalDocumentation } from './original-service'
test('pinned upstream helper plus credential patch matches original selector and ARIA behavior', async () => {
  const base = await originalDocumentation()
  function exercise(source: string) {
    const dom = new JSDOM(
        '<body><button>Continue</button><input aria-label="Password" value="secret"><input aria-label="Plain" value="visible"><textarea name="email">private</textarea><input type="checkbox" checked></body>',
        { runScripts: 'outside-only', pretendToBeVisual: true }
      ),
      w = dom.window
    w.Element.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 30,
      width: 100,
      height: 30,
      toJSON: () => {}
    })
    w.Element.prototype.getClientRects = function () {
      return [this.getBoundingClientRect()] as any
    }
    const computedStyle = w.getComputedStyle.bind(w)
    w.getComputedStyle = (element) => computedStyle(element)
    w.eval(source)
    const injected = new (w as any).PlaywrightInjected.InjectedScript(w, {
      isUnderTest: false,
      sdkLanguage: 'javascript',
      testIdAttributeName: 'data-testid',
      stableRafCount: 1,
      browserName: 'chromium',
      customEngines: []
    })
    const selector = injected.parseSelector('button'),
      result = {
        selectors: injected
          .querySelectorAll(selector, w.document)
          .map((node: any) => node.textContent),
        snapshot: injected.incrementalAriaSnapshot(w.document.body, { mode: 'ai' })
      }
    dom.window.close()
    return result
  }
  const own = exercise(playwrightInjectedSource()),
    original = exercise(base.baselineInjectedScriptSource)
  expect(own).toEqual(original)
  expect(JSON.stringify(own)).not.toContain('secret')
  expect(JSON.stringify(own)).not.toContain('private')
  expect(JSON.stringify(own)).toContain('<redacted>')
  expect(JSON.stringify(own)).toContain('visible')
})
test('upstream patch fails explicitly on missing or ambiguous patch point', () => {
  expect(() => patchPlaywrightSource('different source')).toThrow('patch point')
  expect(() =>
    patchPlaywrightSource('result.children = [element.value]; result.children = [element.value];')
  ).toThrow('patch point')
})
