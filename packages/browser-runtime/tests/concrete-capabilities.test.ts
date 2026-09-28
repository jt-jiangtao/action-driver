// @vitest-environment node
import { expect, test } from 'vitest'
import {
  BotDetectionTabCapability,
  BrowserAuthTabCapability,
  PageAssetsTabCapability,
  TabWebMcpCapability
} from '../src/tab-capabilities'
import { originalClient } from './original-client'
const candidates = {
  BotDetectionTabCapability,
  BrowserAuthTabCapability,
  PageAssetsTabCapability,
  TabWebMcpCapability
}
const rows = [
  [
    'BotDetectionTabCapability',
    'report',
    [{ reason: 'captcha_failed', extra: 1 }],
    { status: 'reported', hostname: null, extra: 1 }
  ],
  ['BotDetectionTabCapability', 'report', [{ reason: 'bad' }], {}],
  ['BotDetectionTabCapability', 'report', [{ reason: 'access_denied' }], { status: 'bad' }],
  [
    'BrowserAuthTabCapability',
    'request',
    [{ origin: 'x', fields: [], qr_code: true }],
    { status: 'submitted', extra: 1 }
  ],
  ['BrowserAuthTabCapability', 'request', [{ origin: 'x', fields: [] }], {}],
  [
    'BrowserAuthTabCapability',
    'request',
    [{ origin: 'x', fields: [], qr_code: true }],
    { status: 'bad' }
  ],
  [
    'PageAssetsTabCapability',
    'list',
    [],
    {
      assets: [],
      id: 'i',
      inlineSvgs: [],
      pageUrl: null,
      summary: { byKind: {}, inlineSvgCount: 0, totalCount: 0 }
    }
  ],
  ['PageAssetsTabCapability', 'list', [], {}],
  [
    'PageAssetsTabCapability',
    'bundle',
    [{ inventoryId: 'i', kinds: ['image'], extra: 1 }],
    {
      assets: [],
      directoryPath: 'd',
      failures: [],
      manifestPath: 'm',
      summary: { downloadedCount: 0, elapsedMs: 0, failedCount: 0, requestedCount: 0 }
    }
  ],
  ['TabWebMcpCapability', 'fetchTools', [], { tools: [] }],
  [
    'TabWebMcpCapability',
    'fetchTools',
    [],
    { tools: [{ name: 'x', call_name: 'alias', registration_id: 'r', input_schema: {}, extra: 1 }] }
  ],
  ['TabWebMcpCapability', 'fetchTools', [], { tools: [{ name: 1 }] }]
] as const
for (const [name, method, args, response] of rows)
  test(`${name}.${method} ${JSON.stringify(response)} original lifecycle`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any) {
      const calls: unknown[] = []
      const capability = new Type({
        browserId: 'b',
        tabId: 't',
        info: { id: 'cap', description: 'desc' },
        documentation: { get: async (x: string) => x },
        transport: {
          async send(req: any) {
            calls.push({ json: req.command.toJSON(), parsed: req.command.parse() })
            return structuredClone(response)
          }
        }
      })
      try {
        const result = await capability[method](...args)
        return {
          calls,
          value:
            method === 'fetchTools'
              ? { description: result.description(), frozen: Object.isFrozen(result) }
              : result
        }
      } catch (e: any) {
        return { calls, error: { name: e.name, message: e.message, issues: e.issues } }
      }
    }
    expect(await exercise(candidates[name])).toEqual(await exercise(baselineApi[name]))
  })
