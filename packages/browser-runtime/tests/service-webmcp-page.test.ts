// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { originalDocumentation } from './original-service'

const candidate = async () =>
  ((await import('../src/service-webmcp-page').catch(() => ({}))) as any).webMcpPageSource

async function pageRun(source: string, variant: 'stable' | 'changed' | 'opaque') {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: variant === 'opaque' ? 'about:blank' : 'https://example.com/tools',
    runScripts: 'outside-only'
  })
  const w = dom.window as any
  let next = 0
  Object.defineProperty(w.crypto, 'randomUUID', { value: () => `registration-${++next}` })
  const listeners = new Map<string, () => void>()
  const calls: unknown[] = []
  const tool: any = {
    name: 'search',
    origin: 'https://example.com',
    window: w,
    title: 'Search',
    description: 'Find results',
    inputSchema: '{"type":"object"}',
    annotations: { readOnlyHint: true }
  }
  const context: any = {
    getTools: async () => [tool],
    addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
    executeTool: async function (selected: any, input: any) {
      calls.push([selected.name, input])
      return 'found'
    }
  }
  w.document.modelContext = context
  const read = (generation: number) =>
    w.eval(source + `\nwebMcp.readTools(${JSON.stringify({ generation, pageUrl: 'https://example.com/tools', staleRegistrationError: 'stale' })})`)
  const invoke = (registrationId: string) =>
    w.eval(source + `\nwebMcp.invokeTool(${JSON.stringify({ registrationId, generation: 1, inputJson: '{"query":"one"}', timeoutMs: null, staleRegistrationError: 'stale' })})`)
  try {
    const first = await read(1)
    const second = await read(1)
    let firstCall: unknown
    try { firstCall = await invoke(first[0]?.registration_id) } catch (error: any) { firstCall = error.message }
    if (variant === 'changed') {
      tool.title = 'Changed'
      listeners.get('toolchange')?.()
    }
    const third = await read(1)
    let oldCall: unknown
    try { oldCall = await invoke(first[0]?.registration_id) } catch (error: any) { oldCall = error.message }
    return JSON.parse(JSON.stringify({ first, second, third, firstCall, oldCall, calls }))
  } finally {
    w.close()
  }
}

test('page tool registrations remain stable until a toolchange and stale handles cannot execute', async () => {
  const own = await candidate()
  expect(typeof own).toBe('string')
  const original = (await originalDocumentation()).baselineWebMcpPageSource
  for (const variant of ['stable', 'changed', 'opaque'] as const)
    expect(await pageRun(own, variant)).toEqual(await pageRun(original, variant))
})
