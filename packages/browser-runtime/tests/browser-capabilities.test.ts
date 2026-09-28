// @vitest-environment node
import { expect, test } from 'vitest'
import {
  ManagementBrowserCapability,
  VisibilityBrowserCapability,
  ViewportBrowserCapability
} from '../src/browser-capabilities'
import {
  BrowserManagementCommands,
  BrowserVisibilityCommands,
  BrowserViewportCommands
} from '../src/commands/browser-capability'
import { originalClient } from './original-client'
const cases = [
  [
    'ManagementBrowserCapability',
    ManagementBrowserCapability,
    'getAuditTrail',
    [],
    { changes: [], extra: 1 }
  ],
  [
    'ManagementBrowserCapability',
    ManagementBrowserCapability,
    'invoke',
    ['tabs', 'update', 1, { active: true }],
    { value: { ok: true }, extra: 1 }
  ],
  [
    'VisibilityBrowserCapability',
    VisibilityBrowserCapability,
    'get',
    [],
    { visible: true, extra: 1 }
  ],
  ['VisibilityBrowserCapability', VisibilityBrowserCapability, 'set', [true], { extra: 1 }],
  [
    'ViewportBrowserCapability',
    ViewportBrowserCapability,
    'set',
    [{ width: 100, height: 200, browser_id: 'override' }],
    {}
  ],
  ['ViewportBrowserCapability', ViewportBrowserCapability, 'reset', [], {}]
] as const
for (const [name, own, method, args, result] of cases)
  test(`${name}.${method} command and result parity`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any, response: unknown) {
      const calls: unknown[] = []
      const cap = new Type({
        browserId: 'b',
        documentation: { get: async (x: string) => x },
        info: { id: 'cap', description: 'desc' },
        transport: {
          async send(req: any) {
            calls.push(req.command.toJSON())
            return response
          }
        }
      })
      try {
        return { calls, result: await cap[method](...args) }
      } catch (e: any) {
        return { calls, error: { issues: e.issues, message: e.message, name: e.name } }
      }
    }
    for (const response of [result, null, {}])
      expect(await exercise(own, response)).toEqual(await exercise(baselineApi[name], response))
  })
test('management namespace suppresses then/JSON/prototype/symbol members and forwards dynamic calls', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(Type: any) {
    const calls: unknown[] = []
    const cap = new Type({
      browserId: 'b',
      info: {},
      documentation: {},
      transport: {
        async send(req: any) {
          calls.push(req.command.toJSON())
          return { value: 7 }
        }
      }
    })
    const blocked = ['then', 'toJSON', 'constructor', '__proto__', 'toString', Symbol.iterator].map(
      (key) => cap.tabs[key]
    )
    await cap.tabs.update(1, { active: true })
    await cap.createNamespace('custom').method('x')
    return { blocked, calls, keys: Object.keys(cap) }
  }
  expect(await exercise(ManagementBrowserCapability)).toEqual(
    await exercise(baselineApi.ManagementBrowserCapability)
  )
})
test('browser capability schemas reject malformed payloads and audit nested results like original', async () => {
  const { baselineApi } = await originalClient()
  function parse(schema: any, value: any) {
    try {
      return schema.parse(value)
    } catch (e: any) {
      return { issues: e.issues, message: e.message }
    }
  }
  for (const [own, ref] of [
    [BrowserManagementCommands, baselineApi.BrowserManagementCommands],
    [BrowserVisibilityCommands, baselineApi.BrowserVisibilityCommands],
    [BrowserViewportCommands, baselineApi.BrowserViewportCommands]
  ])
    for (const key of Object.keys(own).filter((k) => k !== 'commands')) {
      const a = (own as any)[key],
        b = ref[key]
      expect(a.commandType).toBe(b.commandType)
      for (const value of [
        null,
        {},
        { browser_id: 'b', width: 0, height: 1, visible: 1 },
        { args: [], browser_id: 'b', method: 'x', namespace: 'tabs' }
      ])
        expect(parse(a.PayloadSchema, value)).toEqual(parse(b.PayloadSchema, value))
      for (const value of [
        null,
        {},
        {
          changes: [
            {
              args: [],
              method: 'x',
              namespace: 'tabs',
              before: {
                bookmarks: [{ id: '1', title: 't' }],
                tabLayout: { groups: [], tabs: [] },
                windows: []
              },
              createdAt: 1,
              result: { id: 'x' },
              extra: 1
            }
          ]
        }
      ])
        expect(parse(a.ResultSchema, value)).toEqual(parse(b.ResultSchema, value))
    }
})
