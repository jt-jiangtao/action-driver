// @vitest-environment node
import { test, expect } from 'vitest'
import { toWebMcpToolDescriptor, createWebMcpSnapshot } from '../../src/webmcp-snapshot'
import { originalClient } from '../original-client'
const tool = (extra = {}) => ({
  name: 'raw',
  call_name: 'alias',
  registration_id: 'registration',
  input_schema: { type: 'object' },
  ...extra
})
async function compare(run: (create: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  const original = async (tools: any[], transport: any) =>
    new baselineApi.TabWebMcpCapability({
      browserId: 'b',
      tabId: 't',
      transport: {
        ...transport,
        async send(request: any) {
          if (request.command.toJSON().type === 'webmcp_list_tools') return { tools }
          return transport.send(request)
        }
      },
      documentation: {},
      info: {}
    }).fetchTools()
  const candidate = async (tools: any[], transport: any) =>
    createWebMcpSnapshot({ tools, context: { browserId: 'b', tabId: 't', transport } })
  expect(await run(candidate)).toEqual(await run(original))
}
test('tool descriptor matches original projection, omission and reference behavior', async () => {
  const { baselineApi } = await originalClient()
  for (const record of [
    tool(),
    tool({ title: '', description: '', annotations: {}, origin: '', pageUrl: '' }),
    tool({
      title: null,
      description: null,
      annotations: null,
      origin: null,
      pageUrl: null,
      extra: 1
    })
  ]) {
    const actual = toWebMcpToolDescriptor(record as any)
    expect(actual).toEqual(baselineApi.toWebMcpToolDescriptor(record))
    expect(actual.inputSchema).toBe(record.input_schema)
    if (record.annotations) expect(actual.annotations).toBe(record.annotations)
    expect('registration_id' in actual).toBe(false)
  }
})
test('snapshot description uses invocation aliases and preserves original pretty format', async () => {
  await compare(async (create) => {
    const snapshot = await create(
      [
        tool({ title: 'Tool', description: 'Description', annotations: { readOnlyHint: true } }),
        tool({ name: 'other', call_name: 'second' })
      ],
      {
        async send() {
          return {}
        }
      }
    )
    return {
      description: snapshot.description(),
      frozen: Object.isFrozen(snapshot),
      keys: Object.keys(snapshot)
    }
  })
})
test('empty snapshot description and unavailable-tool errors match original', async () => {
  await compare(async (create) => {
    const snapshot = await create([], {
      async send() {
        throw Error('must not send')
      }
    })
    try {
      await snapshot.call('  missing  ', {})
    } catch (error) {
      return { description: snapshot.description(), message: (error as Error).message }
    }
  })
})
test('snapshot invocation trims aliases and projects registration metadata, input and timeout', async () => {
  await compare(async (create) => {
    const calls: unknown[] = [],
      input = { key: 'value' }
    const snapshot = await create(
      [tool({ title: 'Title', description: 'Description', origin: 'https://example.test' })],
      {
        async send(request: any) {
          calls.push({
            command: request.command.toJSON(),
            timeout: request.timeoutMs,
            ownTimeout: 'timeoutMs' in request
          })
          return { result: ['result'] }
        }
      }
    )
    const first = await snapshot.call('  alias ', input)
    const second = await snapshot.call('alias', input, { timeoutMs: 0 })
    const third = await snapshot.call('alias', undefined, { timeoutMs: null })
    return { first, second, third, calls }
  })
})
test('last duplicate alias is invoked while description includes each listed tool', async () => {
  await compare(async (create) => {
    const calls: unknown[] = []
    const snapshot = await create(
      [tool(), tool({ name: 'last', registration_id: 'last-registration' })],
      {
        async send({ command }: any) {
          calls.push(command.toJSON())
          return { result: 'ok' }
        }
      }
    )
    return { description: snapshot.description(), result: await snapshot.call('alias', {}), calls }
  })
})
test('snapshot metadata remains captured when source records change after construction', async () => {
  await compare(async (create) => {
    const tools = [tool()],
      calls: unknown[] = []
    const snapshot = await create(tools, {
      async send({ command }: any) {
        calls.push(command.toJSON())
        return { result: 'ok' }
      }
    })
    tools[0]!.name = 'changed'
    tools[0]!.registration_id = 'changed'
    tools.length = 0
    return { description: snapshot.description(), result: await snapshot.call('alias', {}), calls }
  })
})
test('snapshot preserves service error identity and missing result behavior', async () => {
  await compare(async (create) => {
    const error = new Error('service failure')
    let failure = true
    const snapshot = await create([tool()], {
      async send() {
        if (failure) throw error
        return {}
      }
    })
    let same = false
    try {
      await snapshot.call('alias', {})
    } catch (received) {
      same = received === error
    }
    failure = false
    return { same, result: await snapshot.call('alias', {}) }
  })
})
test('snapshot calls read current capability scope and transport after the tool list was captured', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(candidate: boolean) {
    const calls: unknown[] = [],
      tools = [tool()]
    const transport = {
      async send({ command }: any) {
        return command.toJSON().type === 'webmcp_list_tools' ? { tools } : { result: 'old' }
      },
      async display() {}
    }
    const context = candidate
      ? { browserId: 'b', tabId: 't', transport }
      : new baselineApi.TabWebMcpCapability({
          browserId: 'b',
          tabId: 't',
          transport,
          documentation: {},
          info: {}
        })
    const snapshot = candidate
      ? createWebMcpSnapshot({ tools, context } as any)
      : await context.fetchTools()
    context.browserId = 'new-browser'
    context.tabId = 'new-tab'
    context.transport = {
      async send({ command }: any) {
        calls.push(command.toJSON())
        return { result: 'new' }
      },
      async display() {}
    }
    return { result: await snapshot.call('alias', {}), calls }
  }
  expect(await exercise(true)).toEqual(await exercise(false))
})
test('WebMCP transport send accessor runs before current scope fields are read', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(candidate: boolean) {
    const tools = [tool()]
    const initial = {
      async send() {
        return { tools }
      },
      async display() {}
    }
    const context = candidate
      ? { browserId: 'b', tabId: 't', transport: initial }
      : new baselineApi.TabWebMcpCapability({
          browserId: 'b',
          tabId: 't',
          transport: initial,
          documentation: {},
          info: {}
        })
    const snapshot = candidate
      ? createWebMcpSnapshot({ tools, context })
      : await context.fetchTools()
    context.transport = {
      get send() {
        context.browserId = 'accessor-browser'
        return async ({ command }: any) => ({ result: command.toJSON() })
      },
      async display() {}
    }
    return await snapshot.call('alias', {})
  }
  expect(await exercise(true)).toEqual(await exercise(false))
})
