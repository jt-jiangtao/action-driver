// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'
import { prepareAuthCredentialBinding, prepareAuthManualSaveBinding } from '../../src/service-auth-native-preflight'

const fields = [
  { id: 'username', selector: '#username', type: 'text', label: 'Username', required: true,
    labelMetadata: { accessible_name: 'Username', autocomplete: 'username', input_type: 'text', input_mode: null, input_name: 'username' } },
  { id: 'password', selector: '#password', type: 'password', label: 'Password', required: true,
    labelMetadata: { accessible_name: 'Password', autocomplete: 'current-password', input_type: 'password', input_mode: null, input_name: 'password' } }
]
const params = { tab_id: '7', fields, submit: { action: 'click', selector: '#submit' } }
test('native credential binding requires trusted session, HTTPS same-frame form and username/password', async () => {
  const original = await originalDocumentation()
  for (const patch of [
    {}, { options: [] }, { qr_code: true }, { requestMeta: {} },
    { frameOrigin: 'https://other.example.com' }, { submittedOrigin: 'https://other.example.com' }
  ]) {
    async function exercise(run: Function) {
      const calls: any[] = []
      const input = { ...params, ...(patch.options === undefined ? {} : { options: patch.options }),
        ...(patch.qr_code === undefined ? {} : { qr_code: patch.qr_code }) }
      const ctx = {
        runtime: { requestMeta: { 'x-codex-turn-metadata': patch.requestMeta ?? { session_id: 'session-1' } } },
        playwright: { evaluateOnPlaywrightSelector: async (_tab: string, selector: string, _fn: Function, options: any) => {
          calls.push([selector, options])
          return { origin: patch.submittedOrigin ?? 'https://example.com', url: 'https://example.com/login' }
        } }
      }
      const result = await run(input, fields, 'https://example.com', patch.frameOrigin ?? 'https://example.com', ctx)
      return { result, calls }
    }
    expect(await exercise(prepareAuthCredentialBinding)).toEqual(
      await exercise(original.baselineAuthCredentialBinding)
    )
  }
})

test('ordinary manual-save version 10 requires reinspected fields and matching top-level HTTPS origin', async () => {
  const calls: string[] = []
  const base = {
    ...params,
    qr_code: false,
    options: undefined
  }
  const context = {
    runtime: { env: { BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION: '10' },
      requestMeta: { 'x-codex-turn-metadata': { session_id: 'session-1' } } },
    inspectFields: async () => fields,
    cdp: { call: async (_tab: number, method: string) => {
      calls.push(method)
      return method === 'Page.getFrameTree'
        ? { frameTree: { frame: { securityOrigin: 'https://example.com' } } }
        : { root: { nodeName: 'HTML' } }
    } }
  }
  expect(await prepareAuthManualSaveBinding(base, fields,
    [{ id: 'username', required: true }, { id: 'password', required: true }],
    'https://example.com', 'https://example.com', context)).toEqual({
    kind: 'ordinary', fields: { username: 'username', password: 'password' }, sessionId: 'session-1'
  })
  expect(calls).toEqual(['Page.getFrameTree', 'DOM.getDocument'])
  expect(await prepareAuthManualSaveBinding(base, fields,
    [{ id: 'username', required: true }, { id: 'password', required: true }],
    'https://example.com', 'https://other.example.com', context)).toBeUndefined()
})

test('private version 8 preflight requires contained page and isolated form match like original', async () => {
  const original = await originalDocumentation()
  async function exercise(run: Function) {
    const calls: string[] = []
    const context = {
      clientInfo: { type: 'cdp' },
      runtime: { env: { BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION: '8' },
        requestMeta: { 'x-codex-turn-metadata': { session_id: 'session-1' } } },
      inspectFields: async () => fields,
      playwright: {
        evaluateOnPlaywrightSelector: async (_tab: string, selector: string, _fn: Function, options: any) => {
          calls.push(options.arg.operation)
          if (options.arg.operation === 'browser-auth-submission-origin')
            return { origin: 'https://example.com', url: 'https://example.com/login' }
          if (options.arg.operation === 'browser-auth-field-label-metadata')
            return { ...fields.find((field) => field.selector === selector)!.labelMetadata, required: true }
          return true
        },
        evaluateOnPlaywrightSelectorAll: async () => 1,
        readElementState: async () => true,
        selectorsResolveToDistinctElements: async () => true
      },
      cdp: {
        browserAuthNewTargetCheck: async () => 'contained',
        call: async (_tab: number, method: string) => method === 'Page.getFrameTree'
          ? { frameTree: { frame: { id: 'frame', securityOrigin: 'https://example.com' } } }
          : method === 'Page.createIsolatedWorld' ? { executionContextId: 12 }
            : method === 'Runtime.evaluate' ? { result: { value: true } }
              : { root: { localName: 'html', children: [] } }
      }
    }
    const result = await run(params, fields,
      [{ id: 'username', required: true }, { id: 'password', required: true }],
      'https://example.com', 'https://example.com', context)
    return { result, calls }
  }
  expect(await exercise(prepareAuthManualSaveBinding)).toEqual(
    await exercise(original.baselineAuthManualSavePreflight))
})
