// @vitest-environment node
import { afterEach, expect, test } from 'vitest'
import { decorateBrowserTab } from '../../src/tab-adapter'
import { originalTabDecorator } from '../original-computer-session'
const saved = Reflect.get(globalThis, 'nodeRepl')
afterEach(() => {
  if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
  else Reflect.set(globalThis, 'nodeRepl', saved)
})
function fixture(screenshot = true) {
  const calls: unknown[] = [],
    output: unknown[] = []
  const action =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return Promise.resolve()
    }
  const tab = {
    id: 'tab',
    extra: 'retained',
    ax: {
      get: async (mode: string, ...args: unknown[]) => {
        calls.push({ method: 'get', args: [mode, ...args] })
        return mode === 'state'
          ? 'state'
          : mode === 'screenshot'
            ? new Uint8Array([1, 2])
            : screenshot
              ? { state: 'state', screenshot: new Uint8Array([1, 2]) }
              : { state: 'state' }
      },
      paste: action('paste'),
      click: action('click'),
      drag: action('drag'),
      pressKey: action('pressKey'),
      scroll: action('scroll'),
      selectText: action('selectText'),
      setValue: action('setValue'),
      typeText: action('typeText'),
      performSecondaryAction: action('performSecondaryAction')
    }
  }
  const host = {
    write: (text: string, id: string) => {
      output.push({ text, id })
    },
    emitImage: (image: unknown) => {
      output.push(image)
    }
  }
  return { tab, host, calls, output }
}
test('tab observations/output and every action match baseline and preserve identity', async () => {
  const ref = await originalTabDecorator()
  async function run(reference: boolean) {
    const f = fixture()
    Reflect.set(globalThis, 'nodeRepl', f.host)
    const tab = reference ? ref(f.tab) : decorateBrowserTab(f.tab, () => f.host)
    expect(tab).toBe(f.tab)
    expect(tab.extra).toBe('retained')
    await tab.getAXState({ disableDiffing: true })
    await tab.getAXState({ emit: false })
    await tab.getScreenshot()
    await tab.getAXStateAndScreenshot({ disableDiffing: false })
    await tab.paste(null, 'text', { format: 'html' })
    await tab.click([1, 2], { clickCount: 2 })
    await tab.drag([1, 2], [3, 4])
    await tab.pressKey(1, 'CMD+A')
    await tab.scroll(1, 'down', 2)
    await tab.selectText(1, 'text', { prefix: 'p', suffix: 's', selectionType: 'all' })
    await tab.setValue(1, 'value')
    await tab.typeText(null, 'typed')
    await tab.performSecondaryAction(1, 'open')
    return { calls: f.calls, output: f.output }
  }
  expect(await run(false)).toEqual(await run(true))
})
test('browser focus input accepts null and rejects invalid element indices before dispatch', async () => {
  const f = fixture(),
    tab = decorateBrowserTab(f.tab, () => f.host)
  for (const index of [-1, 1.5, undefined, NaN, Infinity]) {
    await expect(tab.paste(index as never, 'text')).rejects.toThrow(
      'Browser input requires an element index'
    )
    expect(() => tab.pressKey(index as never, 'A')).toThrow('Browser input requires')
    expect(() => tab.typeText(index as never, 'text')).toThrow('Browser input requires')
  }
  expect(f.calls).toEqual([])
  await tab.paste(0, 'text')
  await tab.pressKey(null, 'A')
  await tab.typeText(0, 'text')
})
test('emit false suppresses images/state and missing combined screenshot emits state alone', async () => {
  const f = fixture(false),
    tab = decorateBrowserTab(f.tab, () => f.host)
  expect(await tab.getAXStateAndScreenshot({ emit: false })).toEqual({ state: 'state' })
  await tab.getScreenshot({ emit: false })
  expect(f.output).toEqual([])
  expect(await tab.getAXStateAndScreenshot()).toEqual({ state: 'state' })
  expect(f.output).toEqual([{ text: 'state', id: 'cua.state' }])
})

test('default tab decorator does not use an ambient private output host', async () => {
  const f = fixture()
  Reflect.set(globalThis, 'nodeRepl', f.host)
  const tab = decorateBrowserTab(f.tab)
  expect(await tab.getAXState()).toBe('state')
  expect(f.output).toEqual([])
})
