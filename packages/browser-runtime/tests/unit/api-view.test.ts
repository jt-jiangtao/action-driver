// @vitest-environment node
import { test, expect } from 'vitest'
import * as candidate from '../../src/api-view'
import { originalClient } from '../original-client'
async function compare(
  run: (view: any, types: any) => Promise<unknown>,
  interfaces: any = { PlaywrightLocator: {} }
) {
  const { baselineApi, BaselineApiFactory } = await originalClient()
  const manifest = { interfaces }
  const originalView = new BaselineApiFactory({
    apiManifest: manifest,
    disabledMemberIds: new Set()
  }).view
  const expected = await run(originalView, baselineApi)
  const view = (candidate as any).createApiView(manifest, baselineApi)
  expect(await run(view, baselineApi)).toEqual(expected)
}
function locator(types: any) {
  return new types.PlaywrightLocator({
    browserId: 'b',
    tabId: 't',
    selector: 'button',
    transport: {
      async send() {
        return { count: 2 }
      },
      async display() {}
    }
  })
}
test('API view hides disabled methods consistently across get/has and retains bound method identity', async () => {
  await compare(async (view, types) => {
    const item = locator(types)
    const wrapped = view(item, new Set(['PlaywrightLocator.click']))
    return {
      hidden: wrapped.click,
      has: 'click' in wrapped,
      count: await wrapped.count(),
      methodSame: wrapped.count === wrapped.count,
      constructorSame: wrapped.constructor === item.constructor,
      instance: wrapped instanceof types.PlaywrightLocator
    }
  })
})
test('API view wraps returned instances and promise/array results with per-view identity caching', async () => {
  await compare(async (view, types) => {
    const item = locator(types),
      child = locator(types)
    item.child = child
    item.children = [child, child]
    item.result = async () => child
    const wrapped = view(item, new Set())
    const children = wrapped.children
    const result = await wrapped.result()
    const separatelyWrapped = view(item, new Set())
    return {
      same: [
        wrapped.child === wrapped.child,
        children[0] === children[1],
        children[0] === wrapped.child,
        result === wrapped.child
      ],
      distinctView: separatelyWrapped !== wrapped,
      original: wrapped !== item
    }
  })
})
test('API view unwraps arguments recursively while preserving nonplain objects and caller input', async () => {
  await compare(async (view, types) => {
    const item = locator(types),
      child = locator(types)
    const date = new Date(0)
    let received: any
    item.capture = (...args: any[]) => {
      received = args
      return child
    }
    const wrappedChild = view(child, new Set())
    const wrapped = view(item, new Set())
    const argument = { child: wrappedChild, nested: [wrappedChild, { child: wrappedChild }], date }
    const returned = wrapped.capture(argument, wrappedChild)
    return {
      unwrapped: [
        received[0].child === child,
        received[0].nested[0] === child,
        received[0].nested[1].child === child,
        received[1] === child
      ],
      dateSame: received[0].date === date,
      inputIntact: argument.child === wrappedChild,
      clone: received[0] !== argument,
      resultWrapped: returned !== child,
      alreadyWrapped: view(wrappedChild, new Set()) === wrappedChild
    }
  })
})
test('API view filters own keys and descriptors, wraps descriptor values and keeps symbols', async () => {
  await compare(async (view, types) => {
    const item = locator(types),
      child = locator(types),
      symbol = Symbol('visible')
    item.hidden = 1
    item.child = child
    item[symbol] = 3
    const wrapped = view(item, new Set(['PlaywrightLocator.hidden']))
    const descriptor = Object.getOwnPropertyDescriptor(wrapped, 'child')!
    return {
      keys: Reflect.ownKeys(wrapped).map(String),
      hidden: Object.getOwnPropertyDescriptor(wrapped, 'hidden'),
      symbol: wrapped[symbol],
      descriptor: {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable
      },
      wrappedValue: descriptor.value === wrapped.child,
      child: descriptor.value !== child
    }
  })
})
test('API view passes through primitives and unregistered objects, including plain result containers', async () => {
  await compare(async (view, types) => {
    const item = locator(types),
      plain = { child: item },
      date = new Date(0)
    const values = [null, undefined, 1, 'text', plain, date]
    const result = view(values, new Set())
    return {
      values: result.slice(0, 4),
      plainSame: result[4] === plain,
      dateSame: result[5] === date,
      arrayClone: result !== values
    }
  })
})
test('API view rejects manifest interfaces without a runtime constructor', async () => {
  const { baselineApi, BaselineApiFactory } = await originalClient()
  const errors = []
  for (const make of [
    () =>
      new BaselineApiFactory({
        apiManifest: { interfaces: { Missing: {} } },
        disabledMemberIds: new Set()
      }),
    () => (candidate as any).createApiView({ interfaces: { Missing: {} } }, baselineApi)
  ]) {
    try {
      make()
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  expect(errors).toEqual([
    'Browser API interface has no runtime type: Missing',
    'Browser API interface has no runtime type: Missing'
  ])
})

test('API view decorates each Tab view once after caching', async () => {
  const { baselineApi, BaselineApiFactory } = await originalClient()
  const results = []
  for (const baseline of [true, false]) {
    const manifest = { interfaces: { Tab: {} } }
    const decorated: any[] = []
    const decorateTab = (tab: any) => {
      decorated.push(tab)
      tab.decorated = true
    }
    const view = baseline
      ? new BaselineApiFactory({ apiManifest: manifest, decorateTab, disabledMemberIds: new Set() })
          .view
      : (candidate as any).createApiView(manifest, baselineApi, {
          tabType: baselineApi.Tab,
          decorateTab
        })
    const tab = new baselineApi.Tab({ browserId: 'b', tabPayload: { id: 't' }, transport: {} })
    const array = view([tab, tab], new Set())
    const another = view(tab, new Set())
    results.push({
      count: decorated.length,
      same: array[0] === array[1],
      decorated: array[0].decorated,
      distinct: another !== array[0]
    })
  }
  expect(results[1]).toEqual(results[0])
})
test('API view retains live disabled sets and propagates promise and method rejection', async () => {
  await compare(async (view, types) => {
    const item = locator(types),
      disabled = new Set()
    item.reject = () => Promise.reject(new Error('method failure'))
    const wrapped = view(item, disabled)
    const initial = typeof wrapped.count
    disabled.add('PlaywrightLocator.count')
    const hidden = wrapped.count
    const errors = []
    try {
      await wrapped.reject()
    } catch (e) {
      errors.push((e as Error).message)
    }
    try {
      await view(Promise.reject(new Error('promise failure')), disabled)
    } catch (e) {
      errors.push((e as Error).message)
    }
    return { initial, hidden, errors }
  })
})
test('browser member support overrides match original default platform filters without altering input', async () => {
  const { BaselineApiFactory } = await originalClient()
  const manifest = {
    interfaces: {
      Browser: {
        history: { unsupportedByDefaultIn: ['iab'] },
        nameSession: { unsupportedByDefaultIn: ['cdp'] }
      }
    }
  }
  for (const type of ['iab', 'cdp', 'extension']) {
    for (const override of [undefined, null, false, true]) {
      const disabled = new Set(['Browser.documentation'])
      const browserInfo = { id: 'b', type, apiSupportOverrides: { 'Browser.history': override } }
      const browser = new BaselineApiFactory({
        apiManifest: manifest,
        disabledMemberIds: disabled
      }).createBrowser({ browserInfo, transport: {} })
      const actual = (candidate as any).disabledMembersForBrowser(manifest, browserInfo, disabled)
      expect(
        ['history', 'nameSession', 'documentation'].map((name) => actual.has(`Browser.${name}`))
      ).toEqual(
        ['history', 'nameSession', 'documentation'].map((name) => browser[name] === undefined)
      )
      expect([...disabled]).toEqual(['Browser.documentation'])
    }
  }
})
