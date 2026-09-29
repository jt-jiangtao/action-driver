// @vitest-environment node
import { expect, test } from 'vitest'
import { CdpTabCapability } from '../../src/cdp-capability'
import { TabsControls, BrowserUserControls } from '../../src/tab-collections'
import { originalClient } from '../original-client'
function normalize(error: any) {
  return { name: error.name, message: error.message, issues: error.issues }
}
for (const timeoutMs of [undefined, 0, 10, -1])
  test(`CDP event timeout ${timeoutMs} matches original`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any) {
      const calls: unknown[] = []
      const capability = new Type({
        browserId: 'b',
        tabId: 't',
        documentation: {},
        info: { id: 'cdp' },
        transport: {
          async send(request: any) {
            calls.push({ json: request.command.toJSON(), timeout: request.timeoutMs })
            return {
              cursor: 1,
              events: [{ sequence: 1, source: { tabId: 1 }, method: 'x', extra: 1 }],
              hasMore: false,
              truncated: false,
              extra: 1
            }
          }
        }
      })
      return {
        value: await capability.readEvents({
          afterSequence: 0,
          methods: ['x'],
          limit: 3,
          target: { targetId: 'target' },
          timeoutMs
        }),
        calls
      }
    }
    expect(await exercise(CdpTabCapability)).toEqual(await exercise(baselineApi.CdpTabCapability))
  })
test('CDP events reject malformed responses with original issues', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(Type: any) {
    try {
      await new Type({
        browserId: 'b',
        tabId: 't',
        info: {},
        documentation: {},
        transport: {
          send: async () => ({ cursor: -1, events: [], hasMore: false, truncated: false })
        }
      }).readEvents()
    } catch (error) {
      return normalize(error)
    }
  }
  expect(await exercise(CdpTabCapability)).toEqual(await exercise(baselineApi.CdpTabCapability))
})
for (const opts of [
  { urls: [], contentType: 'text' },
  { urls: ['https://example.test'], contentType: 'domSnapshot', timeoutMs: 10 },
  { urls: [], contentType: 'invalid' },
  { urls: ['x'], contentType: 'html', timeoutMs: 0 }
])
  test(`tabs content ${JSON.stringify(opts)} matches original validation and dispatch`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any) {
      const calls: unknown[] = []
      const tabs = new Type({
        browserId: 'b',
        createTab: () => {},
        transport: {
          async send(req: any) {
            calls.push(req.command.toJSON())
            return { results: [{ url: 'x', title: null, content: 'hi', extra: 1 }] }
          }
        }
      })
      try {
        return { value: await tabs.content(opts), calls }
      } catch (error) {
        return { error: normalize(error), calls }
      }
    }
    expect(await exercise(TabsControls)).toEqual(await exercise(baselineApi.Tabs))
  })
for (const response of [
  {
    kind: 'document',
    dataBase64: 'YQ==',
    fileName: 'x',
    mimeType: 'text/plain',
    title: 't',
    url: 'x',
    extra: 1
  },
  { kind: 'text', text: 'hi', title: 't', truncated: false, url: 'x', extra: 1 },
  { kind: 'bad' },
  { kind: 'document', dataBase64: '***', fileName: 'x', mimeType: 'a', title: 't', url: 'x' }
])
  test(`user tab context ${response.kind} matches response validation and byte decoding`, async () => {
    const { baselineApi } = await originalClient()
    async function exercise(Type: any) {
      const calls: unknown[] = []
      const user = new Type({
        browserId: 'b',
        createTab: () => {},
        transport: {
          async send(req: any) {
            calls.push(req.command.toJSON())
            return response
          }
        }
      })
      try {
        return { value: await user.getTabContext({ id: 't' }), calls }
      } catch (error) {
        return { error: normalize(error), calls }
      }
    }
    expect(await exercise(BrowserUserControls)).toEqual(await exercise(baselineApi.BrowserUser))
  })
