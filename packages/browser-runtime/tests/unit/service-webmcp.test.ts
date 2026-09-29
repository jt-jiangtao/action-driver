// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { JSDOM } from 'jsdom'
import { originalDocumentation } from '../original-service'

const candidate = async () =>
  ((await import('../../src/service-webmcp').catch(() => ({}))) as any).WebMcpService

async function fixture(pageSource: string) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://example.com/tools',
    runScripts: 'outside-only'
  })
  const w = dom.window as any
  Object.defineProperty(w.crypto, 'randomUUID', { value: () => 'registered-one' })
  const tool = {
    name: 'search',
    origin: 'https://example.com',
    window: w,
    title: 'Search',
    description: 'Find results',
    inputSchema: '{"type":"object"}',
    annotations: { readOnlyHint: true }
  }
  w.document.modelContext = {
    getTools: async () => [tool],
    addEventListener: () => {},
    executeTool: async function (_tool: any, input: any) {
      return JSON.stringify(input)
    }
  }
  const calls: unknown[] = []
  const cdp = Object.assign(new EventEmitter(), {
    addTabCleanupHandler: () => {},
    call: async (_id: number, method: string) => {
      calls.push(method)
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { id: 'frame-1', url: 'https://example.com/tools', securityOrigin: 'https://example.com', secureContextType: 'Secure', loaderId: 'loader-1' } } }
      if (method === 'Target.getTargets') return { targetInfos: [] }
      throw new Error(`unexpected ${method}`)
    },
    callTarget: async (_target: any, method: string, params: any) => {
      calls.push(method)
      if (method === 'WebMCP.enable') return {}
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 3 }
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression).replace(/^"use strict";/, '')
        return { result: { value: await w.eval(expression.replace('webMcp.', 'webMcp.')) } }
      }
      throw new Error(`unexpected ${method}`)
    }
  })
  const context = {
    cdp,
    preferences: { isWebMcpEnabled: async () => true },
    supportsTabCapability: async () => true,
    getCurrentSessionId: () => 'session-1',
    clientInfo: { name: 'Browser' },
    runtime: {}
  }
  return { dom, cdp, context, calls, tool, pageSource }
}

test('list registers page tools, invoke requires current session snapshot, and stale registrations are rejected', async () => {
  const Own = await candidate()
  expect(typeof Own).toBe('function')
  const base = await originalDocumentation()
  const ownSource = (await import('../../src/service-webmcp-page')).webMcpPageSource
  async function run(original: boolean) {
    const setup = await fixture(original ? base.baselineWebMcpPageSource : ownSource)
    const service = original ? undefined : new Own(setup.context)
    try {
      let beforeError
      try {
        if (original) await base.baselineWebMcpInvoke({ tab_id: 1, registration_id: 'registered-one', input: { query: 'one' } }, setup.context)
        else await service.invoke({ tab_id: 1, registration_id: 'registered-one', input: { query: 'one' } })
      } catch (error: any) { beforeError = error.message }
      const listed = original
        ? await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
        : await service.list({ tab_id: 1 })
      const invoked = original
        ? await base.baselineWebMcpInvoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: { query: 'one' } }, setup.context)
        : await service.invoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: { query: 'one' } })
      setup.tool.title = 'Changed'
      const relisted = original
        ? await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
        : await service.list({ tab_id: 1 })
      let oldError
      try {
        if (original) await base.baselineWebMcpInvoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: {} }, setup.context)
        else await service.invoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: {} })
      } catch (error: any) { oldError = error.message }
      return { beforeError, listed, invoked, relisted, oldError, calls: setup.calls }
    } finally { setup.dom.window.close() }
  }
  expect(await run(false)).toEqual(await run(true))
})

test('turning WebMCP off clears registered session tools even when it is later reenabled', async () => {
  const Own = await candidate()
  const base = await originalDocumentation()
  async function run(original: boolean) {
    const setup = await fixture(original ? base.baselineWebMcpPageSource : (await import('../../src/service-webmcp-page')).webMcpPageSource)
    let enabled = true
    setup.context.preferences.isWebMcpEnabled = async () => enabled
    const service = original ? undefined : new Own(setup.context)
    try {
      const listed = original
        ? await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
        : await service.list({ tab_id: 1 })
      enabled = false
      try {
        if (original) await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
        else await service.list({ tab_id: 1 })
      } catch {}
      enabled = true
      let error
      try {
        if (original) await base.baselineWebMcpInvoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: null }, setup.context)
        else await service.invoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: null })
      } catch (caught: any) { error = caught.message }
      return error
    } finally { setup.dom.window.close() }
  }
  expect(await run(false)).toEqual(await run(true))
})

test('disabled WebMCP returns the original unsupported-command error for each command', async () => {
  const Own = await candidate()
  const base = await originalDocumentation()
  async function run(original: boolean) {
    const setup = await fixture(original ? base.baselineWebMcpPageSource : (await import('../../src/service-webmcp-page')).webMcpPageSource)
    setup.context.preferences.isWebMcpEnabled = async () => false
    const service = original ? undefined : new Own(setup.context)
    const errors: string[] = []
    try {
      for (const type of ['list', 'invoke']) {
        try {
          if (type === 'list') {
            if (original) await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
            else await service.list({ tab_id: 1 })
          } else if (original) await base.baselineWebMcpInvoke({ tab_id: 1, registration_id: 'missing', input: null }, setup.context)
          else await service.invoke({ tab_id: 1, registration_id: 'missing', input: null })
        } catch (error: any) { errors.push(error.message) }
      }
      return errors
    } finally { setup.dom.window.close() }
  }
  expect(await run(false)).toEqual(await run(true))
})

test('Luna model is denied even when preferences and browser capability allow WebMCP', async () => {
  const Own = await candidate()
  const base = await originalDocumentation()
  async function run(original: boolean) {
    const setup = await fixture(original ? base.baselineWebMcpPageSource : (await import('../../src/service-webmcp-page')).webMcpPageSource)
    setup.context.runtime = {
      requestMeta: { 'x-codex-turn-metadata': JSON.stringify({ model: 'gpt-6-luna' }) }
    }
    const service = original ? undefined : new Own(setup.context)
    try {
      try {
        if (original) await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
        else await service.list({ tab_id: 1 })
      } catch (error: any) { return error.message }
    } finally { setup.dom.window.close() }
  }
  expect(await run(false)).toEqual(await run(true))
})

test('tool registration is visible only to the session that fetched it', async () => {
  const Own = await candidate()
  const base = await originalDocumentation()
  async function run(original: boolean) {
    const setup = await fixture(original ? base.baselineWebMcpPageSource : (await import('../../src/service-webmcp-page')).webMcpPageSource)
    let session = 'session-1'
    setup.context.getCurrentSessionId = () => session
    const service = original ? undefined : new Own(setup.context)
    try {
      const listed = original
        ? await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
        : await service.list({ tab_id: 1 })
      session = 'session-2'
      let error
      try {
        if (original) await base.baselineWebMcpInvoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: null }, setup.context)
        else await service.invoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: null })
      } catch (caught: any) { error = caught.message }
      return error
    } finally { setup.dom.window.close() }
  }
  expect(await run(false)).toEqual(await run(true))
})

test('WebMCP toolsRemoved event invalidates the current page registration', async () => {
  const Own = await candidate()
  const base = await originalDocumentation()
  async function run(original: boolean) {
    const setup = await fixture(original ? base.baselineWebMcpPageSource : (await import('../../src/service-webmcp-page')).webMcpPageSource)
    const service = original ? undefined : new Own(setup.context)
    try {
      const listed = original
        ? await base.baselineWebMcpList({ tab_id: 1 }, setup.context)
        : await service.list({ tab_id: 1 })
      setup.cdp.emit('event', {
        method: 'WebMCP.toolsRemoved',
        source: { tabId: 1 },
        params: {}
      })
      try {
        if (original) await base.baselineWebMcpInvoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: null }, setup.context)
        else await service.invoke({ tab_id: 1, registration_id: listed.tools[0].registration_id, input: null })
      } catch (error: any) { return error.message }
    } finally { setup.dom.window.close() }
  }
  expect(await run(false)).toEqual(await run(true))
})

test('excessive page registrations disable repeated fetching until top-level navigation', async () => {
  const Own = await candidate()
  const setup = await fixture((await import('../../src/service-webmcp-page')).webMcpPageSource)
  const second = { ...setup.tool, name: 'other' }
  setup.dom.window.document.modelContext.getTools = async () => [setup.tool, second]
  const service = new Own(setup.context, {
    maxTools: 1,
    maxTotalDescriptorBytes: 65536,
    maxRegistrationChanges: 10
  })
  try {
    await expect(service.list({ tab_id: 1 })).rejects.toThrow('exceeds supported limits')
    const before = setup.calls.length
    await expect(service.list({ tab_id: 1 })).rejects.toThrow('exceeds supported limits')
    expect(setup.calls.length).toBe(before)
    setup.cdp.emit('event', {
      method: 'Page.frameNavigated',
      source: { tabId: 1 },
      params: { frame: { id: 'frame-1' } }
    })
    await expect(service.list({ tab_id: 1 })).rejects.toThrow('exceeds supported limits')
    expect(setup.calls.length).toBeGreaterThan(before)
  } finally { setup.dom.window.close() }
})

test('preflight resolves only the current session registration and returns isolated metadata', async () => {
  const Own = await candidate()
  const base = await originalDocumentation()
  const setup = await fixture((await import('../../src/service-webmcp-page')).webMcpPageSource)
  const original = await fixture(base.baselineWebMcpPageSource)
  let session = 'session-1'
  setup.context.getCurrentSessionId = () => session
  const service = new Own(setup.context)
  try {
    const listed = await service.list({ tab_id: 1 })
    const reference = await base.baselineWebMcpList({ tab_id: 1 }, original.context)
    const registrationId = listed.tools[0].registration_id
    expect(service.resolveRegistration).toBeDefined()
    expect(service.resolveRegistration(1, registrationId)).toEqual(
      base.baselineWebMcpFindRegistration(original.context, 1, reference.tools[0].registration_id)
    )
    const result = service.resolveRegistration(1, registrationId)
    result.title = 'Tampered'
    expect(service.resolveRegistration(1, registrationId).title).toBe('Search')
    session = 'session-2'
    expect(() => service.resolveRegistration(1, registrationId)).toThrow(
      'WebMCP tool registration is stale. Call fetchTools() again.'
    )
  } finally { setup.dom.window.close(); original.dom.window.close() }
})

test('notification observes generation changes and formats newly registered tools', async () => {
  const Own = await candidate()
  const base = await originalDocumentation()
  const setup = await fixture((await import('../../src/service-webmcp-page')).webMcpPageSource)
  const service = new Own(setup.context)
  try {
    const first = await service.list({ tab_id: 1 })
    expect(service.pendingNotificationTabIds).toBeDefined()
    expect(service.notificationForTab).toBeDefined()
    expect(service.pendingNotificationTabIds('session-1')).toEqual([])
    setup.cdp.emit('event', { method: 'WebMCP.toolsAdded', source: { tabId: 1 }, params: {} })
    expect(service.pendingNotificationTabIds('session-1')).toEqual([1])
    const text = await service.notificationForTab(1, Date.now() + 10000)
    expect(text).toBe(base.baselineWebMcpAnnouncement(1, first.tools))
    expect(service.pendingNotificationTabIds('session-1')).toEqual([])
    service.clearSessionSnapshots()
    expect(() => service.resolveRegistration(1, first.tools[0].registration_id)).toThrow(
      'WebMCP tool registration is stale. Call fetchTools() again.'
    )
  } finally { setup.dom.window.close() }
})
