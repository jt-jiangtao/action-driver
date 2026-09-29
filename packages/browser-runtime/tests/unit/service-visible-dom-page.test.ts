// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { visibleDomExpression } from '../../src/service-visible-dom-page'
import { originalDocumentation } from '../original-service'
test('serialized visible DOM preserves refs, attributes, redaction, reviewer mode and open shadow traversal', async () => {
  const base = await originalDocumentation()
  function exercise(
    expression: (...args: any[]) => string,
    reviewer: boolean,
    maxChars = 20000,
    maxElements = 200
  ) {
    const dom = new JSDOM(
      `<body><div id="codex-agent-overlay-root"><button>Overlay</button></div><button disabled title='A &amp; B'> Click <span>now</span></button><input name="password" value="secret"><input name="plain" value="visible"><textarea name="email">private</textarea><a href="/page">Link</a><p>Reviewer text</p><div role="switch" tabindex="0">Toggle</div><input type="hidden" value="hidden"><div id="host"></div><iframe src="https://frame.test"></iframe><button id="off">Offscreen</button><button id="transparent">Transparent</button></body>`,
      { runScripts: 'outside-only' }
    )
    const win = dom.window
    win.document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML =
      '<button checked>Shadow</button>'
    Object.defineProperty(win, 'innerWidth', { value: 500 })
    Object.defineProperty(win, 'innerHeight', { value: 400 })
    win.Element.prototype.getClientRects = function () {
      const x = this.id === 'off' ? 600 : 10
      return [{ left: x, right: x + 100, top: 10, bottom: 40, width: 100, height: 30 }] as any
    }
    win.getComputedStyle = ((node: any) => ({
      visibility: 'visible',
      display: 'block',
      pointerEvents: 'auto',
      opacity: node.id === 'transparent' ? '0' : '1'
    })) as any
    const run = () => win.eval(expression(maxChars, maxElements, undefined, reviewer))
    const first = run(),
      second = run()
    expect(second).toEqual(first)
    const state = (win as any)[
      reviewer ? '__browserUseReviewerVisibleDomState' : '__browserUseVisibleDomState'
    ]
    const refs = [...state.refToElement.keys()]
    dom.window.close()
    return { first, refs }
  }
  for (const reviewer of [false, true])
    for (const [chars, elements] of [
      [20000, 200],
      [80, 200],
      [20000, 2]
    ]) {
      const result = exercise(visibleDomExpression, reviewer, chars, elements)
      expect(result).toEqual(exercise(base.baselineVisibleDomExpression, reviewer, chars, elements))
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(JSON.stringify(result)).not.toContain('private')
      expect(JSON.stringify(result)).not.toContain('Overlay')
    }
})
test('visual viewport clipping and live form state match original', async () => {
  const base = await originalDocumentation()
  function exercise(expression: any) {
    const dom = new JSDOM(
        '<input type="checkbox" checked><select><option selected>First</option></select><textarea>Editable</textarea>',
        { runScripts: 'outside-only' }
      ),
      w = dom.window
    Object.defineProperty(w, 'visualViewport', {
      value: { offsetLeft: 30, offsetTop: 50, width: 100, height: 100 }
    })
    w.Element.prototype.getClientRects = function () {
      return [{ left: 50, right: 100, top: 60, bottom: 90, width: 50, height: 30 }] as any
    }
    w.getComputedStyle = (() => ({
      visibility: 'visible',
      display: 'block',
      pointerEvents: 'auto',
      opacity: '1'
    })) as any
    const checkbox = w.document.querySelector('input')!
    checkbox.checked = false
    checkbox.indeterminate = true
    const result = w.eval(
      expression(20000, 200, { left: 70, right: 90, top: 70, bottom: 80 }, false)
    )
    dom.window.close()
    return result
  }
  expect(exercise(visibleDomExpression)).toEqual(exercise(base.baselineVisibleDomExpression))
})
