// @vitest-environment node
import { test, expect } from 'vitest'
import { originalClient } from './original-client'
import { BrowserControls } from '../src/browser-controls'
import { TabControls } from '../src/tab-controls'
import { ConfirmDialog, PromptDialog } from '../src/dialogs'
import { AXAPI, CUAAPI, DomCUAAPI, TabClipboardAPI, TabDevAPI } from '../src/tab-apis'
import { PlaywrightAPI } from '../src/playwright'
import { PlaywrightLocator } from '../src/locator'
const candidates: Record<string, any> = {
  AXAPI,
  TabDevAPI,
  Browser: BrowserControls,
  Tab: TabControls,
  ConfirmDialog,
  PromptDialog,
  CUAAPI,
  DomCUAAPI,
  TabClipboardAPI,
  PlaywrightAPI,
  PlaywrightLocator
}
const cases = [
  {
    type: 'AXAPI',
    method: 'get',
    args: ['state', { disableDiffing: false }],
    mutate(_item: any, args: any[]) {
      args[1].disableDiffing = true
    }
  },
  {
    type: 'AXAPI',
    method: 'click',
    args: [1, { mouseButton: 'left', clickCount: 1 }],
    mutate(_item: any, args: any[]) {
      args[1].mouseButton = 'right'
      args[1].clickCount = 2
    }
  },
  {
    type: 'TabClipboardAPI',
    method: 'write',
    args: [[{ entries: [{ mimeType: 'text/plain', text: 'before' }] }]],
    mutate(_item: any, args: any[]) {
      args[0][0].entries[0].text = 'after'
    }
  },
  {
    type: 'TabDevAPI',
    method: 'logs',
    args: [{ filter: 'before', levels: ['warning'], limit: 1 }],
    mutate(_item: any, args: any[]) {
      args[0].filter = 'after'
      args[0].levels[0] = 'error'
      args[0].limit = 2
    }
  },
  {
    type: 'Browser',
    method: 'history',
    args: [{ queries: ['before'], limit: 1 }],
    mutate(item: any, args: any[]) {
      item.browserId = 'changed'
      args[0].queries[0] = 'after'
      args[0].limit = 2
    }
  },

  {
    type: 'Browser',
    method: 'documentation',
    args: [],
    mutate(item: any) {
      item.browserId = 'changed'
    }
  },
  {
    type: 'Browser',
    method: 'nameSession',
    args: ['session'],
    mutate(item: any) {
      item.browserId = 'changed'
    }
  },
  ...[
    'goto',
    'back',
    'forward',
    'reload',
    'close',
    'title',
    'url',
    'getJsDialog',
    'markHandoff',
    'markDeliverable',
    'requestManualHandoff'
  ].map((method) => ({
    type: 'Tab',
    method,
    args: method === 'goto' ? ['https://example.test'] : [],
    mutate(item: any) {
      item.id = 'changed'
    }
  })),
  {
    type: 'ConfirmDialog',
    method: 'dismiss',
    args: [],
    mutate(item: any) {
      item.dialogId = 'changed'
      item.browserId = 'changed'
    }
  },
  {
    type: 'PromptDialog',
    method: 'accept',
    args: ['text'],
    mutate(item: any) {
      item.dialogId = 'changed'
      item.tabId = 'changed'
    }
  },
  ...['click', 'double_click', 'scroll', 'move', 'type', 'keypress', 'drag'].map((method) => ({
    type: 'CUAAPI',
    method,
    args: [
      { x: 1, y: 2, scrollX: 3, scrollY: 4, text: 'before', keys: ['A'], path: [{ x: 1, y: 2 }] }
    ],
    mutate(_item: any, args: any[]) {
      Object.assign(args[0], { x: 10, y: 20, text: 'after', keys: ['B'], path: [{ x: 10, y: 20 }] })
    }
  })),
  {
    type: 'DomCUAAPI',
    method: 'keypress',
    args: [{ keys: ['A'] }],
    mutate(_item: any, args: any[]) {
      args[0].keys = ['B']
    }
  },
  {
    type: 'PlaywrightAPI',
    method: 'waitForURL',
    args: ['https://example.test', { timeoutMs: 100, waitUntil: 'before' }],
    mutate(_item: any, args: any[]) {
      args[1].timeoutMs = 200
      args[1].waitUntil = 'after'
    }
  },
  {
    type: 'PlaywrightAPI',
    method: 'waitForLoadState',
    args: [{ timeoutMs: 100, state: 'before' }],
    mutate(_item: any, args: any[]) {
      args[0].timeoutMs = 200
      args[0].state = 'after'
    }
  },
  {
    type: 'PlaywrightAPI',
    method: 'waitForEvent',
    args: ['filechooser', { timeoutMs: 100 }],
    mutate(_item: any, args: any[]) {
      args[1].timeoutMs = 200
    }
  },
  ...['click', 'dblclick', 'setChecked', 'pressSequentially'].map((method) => ({
    type: 'PlaywrightLocator',
    method,
    args:
      method === 'setChecked'
        ? [true, { force: false, timeoutMs: 100 }]
        : method === 'pressSequentially'
          ? ['text', { timeoutMs: 100 }]
          : [{ force: false, timeoutMs: 100 }],
    mutate(_item: any, args: any[]) {
      const opts = args.at(-1)
      opts.force = true
      opts.timeoutMs = 200
    }
  }))
]
for (const spec of cases)
  test(`${spec.type}.${spec.method} preserves send-accessor evaluation order`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any) {
      const args = structuredClone(spec.args),
        events: unknown[] = []
      let item: any
      const transport = {
        get send() {
          events.push('send')
          spec.mutate(item, args)
          return async (request: any) => {
            events.push({
              json: request.command.toJSON(),
              timeout: request.timeoutMs,
              ownTimeout: 'timeoutMs' in request
            })
            return {
              state: 'state',
              logs: [],
              items: [],
              title: 'title',
              url: 'url',
              dialog: null,
              file_chooser_id: 'chooser',
              is_multiple: false
            }
          }
        },
        async display() {}
      }
      item = new Type({
        browserId: 'b',
        tabId: 't',
        dialogId: 'dialog',
        selector: '#x',
        transport,
        tabPayload: { id: 't' }
      })
      await item[spec.method](...args)
      return events
    }
    expect(await exercise(candidates[spec.type])).toEqual(await exercise(baselineApi[spec.type]))
  })
test('Tab screenshot captures id before option getters and before send accessor', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(Type: any) {
    let item: any
    const calls: unknown[] = []
    const transport = {
      get send() {
        item.id = 'send'
        return async ({ command }: any) => {
          calls.push(command.toJSON())
          return { data: '' }
        }
      },
      async display() {}
    }
    item = new Type({ browserId: 'b', transport, tabPayload: { id: 't' } })
    await item.screenshot({
      get fullPage() {
        item.id = 'option'
        return true
      }
    })
    return calls
  }
  expect(await exercise(TabControls)).toEqual(await exercise(baselineApi.Tab))
})
test('page evaluate serializes user input at the original transport argument evaluation point', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(Type: any) {
    const arg = { value: 'before' },
      calls: unknown[] = []
    const transport = {
      get send() {
        arg.value = 'after'
        return async ({ command }: any) => {
          calls.push(command.toJSON())
          return { value: 1 }
        }
      },
      async display() {}
    }
    const page = new Type({ browserId: 'b', tabId: 't', transport })
    await page.evaluate((input: any) => input.value, arg)
    return calls
  }
  expect(await exercise(PlaywrightAPI)).toEqual(await exercise(baselineApi.PlaywrightAPI))
})
for (const method of ['elementInfo', 'elementScreenshot'])
  test(`page ${method} captures coordinates before send and reads optional flags afterwards`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any) {
      const point = { x: 1, y: 2, includeNonInteractable: false },
        calls: unknown[] = []
      const transport = {
        get send() {
          point.x = 10
          point.includeNonInteractable = true
          return async ({ command }: any) => {
            calls.push(command.toJSON())
            return { data: '' }
          }
        },
        async display() {}
      }
      const page = new Type({ browserId: 'b', tabId: 't', transport })
      await page[method](point)
      return calls
    }
    expect(await exercise(PlaywrightAPI)).toEqual(await exercise(baselineApi.PlaywrightAPI))
  })
for (const method of ['evaluate', 'evaluateAll'])
  test(`Locator ${method} observes input during transport argument construction`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any) {
      const arg = { value: 'before' },
        calls: unknown[] = []
      const transport = {
        get send() {
          arg.value = 'after'
          return async ({ command }: any) => {
            calls.push(command.toJSON())
            return { value: 1 }
          }
        },
        async display() {}
      }
      const locator = new Type({ browserId: 'b', tabId: 't', selector: '#x', transport })
      await locator[method]((_element: any, input: any) => input.value, arg)
      return calls
    }
    expect(await exercise(PlaywrightLocator)).toEqual(await exercise(baselineApi.PlaywrightLocator))
  })
