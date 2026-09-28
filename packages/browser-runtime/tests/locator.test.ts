// @vitest-environment node
import { expect, test } from 'vitest'
import { PlaywrightLocator, PlaywrightFrameLocator, PlaywrightDownload } from '../src/locator'
import { originalClient } from './original-client'

async function compare(exercise: (api: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await exercise({ PlaywrightLocator, PlaywrightFrameLocator, PlaywrightDownload })).toEqual(
    await exercise(baselineApi)
  )
}
function fixture(api: any) {
  const calls: unknown[] = []
  const transport = {
    async send({ command, timeoutMs }: any) {
      const json = command.toJSON()
      calls.push({ json, timeoutMs })
      if (json.type.endsWith('_count')) return { count: 2 }
      if (json.type.endsWith('_read_all'))
        return {
          values: [{ text_content: 'one', inner_text: 'One', attributes: { id: 'a' } }, null]
        }
      if (json.type.endsWith('_all_text_contents')) return { values: ['a', 'b'] }
      if (json.type.endsWith('_path')) return { path: '/tmp/file' }
      return { value: 'fallback' }
    },
    async display() {}
  }
  const make = (selector = 'div', tabId = 't') =>
    new api.PlaywrightLocator({ browserId: 'b', tabId, selector, transport })
  return { calls, transport, make }
}
test('composed selectors preserve escaping, exact flags, regex flags and scope', async () => {
  await compare(async (api) => {
    const { calls, make } = fixture(api)
    const root = make()
    for (const text of ['a"\\\n', /a["'`]>>b/g, /a>>b/u]) {
      await root.getByText(text, { exact: true }).count()
      await root.getByLabel(text).count()
      await root.getByPlaceholder(text).count()
      await root.getByRole('button', { name: text, exact: true }).count()
    }
    await root.getByTestId('a"\\').first().last().nth(1).count()
    await root
      .locator('span', {
        hasText: 'yes',
        hasNotText: /no/i,
        has: make('a'),
        hasNot: make('b'),
        visible: false
      })
      .count()
    await root.and(make('x')).or(make('y')).count()
    return calls
  })
})
test('invalid locator composition rejects wrong types and different tabs like original', async () => {
  await compare(async (api) => {
    const { make } = fixture(api),
      root = make(),
      messages = []
    const cases = [
      () => root.locator(''),
      () => root.nth('1'),
      () => root.and({}),
      () => root.or(make('x', 'other')),
      () => root.filter({ has: make('x', 'other') }),
      () => root.filter({ visible: 1 }),
      () => root.getByText(1),
      () => root.getByLabel({}),
      () => root.getByPlaceholder(null),
      () => root.getByRole(''),
      () => root.getByTestId('')
    ]
    for (const action of cases) {
      try {
        action()
      } catch (error) {
        messages.push((error as Error).message)
      }
    }
    return messages
  })
})
test('direct reads preserve command fields, timeout and response projections', async () => {
  await compare(async (api) => {
    const { calls, make } = fixture(api),
      root = make()
    const values = [
      await root.textContent({ timeoutMs: 20 }),
      await root.innerText(),
      await root.getAttribute('id'),
      await root.isVisible(),
      await root.isEnabled(),
      await root.allTextContents({ timeoutMs: 10 })
    ]
    let error
    try {
      await root.getAttribute('')
    } catch (e) {
      error = (e as Error).message
    }
    return { calls, values, error }
  })
})
test('all collection shares reads, preserves scoped composition and falls back for missing entries', async () => {
  await compare(async (api) => {
    const { calls, make } = fixture(api),
      [one, two] = await make().all()
    const values = [
      await one.textContent({ timeoutMs: 10 }),
      await one.innerText(),
      await one.getAttribute('id'),
      await one.getAttribute('toString'),
      await two.textContent(),
      await one.locator('span').innerText(),
      await one.first().innerText(),
      await one.filter({ hasText: 'x' }).innerText()
    ]
    return { calls, values }
  })
})
test('failed collection read is evicted so next read retries', async () => {
  await compare(async (api) => {
    const { calls, make, transport } = fixture(api),
      send = transport.send
    let first = true
    transport.send = async (request) => {
      if (request.command.toJSON().type.endsWith('_read_all') && first) {
        first = false
        throw new Error('offline')
      }
      return send(request)
    }
    const [one] = await make().all()
    let error
    try {
      await one.innerText()
    } catch (e) {
      error = (e as Error).message
    }
    return { error, value: await one.innerText(), calls }
  })
})
test('nested frame locators and query methods produce frame-scoped commands', async () => {
  await compare(async (api) => {
    const { calls, transport } = fixture(api)
    const frame = new api.PlaywrightFrameLocator({
      browserId: 'b',
      tabId: 't',
      frameSelector: 'iframe',
      transport
    }).frameLocator('#inner')
    await frame.locator('a').count()
    await frame.getByText('go').count()
    await frame.getByLabel('name').count()
    await frame.getByPlaceholder('email').count()
    await frame.getByRole('button').count()
    await frame.getByTestId('ok').count()
    const errors = []
    for (const action of [() => frame.locator(''), () => frame.frameLocator('')]) {
      try {
        action()
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { calls, errors }
  })
})
test('download path forwards timeout and maps absent path to null', async () => {
  await compare(async (api) => {
    const { calls, transport } = fixture(api)
    const download = new api.PlaywrightDownload({
      browserId: 'b',
      tabId: 't',
      downloadId: 'd',
      transport
    })
    const value = await download.path({ timeoutMs: 50 })
    transport.send = async () => ({})
    return { value, missing: await download.path(), calls }
  })
})

test('read requests preserve presence of optional timeout properties', async () => {
  await compare(async (api) => {
    const keys: string[][] = []
    const transport = {
      async send(request: any) {
        keys.push(Object.keys(request))
        return { value: 'a', count: 0 }
      },
      async display() {}
    }
    const locator = new api.PlaywrightLocator({
      browserId: 'b',
      tabId: 't',
      selector: 'a',
      transport
    })
    await locator.count()
    await locator.textContent()
    await locator.innerText()
    await locator.getAttribute('id')
    await locator.isVisible()
    await locator.isEnabled()
    await locator.allTextContents()
    const download = new api.PlaywrightDownload({
      browserId: 'b',
      tabId: 't',
      downloadId: 'd',
      transport
    })
    await download.path()
    return keys
  })
})
test('locator evaluation serializes functions and JSON arguments, with all-elements mode', async () => {
  await compare(async (api) => {
    const { calls, make } = fixture(api),
      root = make()
    const values = [
      await root.evaluate('arg.x', { x: 1 }, { timeoutMs: 30 }),
      await root.evaluate((element: unknown, arg: unknown) => ({ element, arg }), [1, null]),
      await root.evaluateAll((elements: unknown, arg: unknown) => ({ elements, arg })),
      await root.evaluateAll('elements.length', undefined, { timeoutMs: 40 })
    ]
    const errors = []
    const circular: any = {}
    circular.self = circular
    for (const [fn, arg] of [
      ['', undefined],
      [1, undefined],
      ['1', () => 1],
      ['1', Symbol('x')],
      ['1', circular],
      ['1', 1n]
    ]) {
      try {
        await root.evaluate(fn, arg)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    try {
      await root.evaluateAll('', undefined)
    } catch (e) {
      errors.push((e as Error).message)
    }
    return { calls, values, errors }
  })
})
test('evaluate wraps serializer errors even if they match its validation message', async () => {
  await compare(async (api) => {
    const { make } = fixture(api)
    try {
      await make().evaluate('arg', {
        toJSON() {
          throw new Error('playwright.evaluate arg must be JSON-serializable')
        }
      })
    } catch (error) {
      return (error as Error).message
    }
  })
})
test('concurrent collection reads share one pending request and retain relative query cache', async () => {
  await compare(async (api) => {
    const { calls, make } = fixture(api),
      [one, two] = await make().all()
    const values = await Promise.all([one.textContent(), one.innerText(), two.innerText()])
    await one.getByText('child').innerText()
    await one.getByText('child').getAttribute('id')
    await one.getByText('child').filter({ visible: true }).innerText()
    return { calls, values }
  })
})
test('locator, frame and download keep scope and cache state private at runtime', async () => {
  await compare(async (api) => {
    const { make, transport } = fixture(api)
    return [
      make(),
      new api.PlaywrightFrameLocator({
        browserId: 'b',
        tabId: 't',
        frameSelector: 'iframe',
        transport
      }),
      new api.PlaywrightDownload({ browserId: 'b', tabId: 't', downloadId: 'd', transport })
    ].map((value) => Reflect.ownKeys(value))
  })
})
test('locator read and compatibility helpers preserve their public contracts', async () => {
  await compare(async (api) => {
    const { make } = fixture(api),
      root = make(),
      [one] = await root.all()
    const value = await one.cachedRead(10),
      empty = await root.cachedRead()
    root.assertCompatibleLocator(make(), 'custom')
    const errors = []
    for (const other of [{}, make('x', 'other')]) {
      try {
        root.assertCompatibleLocator(other, 'custom')
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { value, empty, errors, details: api.PlaywrightLocator.browserAuthSelector(root) }
  })
})
