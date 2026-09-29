// @vitest-environment node
import { test, expect } from 'vitest'
import { PlaywrightAPI, PlaywrightFileChooser } from '../../src/playwright'
import { originalClient } from '../original-client'
async function compare(run: (api: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await run({ PlaywrightAPI, PlaywrightFileChooser })).toEqual(await run(baselineApi))
}
function fixture(api: any) {
  const calls: any[] = []
  const transport = {
    async send(request: any) {
      const json = request.command.toJSON()
      calls.push({ json, keys: Object.keys(request), timeoutMs: request.timeoutMs })
      return {
        value: 'ok',
        download_id: 'd',
        file_chooser_id: 'f',
        is_multiple: true,
        data: 'AAH/',
        dom_snapshot: 'dom',
        path: '/tmp/a'
      }
    },
    async display() {}
  }
  const page = new api.PlaywrightAPI({ browserId: 'b', tabId: 't', transport })
  return { page, calls, transport }
}
test('page navigation, selectors, scripts and waits match command contracts', async () => {
  await compare(async (api) => {
    const { page, calls } = fixture(api)
    await page.goBack()
    await page.goForward()
    const values = [
      await page.evaluate('arg', { x: 1 }, { timeoutMs: 5 }),
      await page.evaluate((arg: unknown) => arg)
    ]
    await page.locator('div').count()
    await page.getByRole('button', { name: 'go' }).count()
    await page.getByText('x').count()
    await page.getByLabel('x').count()
    await page.getByPlaceholder('x').count()
    await page.getByTestId('x').count()
    await page.frameLocator('iframe').locator('a').count()
    await page.waitForURL('https://example.com', { waitUntil: 'commit', timeoutMs: 50 })
    await page.waitForLoadState()
    await page.waitForLoadState({ state: 'domcontentloaded', timeoutMs: 30 })
    await page.waitForTimeout(0)
    await page.waitForTimeout(5)
    return { calls, values }
  })
})
test('page validates selectors, waits, coordinates and evaluation before sending', async () => {
  await compare(async (api) => {
    const { page, calls } = fixture(api),
      errors = []
    for (const action of [
      () => page.locator(''),
      () => page.frameLocator(''),
      () => page.waitForURL(''),
      () => page.waitForTimeout(-1),
      () => page.waitForTimeout(1.1),
      () => page.waitForTimeout(NaN),
      () => page.elementInfo({ x: Infinity, y: 0 }),
      () => page.elementScreenshot({ x: 1, y: '2' }),
      () => page.evaluate(''),
      () => page.evaluate(1)
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
test('page observations decode bytes and preserve info and DOM payloads', async () => {
  await compare(async (api) => {
    const { page, calls } = fixture(api)
    return {
      info: await page.elementInfo({ x: 1, y: 2, includeNonInteractable: true }),
      bytes: await page.elementScreenshot({ x: 0, y: 0 }),
      dom: await page.domSnapshot(),
      calls
    }
  })
})
test('events produce scoped downloads and file choosers with defaults and file validation', async () => {
  await compare(async (api) => {
    const { page, calls } = fixture(api),
      download = await page.waitForEvent('download'),
      chooser = await page.waitForEvent('filechooser', { timeoutMs: 50 })
    const path = await download.path()
    await chooser.setFiles('one')
    await chooser.setFiles(['a', 'b'], { timeoutMs: 20 })
    await page.waitForEvent('download', { timeoutMs: 10 })
    const errors = []
    for (const action of [
      () => page.waitForEvent('click'),
      () => chooser.setFiles(null),
      () => chooser.setFiles([])
    ]) {
      try {
        await action()
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { path, multiple: chooser.isMultiple(), calls, errors }
  })
})
test('file chooser wraps backend failure with action context', async () => {
  await compare(async (api) => {
    const { transport } = fixture(api)
    transport.send = async () => {
      throw new Error('denied')
    }
    const chooser = new api.PlaywrightFileChooser({
      browserId: 'b',
      tabId: 't',
      fileChooserId: 'f',
      isMultiple: false,
      transport
    })
    try {
      await chooser.setFiles('a')
    } catch (e) {
      return { message: (e as Error).message, multiple: chooser.isMultiple() }
    }
  })
})
test('expectNavigation starts waiting before action, returns action result and propagates rejection', async () => {
  await compare(async (api) => {
    const { page, calls } = fixture(api),
      order: string[] = []
    const result = await page.expectNavigation(
      () => {
        order.push('action')
        return 42
      },
      { url: 'https://example.com', waitUntil: 'load' }
    )
    let error
    try {
      await page.expectNavigation(
        () => {
          throw new Error('action failed')
        },
        { waitUntil: 'commit' }
      )
    } catch (e) {
      error = (e as Error).message
    }
    return { result, error, calls, order }
  })
})
test('page and file chooser keep transport state private at runtime', async () => {
  await compare(async (api) => {
    const { page, transport } = fixture(api)
    const chooser = new api.PlaywrightFileChooser({
      browserId: 'b',
      tabId: 't',
      fileChooserId: 'f',
      isMultiple: true,
      transport
    })
    return [Reflect.ownKeys(page), Reflect.ownKeys(chooser)]
  })
})
test('navigation wait starts before action and completion waits for both promises', async () => {
  await compare(async (api) => {
    const order: string[] = []
    let finish!: () => void
    const transport = {
      async send() {
        order.push('wait')
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        order.push('wait done')
        return {}
      },
      async display() {}
    }
    const page = new api.PlaywrightAPI({ browserId: 'b', tabId: 't', transport })
    let complete = false
    const pending = page
      .expectNavigation(() => {
        order.push('action')
        return 'result'
      })
      .then((value: string) => {
        complete = true
        return value
      })
    await Promise.resolve()
    await Promise.resolve()
    const before = complete
    finish()
    const value = await pending
    return { order, before, complete, value }
  })
})
test('event rejection remains observable after the initiating action has yielded', async () => {
  await compare(async (api) => {
    const transport = {
      async send() {
        throw new Error('disconnected')
      },
      async display() {}
    }
    const page = new api.PlaywrightAPI({ browserId: 'b', tabId: 't', transport })
    const pending = page.waitForEvent('download')
    await new Promise((resolve) => setImmediate(resolve))
    try {
      await pending
    } catch (error) {
      return (error as Error).message
    }
  })
})
