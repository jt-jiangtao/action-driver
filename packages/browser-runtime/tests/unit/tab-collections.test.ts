// @vitest-environment node
import { test, expect } from 'vitest'
import { TabsControls, BrowserUserControls } from '../../src/tab-collections'
import { originalClient } from '../original-client'
async function compare(run: (api: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await run({ Tabs: TabsControls, BrowserUser: BrowserUserControls })).toEqual(
    await run(baselineApi)
  )
}
function fixture() {
  const calls: any[] = [],
    created: any[] = []
  let response: any = { id: 't', tabs: [{ id: 'one' }] }
  const transport = {
    async send(request: any) {
      calls.push(request.command.toJSON())
      return response
    },
    async display() {}
  }
  return {
    calls,
    created,
    options: {
      browserId: 'b',
      transport,
      createTab: (payload: any) => {
        created.push(payload)
        return { id: payload.id }
      }
    },
    setResponse: (value: any) => {
      response = value
    }
  }
}
test('tab collections forward commands and create selected/new/get tabs without cloning payloads', async () => {
  await compare(async (api) => {
    const { calls, created, options, setResponse } = fixture(),
      tabs = new api.Tabs(options)
    const values = [
      await tabs.new(),
      await tabs.selected(),
      await tabs.get('id'),
      await tabs.list()
    ]
    setResponse({ id: '' })
    values.push(await tabs.selected())
    let error
    try {
      await tabs.get('')
    } catch (e) {
      error = (e as Error).message
    }
    return { calls, created, values, error, keys: Reflect.ownKeys(tabs) }
  })
})
test('user tabs and claim validation preserve empty object ids and original factory data', async () => {
  await compare(async (api) => {
    const { calls, created, options } = fixture(),
      user = new api.BrowserUser(options)
    const values = [
        await user.openTabs(),
        await user.claimTab('t'),
        await user.claimTab({ id: 'one' }),
        await user.claimTab({ id: '' })
      ],
      errors = []
    for (const value of ['', null, 1, {}, { id: 1 }]) {
      try {
        await user.claimTab(value)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { calls, created, values, errors, keys: Reflect.ownKeys(user) }
  })
})
test('tab factory failure propagates and unknown constructor fields are not read', async () => {
  await compare(async (api) => {
    const { options, calls } = fixture()
    options.createTab = () => {
      throw new Error('factory failed')
    }
    Object.defineProperty(options, 'unrelated', {
      enumerable: true,
      get() {
        throw new Error('unrelated getter')
      }
    })
    const errors = []
    for (const [name, action] of [
      ['Tabs', 'new'],
      ['BrowserUser', 'claimTab']
    ]) {
      try {
        await new api[name](options)[action]('t')
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { calls, errors }
  })
})

test('async tab factories resolve values and propagate rejection across both collections', async () => {
  await compare(async (api) => {
    const { options, calls } = fixture()
    const asyncOptions = { ...options, createTab: async (payload: any) => ({ id: payload.id }) }
    const tabs = new api.Tabs(asyncOptions)
    const user = new api.BrowserUser(asyncOptions)
    const values = [await tabs.new(), await tabs.selected(), await tabs.get('t'), await user.claimTab('t')]
    const errors = []
    const rejectedOptions = { ...options, createTab: async () => { throw new Error('async factory failed') } }
    for (const [name, action] of [['Tabs', 'new'], ['BrowserUser', 'claimTab']]) {
      try { await new api[name](rejectedOptions)[action]('t') }
      catch (e) { errors.push((e as Error).message) }
    }
    return { values, errors, calls }
  })
})
