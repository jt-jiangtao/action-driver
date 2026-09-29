import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createPluginContext,
  type InvocationContext,
  type ToolExecutor
} from '@actiondriver/plugin-sdk'
import { RuntimeToolRegistry } from '../../../apps/agent-runtime/src/tool-registry'
import { activate } from './extension'

afterEach(() => vi.unstubAllGlobals())
describe('web plugin configured providers', () => {
  it.each([
    [{}, []],
    [{ searchConfigured: true }, ['tools/local/web/search']],
    [{ readerConfigured: true }, ['tools/local/web/open']],
    [
      { searchConfigured: true, readerConfigured: true },
      ['tools/local/web/open', 'tools/local/web/search']
    ]
  ] as const)(
    'registers only individually configured tools %j',
    async (configuration, expected) => {
      const registry = new RuntimeToolRegistry(),
        requested: string[] = []
      const context = createPluginContext(
        { pluginId: 'web', version: '1.2.0', hostEpoch: 'test' },
        {
          tools: { register: (definition, executor) => registry.register(definition, executor) },
          registrations: {
            register() {
              throw new Error('unexpected')
            }
          },
          transport: {
            async request(method) {
              requested.push(method)
              return configuration
            }
          }
        }
      )
      await activate(context)
      expect(registry.list().map((tool) => tool.id)).toEqual(expected)
      expect(requested.every((method) => method === 'storage.get')).toBe(true)
      await context.subscriptions.dispose()
      expect(registry.list()).toEqual([])
    }
  )
  it('retrieves the search credential only during execution with invocation context', async () => {
    const registry = new RuntimeToolRegistry(),
      invocations: InvocationContext[] = []
    const context = createPluginContext(
      { pluginId: 'web', version: '1.2.0', hostEpoch: 'test' },
      {
        tools: { register: (definition, executor) => registry.register(definition, executor) },
        registrations: {
          register() {
            throw new Error('unexpected')
          }
        },
        transport: {
          async request(method, payload, invocation) {
            if (method === 'storage.get') return { searchConfigured: true }
            expect(method).toBe('credentials.request')
            expect(payload).toEqual({ id: 'tavily', purpose: 'web.search' })
            invocations.push(invocation!)
            return 'search-key'
          }
        }
      }
    )
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ results: [] }), {
          headers: { 'content-type': 'application/json' }
        })
    )
    await activate(context)
    const executor = registry.resolve('tools/local/web/search', 1).executor as ToolExecutor
    const call = {
      callId: 'call',
      providerCallId: 'provider',
      modelName: 'tools_local_web_search',
      arguments: { query: 'q' }
    }
    await expect(executor.execute(call)[Symbol.asyncIterator]().next()).rejects.toThrow(
      'PROTOCOL_ERROR'
    )
    const invocation: InvocationContext = {
      callId: 'call',
      requestId: 'req',
      deadline: Date.now() + 1000,
      source: { kind: 'runtime' },
      chain: ['tools/local/web/search'],
      grants: ['tools/local/web/search@1']
    }
    const events = []
    for await (const event of executor.execute(
      call,
      new AbortController().signal,
      undefined,
      invocation
    ))
      events.push(event)
    expect(events.at(-1)).toMatchObject({ output: { results: [] } })
    expect(invocations).toEqual([invocation])
    await context.subscriptions.dispose()
  })
})
