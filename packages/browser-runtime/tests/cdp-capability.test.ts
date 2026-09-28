// @vitest-environment node
import { test, expect } from 'vitest'
import { CdpTabCapability } from '../src/cdp-capability'
import { originalClient } from './original-client'
async function compare(run: (Type: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await run(CdpTabCapability)).toEqual(await run(baselineApi.CdpTabCapability))
}
function options(transport: any) {
  return {
    browserId: 'b',
    tabId: 't',
    transport,
    documentation: {
      async get(name: string) {
        return name
      }
    },
    info: { id: 'cdp', description: 'CDP' }
  }
}
test('CDP send projects method, params, target and explicit transport timeout like original', async () => {
  await compare(async (Type) => {
    const calls: unknown[] = []
    const capability = new Type(
      options({
        async send(request: any) {
          calls.push({
            json: request.command.toJSON(),
            timeout: request.timeoutMs,
            ownTimeout: 'timeoutMs' in request
          })
          return { value: 'response' }
        },
        async display() {}
      })
    )
    for (const opts of [
      undefined,
      {},
      { target: null },
      { target: { sessionId: 'session' }, timeoutMs: 100 },
      { target: { targetId: 'target' }, timeoutMs: 0 }
    ])
      await capability.send('Runtime.evaluate', { expression: '1' }, opts)
    return calls
  })
})
test('CDP send returns arbitrary result values and references without projection', async () => {
  await compare(async (Type) => {
    const values = [undefined, null, false, 0, 'text', ['array'], { result: { value: 1 } }],
      results: unknown[] = []
    const capability = new Type(
      options({
        async send() {
          return values.shift()
        },
        async display() {}
      })
    )
    for (let index = 0; index < 7; index++) results.push(await capability.send('method'))
    const object = { nested: {} }
    capability.transport = {
      async send() {
        return object
      },
      async display() {}
    }
    return { results, same: (await capability.send('method')) === object }
  })
})
test('CDP send defers payload validation and preserves unusual target and timeout values', async () => {
  await compare(async (Type) => {
    const calls: unknown[] = []
    const capability = new Type(
      options({
        async send(request: any) {
          calls.push({ json: request.command.toJSON(), timeout: request.timeoutMs })
          return null
        },
        async display() {}
      })
    )
    for (const opts of [
      { target: {} },
      { target: { sessionId: 's', targetId: 't', extra: 'ignored' } },
      { target: 1, timeoutMs: -1 },
      { timeoutMs: null },
      { timeoutMs: NaN }
    ])
      await capability.send('', undefined, opts)
    return calls
  })
})
test('CDP send reads current scope and transport references and keeps base documentation routing', async () => {
  await compare(async (Type) => {
    const calls: unknown[] = [],
      capability = new Type(
        options({
          async send() {
            throw Error('old')
          },
          async display() {}
        })
      )
    capability.browserId = 'changed-browser'
    capability.tabId = 'changed-tab'
    capability.info = { id: 'changed', description: 'changed' }
    capability.transport = {
      async send(request: any) {
        calls.push(request.command.toJSON())
        return 'result'
      },
      async display() {}
    }
    return {
      result: await capability.send('method'),
      docs: await capability.documentation(),
      id: capability.id,
      calls,
      keys: Object.keys(capability)
    }
  })
})
test('CDP send preserves service errors and does not access unrelated constructor getters', async () => {
  await compare(async (Type) => {
    const failure = new Error('disconnected'),
      events: string[] = []
    const capability = new Type({
      ...options({
        async send() {
          throw failure
        },
        async display() {}
      }),
      get unrelated() {
        events.push('extra')
        throw Error('extra')
      }
    })
    try {
      await capability.send('method')
    } catch (error) {
      return { same: error === failure, events }
    }
  })
})
test('CDP send leaves params and target source untouched while passing params by reference', async () => {
  await compare(async (Type) => {
    const params = { expression: 'value' },
      target = { sessionId: 'session', extra: 'ignored' },
      events: string[] = []
    const capability = new Type(
      options({
        async send({ command }: any) {
          const json = command.toJSON()
          return { same: json.params === params, target: json.target }
        },
        async display() {}
      })
    )
    const result = await capability.send('method', params, {
      target,
      get timeoutMs() {
        events.push('timeout')
        return 42
      }
    })
    return { result, params, target, events }
  })
})
test('CDP target option accessor is read once before target fields are projected', async () => {
  await compare(async (Type) => {
    const events: string[] = []
    let reads = 0
    const capability = new Type(
      options({
        async send({ command }: any) {
          return command.toJSON()
        },
        async display() {}
      })
    )
    const result = await capability.send(
      'method',
      {},
      {
        get target() {
          reads++
          events.push(`target:${reads}`)
          return { sessionId: `session-${reads}`, targetId: `target-${reads}` }
        }
      }
    )
    return { result, events }
  })
})
test('CDP resolves transport send accessor before observing scope fields', async () => {
  await compare(async (Type) => {
    const events: string[] = []
    let capability: any
    const transport = {
      get send() {
        events.push('send')
        capability.browserId = 'accessor-browser'
        return async ({ command }: any) => command.toJSON()
      },
      async display() {}
    }
    capability = new Type(options(transport))
    return { result: await capability.send('method'), events }
  })
})
