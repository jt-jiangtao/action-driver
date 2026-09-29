// @vitest-environment node
import { expect, test } from 'vitest'
import * as candidate from '../../src/capabilities'
import { originalClient } from '../original-client'
async function compare(run: (api: any) => Promise<unknown>) {
  const original = await originalClient()
  const baseline = {
    Capabilities: original.BaselineCapabilities,
    BrowserCapability: original.BaselineBrowserCapability,
    TabCapability: original.BaselineTabCapability,
    browserRegistration: original.baselineBrowserRegistration,
    tabRegistration: original.baselineTabRegistration
  }
  const expected = await run(baseline)
  expect(await run(candidate)).toEqual(expected)
}
test('capability bases preserve public references and route documentation by current info id', async () => {
  await compare(async (api) => {
    const calls: string[] = []
    const documentation = {
      async get(path: string) {
        calls.push(path)
        return path
      }
    }
    const transport = {}
    const info = { id: 'one', description: 'description' }
    const browser = new api.BrowserCapability(transport, 'b', documentation, info)
    const tab = new api.TabCapability(transport, 'b', 't', documentation, info)
    const values = [await browser.documentation(), await tab.documentation()]
    info.id = 'two'
    values.push(await browser.documentation(), await tab.documentation())
    return {
      values,
      calls,
      browserKeys: Reflect.ownKeys(browser),
      tabKeys: Reflect.ownKeys(tab),
      same: [
        browser.info === info,
        tab.info === info,
        browser.transport === transport,
        tab.documentationApi === documentation
      ],
      ids: [browser.id, tab.id, browser.browserId, tab.browserId, tab.tabId]
    }
  })
})
test('capability documentation propagates rejection without transport calls', async () => {
  await compare(async (api) => {
    const errors = []
    const documentation = {
      async get() {
        throw new Error('docs unavailable')
      }
    }
    for (const item of [
      new api.BrowserCapability({}, 'b', documentation, { id: 'x' }),
      new api.TabCapability({}, 'b', 't', documentation, { id: 'x' })
    ]) {
      try {
        await item.documentation()
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return errors
  })
})
test('capability collection preserves identity, ordering and later record mutations', async () => {
  await compare(async (api) => {
    const one = { info: { id: 'one' } },
      two = { info: { id: 'two' } }
    const record: any = { one, two }
    const collection = new api.Capabilities(record)
    const list = await collection.list()
    record.three = { info: { id: 'three' } }
    delete record.one
    let error
    try {
      await collection.get('one')
    } catch (e) {
      error = (e as Error).message
    }
    return {
      list,
      later: await collection.list(),
      same: [(await collection.get('two')) === two, list[0] === one.info],
      error,
      keys: Reflect.ownKeys(collection)
    }
  })
})
test('capability collection retains original inherited lookup and falsy unavailable rules', async () => {
  await compare(async (api) => {
    const inherited = { info: { id: 'inherited' } }
    const collection = new api.Capabilities(
      Object.assign(Object.create({ inherited }), { no: null })
    )
    const errors = []
    for (const id of ['no', '', 'missing']) {
      try {
        await collection.get(id)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    let listError
    try {
      await collection.list()
    } catch (e) {
      listError = (e as Error).message
    }
    return { same: (await collection.get('inherited')) === inherited, listError, errors }
  })
})
test('registration captures info identity, forwards options and overrides caller info', async () => {
  await compare(async (api) => {
    const results = []
    for (const register of [api.browserRegistration, api.tabRegistration]) {
      const info = { id: 'registered', description: 'description' }
      class Capability {
        constructor(public options: any) {}
      }
      const registration = register({ capability: Capability, info, internalOnly: false })
      const calls: string[] = []
      const options = {
        browserId: 'b',
        tabId: 't',
        info: { id: 'caller' },
        get extra() {
          calls.push('getter')
          return 42
        }
      }
      const made = registration.create(options)
      info.id = 'changed'
      results.push({
        keys: Object.keys(registration),
        same: [
          registration.capability === Capability,
          registration.info === info,
          made.options.info === info
        ],
        id: registration.id,
        info: registration.info,
        internalOnly: registration.internalOnly,
        options: made.options,
        calls
      })
    }
    return results
  })
})
test('registration omits null internalOnly and propagates construction errors', async () => {
  await compare(async (api) => {
    const results = []
    for (const register of [api.browserRegistration, api.tabRegistration]) {
      for (const internalOnly of [undefined, null, false, true]) {
        class Capability {
          constructor() {
            throw new Error('construction failed')
          }
        }
        const registration = register({ capability: Capability, info: { id: 'x' }, internalOnly })
        let error
        try {
          registration.create({})
        } catch (e) {
          error = (e as Error).message
        }
        results.push({
          keys: Object.keys(registration),
          internalOnly: registration.internalOnly,
          error
        })
      }
    }
    return results
  })
})
