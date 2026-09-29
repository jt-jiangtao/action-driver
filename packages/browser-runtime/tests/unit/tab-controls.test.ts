// @vitest-environment node
import { expect, test } from 'vitest'
import { TabControls } from '../../src/tab-controls'
import { originalClient } from '../original-client'
async function compare(run: (Ctor: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await run(TabControls)).toEqual(await run(baselineApi.Tab))
}
function fixture(
  Ctor: any,
  response: any = { data: 'AAH/', title: 'Title', url: 'https://example.com' }
) {
  const calls: any[] = []
  const transport = {
    async send(request: any) {
      calls.push(request.command.toJSON())
      return response
    },
    async display() {}
  }
  return { tab: new Ctor({ browserId: 'b', tabPayload: { id: 't' }, transport }), calls }
}
test('tab navigation, handoff and dynamic id use original command contracts', async () => {
  await compare(async (Ctor) => {
    const { tab, calls } = fixture(Ctor)
    const values = [
      await tab.goto('https://example.com'),
      await tab.back(),
      await tab.forward(),
      await tab.reload(),
      await tab.markHandoff(),
      await tab.markDeliverable(),
      await tab.requestManualHandoff(),
      await tab.title(),
      await tab.url()
    ]
    tab.id = 'changed'
    await tab.close()
    return { calls, values }
  })
})
test('tab screenshot maps crop and fullPage and rejects missing numeric clip fields', async () => {
  await compare(async (Ctor) => {
    const { tab, calls } = fixture(Ctor)
    const values = [
      await tab.screenshot(),
      await tab.screenshot({ fullPage: true, clip: { x: 0, y: 1, width: 2, height: 3 } }),
      await tab.screenshot({ clip: { x: NaN, y: Infinity, width: 2, height: 3 } })
    ]
    const errors = []
    try {
      await tab.screenshot({ clip: { x: 1 } })
    } catch (e) {
      errors.push((e as Error).message)
    }
    return { calls, values, errors }
  })
})
test('tab constructor and missing transport validation preserve error behavior', async () => {
  await compare(async (Ctor) => {
    const errors = []
    try {
      new Ctor({ browserId: 'b' })
    } catch (e) {
      errors.push((e as Error).message)
    }
    const { tab, calls } = fixture(Ctor)
    try {
      await tab.goto('')
    } catch (e) {
      errors.push((e as Error).message)
    }
    tab.id = ''
    try {
      await tab.goto('x')
    } catch (e) {
      errors.push((e as Error).message)
    }
    const unbound = new Ctor({ browserId: 'b', tabPayload: { id: 't' } })
    try {
      await unbound.back()
    } catch (e) {
      errors.push((e as Error).message)
    }
    return { calls, errors }
  })
})
test('tab dialogs create types, preserve public properties, accept and dismiss', async () => {
  for (const type of ['alert', 'beforeunload', 'confirm', 'prompt', 'unknown'])
    await compare(async (Ctor) => {
      const { tab, calls } = fixture(Ctor, { dialog: { id: 'dialog', type } })
      const dialog = await tab.getJsDialog()
      if (!dialog) return { calls }
      await dialog.dismiss()
      if (type === 'confirm') await dialog.accept()
      if (type === 'prompt') {
        await dialog.accept('')
        try {
          await dialog.accept(1)
        } catch (e) {
          return {
            calls,
            type: dialog.type,
            error: (e as Error).message,
            keys: Object.keys(dialog)
          }
        }
      }
      return {
        calls,
        type: dialog.type,
        keys: Object.keys(dialog),
        hasAccept: typeof dialog.accept === 'function'
      }
    })
})
test('tab missing dialog returns undefined', async () => {
  await compare(async (Ctor) => {
    const { tab, calls } = fixture(Ctor, { dialog: null })
    return { value: await tab.getJsDialog(), calls }
  })
})
