// @vitest-environment node
import { test, expect } from 'vitest'
import vm from 'node:vm'
import { installPageClipboardBridge } from '../src/service-clipboard-page'
import { originalDocumentation } from './original-service'
function environment(install: any, existing: boolean) {
  const requests: any[] = [],
    events = new Map<string, any>(),
    native = { readText: async () => 'native' },
    context: any = {
      navigator: existing ? { clipboard: native } : {},
      document: { querySelectorAll: () => [] },
      Blob,
      DOMException,
      atob,
      btoa,
      addEventListener: (name: string, run: any) => events.set(name, run),
      removeEventListener: (name: string) => events.delete(name),
      binding: (payload: string) => requests.push(JSON.parse(payload))
    }
  context.parent = context
  vm.createContext(context)
  vm.runInContext(`const __name=(target)=>target;(${install.toString()})('binding')`, context)
  return { context, requests, events, native }
}
test('page clipboard bridge virtualizes reads/writes and restores navigator on cleanup', async () => {
  const base = await originalDocumentation()
  for (const existing of [true, false]) {
    async function exercise(install: any) {
      const f = environment(install, existing),
        clip = f.context.navigator.clipboard,
        write = clip.writeText('text')
      await Promise.resolve()
      f.context.__browserUseClipboardBridge.respond(JSON.stringify({ id: 1, ok: true }))
      await write
      const read = clip.readText()
      f.context.__browserUseClipboardBridge.respond(
        JSON.stringify({
          id: 2,
          ok: true,
          items: [{ entries: [{ mime_type: 'text/plain', text: 'read' }] }]
        })
      )
      const text = await read
      f.context.__browserUseClipboardBridge.cleanup()
      return {
        requests: f.requests,
        text,
        restored: existing
          ? await f.context.navigator.clipboard.readText()
          : Object.hasOwn(f.context.navigator, 'clipboard'),
        bridge: f.context.__browserUseClipboardBridge,
        events: f.events.size
      }
    }
    expect(await exercise(installPageClipboardBridge)).toEqual(
      await exercise(base.baselineInstallClipboard)
    )
  }
})
test('clipboard page methods reject illegal invocation/missing arguments and pending cleanup', async () => {
  const base = await originalDocumentation()
  async function exercise(install: any) {
    const f = environment(install, false),
      clip = f.context.navigator.clipboard,
      errors = []
    for (const run of [() => clip.readText.call({}), () => clip.write(), () => clip.writeText()])
      try {
        await run()
      } catch (e: any) {
        errors.push(e.message)
      }
    const pending = clip.readText()
    f.context.__browserUseClipboardBridge.cleanup()
    try {
      await pending
    } catch (e: any) {
      errors.push(e.message)
    }
    return errors
  }
  expect(await exercise(installPageClipboardBridge)).toEqual(
    await exercise(base.baselineInstallClipboard)
  )
})
test('clipboard Blob conversion preserves binary MIME/text and fallback item getType errors', async () => {
  const base = await originalDocumentation()
  async function exercise(install: any) {
    const f = environment(install, false),
      clip = f.context.navigator.clipboard,
      write = clip.write([
        {
          types: ['text/plain', 'image/png'],
          presentationStyle: 'attachment',
          getType: async (type: string) =>
            type === 'text/plain' ? new Blob(['text']) : new Blob([Uint8Array.of(1, 2, 3)])
        }
      ])
    for (let i = 0; i < 15; i++) await Promise.resolve()
    f.context.__browserUseClipboardBridge.respond(JSON.stringify({ id: 1, ok: true }))
    await write
    const read = clip.read()
    f.context.__browserUseClipboardBridge.respond(
      JSON.stringify({ id: 2, ok: true, items: f.requests[0].items })
    )
    const items = await read
    let error
    try {
      await items[0].getType('missing')
    } catch (e: any) {
      error = { name: e.name, message: e.message }
    }
    return {
      requests: f.requests,
      types: items[0].types,
      style: items[0].presentationStyle,
      text: await (await items[0].getType('text/plain')).text(),
      binary: [...new Uint8Array(await (await items[0].getType('image/png')).arrayBuffer())],
      error
    }
  }
  expect(await exercise(installPageClipboardBridge)).toEqual(
    await exercise(base.baselineInstallClipboard)
  )
})
