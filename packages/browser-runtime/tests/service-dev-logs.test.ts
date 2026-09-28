// @vitest-environment node
import { test, expect } from 'vitest'
import { DevLogs } from '../src/service-dev-logs'
import { EventEmitter } from 'node:events'
import { originalDocumentation } from './original-service'
function transport() {
  const cdp: any = new EventEmitter(),
    calls: any[] = [],
    attach: any[] = []
  let protectedTab = false
  cdp.addTabAttachHandler = (run: any) => {
    attach.push(run)
  }
  cdp.call = async (...args: any[]) => {
    calls.push(args)
  }
  cdp.hasBrowserAuthRawEventProtection = () => protectedTab
  return {
    cdp,
    calls,
    attach,
    protect: () => {
      protectedTab = true
    }
  }
}
test('console/exception logging preserves formatting, levels, URL hints and credential redaction', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = transport(),
      dev = new Type(f.cdp)
    for (const params of [
      {
        type: 'warning',
        args: [{ type: 'string', value: 'text' }, { value: 0 }, { description: 'Object' }, null],
        stackTrace: { callFrames: [{ url: 'https://example.com' }] }
      },
      { type: 'debug', args: [] },
      { type: 'other', args: [{ type: 'string' }] }
    ])
      f.cdp.emit('event', { source: { tabId: 1 }, method: 'Runtime.consoleAPICalled', params })
    f.cdp.emit('event', {
      source: { tabId: 1 },
      method: 'Runtime.exceptionThrown',
      params: {
        exceptionDetails: { exception: { value: 'Error' }, url: 'https://example.com/error' }
      }
    })
    f.protect()
    f.cdp.emit('event', {
      source: { tabId: 1 },
      method: 'Runtime.consoleAPICalled',
      params: { args: [{ value: 'secret' }] }
    })
    const results = await dev.logs({ tabId: 1 })
    return {
      logs: results.map(({ timestamp, ...rest }: any) => ({
        ...rest,
        timestamp: !Number.isNaN(Date.parse(timestamp))
      })),
      calls: f.calls
    }
  }
  expect(await exercise(DevLogs)).toEqual(await exercise(base.BaselineDevLogs))
})
test('logs retain latest 500 entries and apply filters/level/limit after runtime enabling', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = transport(),
      dev = new Type(f.cdp)
    for (let i = 0; i < 510; i++)
      dev.pushLog(1, { level: i % 2 ? 'warn' : 'log', message: 'entry ' + i })
    const results = [
      await dev.logs({ tabId: 1, filter: 'entry 50', levels: ['warn'], limit: 2 }),
      await dev.logs({ tabId: 1, limit: 0 })
    ]
    f.cdp.emit('tabDetached', 1)
    results.push(await dev.logs({ tabId: 1 }))
    return { results, calls: f.calls }
  }
  expect(await exercise(DevLogs)).toEqual(await exercise(base.BaselineDevLogs))
})
test('runtime enable coalesces concurrent attempts and failed attempts retry', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = transport(),
      dev = new Type(f.cdp)
    let attempts = 0
    f.cdp.call = async () => {
      attempts++
      await Promise.resolve()
      if (attempts === 1) throw Error('enable failed')
    }
    const results = await Promise.allSettled([
      dev.ensureRuntimeEnabled(1),
      dev.ensureRuntimeEnabled(1)
    ])
    await dev.ensureRuntimeEnabled(1)
    await dev.ensureRuntimeEnabled(1)
    return {
      attempts,
      results: results.map((r: any) => (r.status === 'fulfilled' ? 'enabled' : r.reason.message)),
      enabled: [...dev.runtimeEnabledTabIds],
      pending: dev.runtimeEnablePromises.size
    }
  }
  expect(await exercise(DevLogs)).toEqual(await exercise(base.BaselineDevLogs))
})
