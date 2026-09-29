// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { originalDocumentation } from '../original-service'
const candidate = async () =>
  (await import('../../src/service-playwright-copy').catch(() => ({}))) as any
const protectedPolicy = {
  attributes: ['type', 'autocomplete', 'id', 'name', 'placeholder', 'aria-label', 'title'],
  pattern:
    'user[-_ ]?name|e[-_ ]?mail|one[-_ ]?time[-_ ]?code|password|passcode|passwd|\\botp\\b|\\b(?:2fa|mfa)\\b|phone|mobile|\\btel\\b'
}
test('virtual copy/cut uses selection, native clipboard events, credential protection and deferred cut token', async () => {
  const own = await candidate()
  expect(typeof own.copyOrCutPage).toBe('function')
  const base = await originalDocumentation()
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000002')
  async function exercise(page: any, commit: any, action: string, kind: string, cancel: boolean) {
    const dom = new JSDOM(
        `<body><input id="${kind === 'secret' ? 'password' : 'plain'}" type="text" value="sample"></body>`,
        { runScripts: 'outside-only' }
      ),
      w = dom.window,
      element = w.document.querySelector('input')!,
      events: string[] = []
    class Transfer {
      types: string[] = []
      files: any[] = []
      items = { add: (file: any) => this.files.push(file) }
      data = new Map<string, string>()
      clearData() {
        this.data.clear()
        this.types = []
      }
      setData(type: string, value: string) {
        this.data.set(type, value)
        this.types.push(type)
      }
      getData(type: string) {
        return this.data.get(type) ?? ''
      }
    }
    class ClipboardEvent extends w.Event {
      clipboardData: any
      constructor(type: string, options: any) {
        super(type, options)
        this.clipboardData = options.clipboardData
      }
    }
    Object.assign(w, { DataTransfer: Transfer, ClipboardEvent })
    element.addEventListener(action, (event) => {
      events.push(action)
      if (cancel) {
        event.preventDefault()
        ;(event as any).clipboardData.setData('text/plain', 'page override')
      }
    })
    element.addEventListener('beforeinput', () => events.push('beforeinput'))
    element.addEventListener('input', () => events.push('input'))
    element.focus()
    element.setSelectionRange(1, 4)
    let result, error
    try {
      result = await w.eval('(' + page.toString() + ')')({
        action,
        clipboardItems: [],
        protectedCredentialFieldPolicy: protectedPolicy,
        cutToken: 'cut-1'
      })
      if (action === 'cut' && result.cutToken)
        await w.eval('(' + commit.toString() + ')')({ cutToken: result.cutToken })
    } catch (e: any) {
      error = e.message
    }
    const state = { result, error, value: element.value, events }
    w.close()
    return state
  }
  try {
    for (const action of ['copy', 'cut'])
      for (const kind of ['plain', 'secret'])
        for (const cancel of [false, true])
          expect(
            await exercise(own.copyOrCutPage, own.commitVirtualCut, action, kind, cancel)
          ).toEqual(
            await exercise(base.baselineClipboardPage, base.baselineCommitCut, action, kind, cancel)
          )
  } finally {
    vi.restoreAllMocks()
  }
})
