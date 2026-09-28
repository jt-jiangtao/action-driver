// @vitest-environment node
import { test, expect } from 'vitest'
import { prepareBrowserAuthRequest } from '../src/browser-auth-request'
import { PlaywrightLocator } from '../src/locator'
import { originalClient } from './original-client'
async function compare(build: (Locator: any) => any) {
  const { baselineApi } = await originalClient()
  const commands: unknown[] = []
  const transport = {
    async send({ command }: any) {
      commands.push(command.toJSON())
      return { status: 'submitted' }
    },
    async display() {}
  }
  const makeLocator = (Type: any) =>
    class extends Type {
      constructor(options: any = {}) {
        super({ browserId: 'b', tabId: 't', selector: '#field', transport, ...options })
      }
    }
  const options = build(makeLocator(baselineApi.PlaywrightLocator))
  let expected: unknown
  try {
    const capability = new baselineApi.BrowserAuthTabCapability({
      browserId: 'b',
      tabId: 't',
      transport,
      documentation: {},
      info: {}
    })
    await capability.request(options)
    expected = { command: commands[0] }
  } catch (error) {
    expected = { error: (error as Error).message }
  }
  let actual: unknown
  try {
    actual = {
      command: {
        type: 'tab_browser_auth_handoff',
        ...prepareBrowserAuthRequest(build(makeLocator(PlaywrightLocator)), {
          browserId: 'b',
          tabId: 't'
        }),
        browser_id: 'b',
        tab_id: 't'
      }
    }
  } catch (error) {
    actual = { error: (error as Error).message }
  }
  expect(actual).toEqual(expected)
}
const field = (selector: any) => ({
  id: 'username',
  label: 'Username',
  type: 'text',
  required: true,
  selector
})
test('auth fields resolve own locator selectors and retain nullable autocomplete', async () => {
  await compare((Locator) => ({
    origin: 'https://example.test',
    fields: [
      { ...field(new Locator()), autocomplete: null },
      { ...field('#password'), id: 'password', type: 'password', autocomplete: 'current-password' }
    ],
    submit: { action: 'click', selector: new Locator({ selector: '#submit' }) }
  }))
})
test('auth options preserve labels and field ids while resolving option selectors', async () => {
  await compare((Locator) => ({
    origin: 'https://example.test',
    fields: [field('#username')],
    options: [
      { id: 'credentials', label: ' Credentials ', field_ids: ['username'] },
      { id: 'other', label: 'Other', selector: new Locator({ selector: '#other' }) }
    ]
  }))
})
test('QR auth requests include the literal true marker and omit null optional collections', async () => {
  await compare(() => ({
    origin: 'https://example.test',
    fields: [],
    qr_code: true,
    options: null,
    submit: null
  }))
})
test('false QR marker and undeclared getters are omitted without evaluating extra properties', async () => {
  await compare(() => ({
    origin: 'https://example.test',
    fields: [
      {
        ...field('#input'),
        get extra() {
          throw Error('extra field')
        }
      }
    ],
    qr_code: false,
    get extra() {
      throw Error('extra request')
    }
  }))
})
test('foreign browser and tab locator selectors fail before dispatch', async () => {
  for (const scope of [{ browserId: 'other' }, { tabId: 'other' }])
    await compare((Locator) => ({
      origin: 'https://example.test',
      fields: [field(new Locator(scope))]
    }))
})
test('plain locator lookalikes, null and boxed strings are rejected with original errors', async () => {
  for (const selector of [{ selector: '#x' }, null, new String('#x')])
    await compare(() => ({ origin: 'https://example.test', fields: [field(selector)] }))
})
test('submit and option selectors use the same tab-bound validation', async () => {
  await compare((Locator) => ({
    origin: 'https://example.test',
    fields: [field('#x')],
    submit: { action: 'click', selector: new Locator({ tabId: 'other' }) }
  }))
  await compare((Locator) => ({
    origin: 'https://example.test',
    fields: [field('#x')],
    options: [
      { id: 'one', label: 'One', selector: new Locator({ browserId: 'other' }) },
      { id: 'two', label: 'Two', selector: '#two' }
    ]
  }))
})
