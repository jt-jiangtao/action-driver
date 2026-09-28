// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as candidate from '../src/runtime-initialization'
import { Agent, Browsers, Documentation } from '../src/browser-agent'
import { FunctionAgentTransport } from '../src/transport'
import { createApiView } from '../src/api-view'
import { originalClient } from './original-client'

const runtimeTypes = { Agent, Browsers, Documentation }
function factory(options: any) {
  const view = createApiView(options.apiManifest, runtimeTypes)
  return view(
    new Agent({
      transport: new FunctionAgentTransport(options),
      createBrowser: () => {
        throw new Error('Complete Browser factory remains pending')
      }
    }),
    options.disabledMemberIds
  )
}
const originalMjs = () => import(pathToFileURL(resolve(
  'apps/agent-runtime/vendor/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.mjs'
)).href)
async function setup(baseline: boolean | 'mjs', options?: any, create = factory) {
  if (baseline === 'mjs') return (await originalMjs()).setupBrowserRuntime(options)
  if (baseline) return (await originalClient()).setupBrowserRuntime(options)
  return (candidate as any).initializeBrowserRuntime(options, create)
}
async function compare(run: (baseline: boolean | 'mjs') => Promise<unknown>) {
  const expected = await run(true)
  expect(await run('mjs')).toEqual(expected)
  expect(await run(false)).toEqual(expected)
}
function manifest() {
  return { interfaces: { Agent: {}, Browsers: {}, Documentation: {} } }
}
function host() {
  const calls: any[] = []
  const rpc = async (...args: any[]) => {
    calls.push(args)
    const { method, params } = args[1]
    if (method === 'setup') return { apiManifest: manifest(), disabledMemberIds: [] }
    if (params.type === 'get_documentation') return 'docs'
    if (params.type === 'list_browsers') return []
    return {}
  }
  return { calls, rpc, emitImage: async () => {} }
}
test('runtime initialization forwards exact setup defaults/options and routes commands', async () => {
  await compare(async (baseline) => {
    const results = []
    for (const options of [
      undefined,
      {},
      { environment: null },
      {
        environment: 'custom',
        undocumentedApiMembers: ['Tab.ax'],
        excludedDocumentation: ['browser']
      }
    ]) {
      const current = host()
      vi.stubGlobal('nodeRepl', current)
      try {
        const agent = await setup(baseline, options)
        results.push({
          calls: current.calls,
          docs: await agent.documentation.get('browser'),
          browsers: await agent.browsers.list()
        })
      } finally {
        vi.unstubAllGlobals()
      }
    }
    return results
  })
})
test('runtime initialization rejects untrusted host before reading options', async () => {
  await compare(async (baseline) => {
    const errors = []
    const options = {
      get environment() {
        throw new Error('options read')
      }
    }
    for (const current of [undefined, null, {}, { rpc: 3 }]) {
      vi.stubGlobal('nodeRepl', current)
      try {
        await setup(baseline, options)
      } catch (e) {
        errors.push((e as Error).message)
      } finally {
        vi.unstubAllGlobals()
      }
    }
    return errors
  })
})
test('runtime initialization propagates setup rejection and does not create an agent', async () => {
  await compare(async (baseline) => {
    const calls: any[] = []
    let created = 0,
      error
    vi.stubGlobal('nodeRepl', {
      rpc: async (...args: any[]) => {
        calls.push(args)
        throw new Error('setup failed')
      }
    })
    try {
      await setup(baseline, {}, () => {
        created++
        return {}
      })
    } catch (e) {
      error = (e as Error).message
    } finally {
      vi.unstubAllGlobals()
    }
    return { calls, created, error }
  })
})
test('runtime initialization keeps captured unbound rpc after host changes', async () => {
  await compare(async (baseline) => {
    const calls: any[] = [],
      bindings: boolean[] = []
    const current = {
      async rpc(this: unknown, service: string, input: any) {
        bindings.push(this === undefined)
        calls.push({ service, input })
        return input.method === 'setup'
          ? { apiManifest: manifest(), disabledMemberIds: [] }
          : 'docs'
      }
    }
    vi.stubGlobal('nodeRepl', current)
    try {
      const agent = await setup(baseline)
      current.rpc = async () => {
        throw new Error('replacement rpc')
      }
      vi.stubGlobal('nodeRepl', {
        rpc: async () => {
          throw new Error('replacement host')
        }
      })
      return { docs: await agent.documentation.get('browser'), calls, bindings }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
test('runtime initialization applies disabled members and sends display effects to console in order', async () => {
  await compare(async (baseline) => {
    const calls: any[] = [],
      logs: any[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args)
    })
    vi.stubGlobal('nodeRepl', {
      async rpc(service: string, input: any) {
        calls.push({ service, input })
        return input.method === 'setup'
          ? { apiManifest: manifest(), disabledMemberIds: ['Browsers.list'] }
          : { value: 1, side_effects: ['first', 'second'] }
      }
    })
    try {
      const agent = await setup(baseline)
      return {
        result: await agent.documentation.get('browser'),
        disabled: agent.browsers.list,
        calls,
        logs
      }
    } finally {
      log.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
test('runtime setup projects option fields without reading unrelated accessors', async () => {
  await compare(async (baseline) => {
    const current = host(),
      options = {}
    Object.defineProperty(options, 'unrelated', {
      enumerable: true,
      get() {
        throw new Error('unrelated getter')
      }
    })
    vi.stubGlobal('nodeRepl', current)
    try {
      await setup(baseline, options)
      return current.calls
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

test('runtime initialization routes screenshot bytes to captured host with current emitImage method', async () => {
  await compare(async (baseline) => {
    const calls: any[] = [],
      images: any[] = []
    const current: any = {
      async rpc(service: string, input: any) {
        calls.push({ service, input })
        if (input.method === 'setup')
          return { apiManifest: { interfaces: {} }, disabledMemberIds: [] }
        if (input.params.type === 'get_browser')
          return { id: 'b', name: 'Browser', type: 'iab', capabilities: { browser: [], tab: [] } }
        if (input.params.type === 'create_tab') return { id: 't' }
        return { state: 'state', data: 'AAH/' }
      },
      async emitImage(this: any, bytes: Uint8Array) {
        images.push({ bytes: [...bytes], same: this === current, method: 'initial' })
      }
    }
    const { TabsControls } = await import('../src/tab-collections')
    const { AXAPI } = await import('../src/tab-apis')
    const imageFactory = (options: any) => {
      const transport = new FunctionAgentTransport(options)
      return new Agent({
        transport,
        createBrowser: ({ browserInfo }) => ({
          tabs: new TabsControls({
            browserId: browserInfo.id,
            transport,
            createTab: (payload) => ({
              ax: new AXAPI({ browserId: browserInfo.id, tabId: payload.id, transport })
            })
          })
        })
      })
    }
    vi.stubGlobal('nodeRepl', current)
    try {
      const agent = await setup(baseline, {}, imageFactory)
      current.emitImage = async function (this: any, bytes: Uint8Array) {
        images.push({ bytes: [...bytes], same: this === current, method: 'updated' })
      }
      vi.stubGlobal('nodeRepl', {
        rpc: () => {
          throw new Error('new host rpc')
        },
        emitImage: () => {
          throw new Error('new host image')
        }
      })
      const browser = await agent.browsers.get('b')
      const tab = await browser.tabs.new()
      await tab.ax.write('screenshot')
      return { calls, images }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
test('runtime initialization truncates text effects at the original 100000 character limit', async () => {
  await compare(async (baseline) => {
    const logs: any[] = [],
      text = 'x'.repeat(100003)
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args)
    })
    vi.stubGlobal('nodeRepl', {
      async rpc(_service: string, input: any) {
        return input.method === 'setup'
          ? { apiManifest: manifest(), disabledMemberIds: [] }
          : { ok: true, side_effects: [text] }
      }
    })
    try {
      const agent = await setup(baseline)
      return { result: await agent.documentation.get('browser'), logs }
    } finally {
      log.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
test('runtime initialization passes decorateTab through unchanged to the assembly boundary', async () => {
  const current = host()
  const decorateTab = () => {}
  let captured: any
  vi.stubGlobal('nodeRepl', current)
  try {
    const result = await setup(false, { decorateTab }, (options) => {
      captured = options
      return 'agent'
    })
    expect(result).toBe('agent')
    expect(captured.decorateTab).toBe(decorateTab)
    expect(captured.disabledMemberIds).toEqual(new Set())
    expect(captured.apiManifest).toEqual(manifest())
  } finally {
    vi.unstubAllGlobals()
  }
})
