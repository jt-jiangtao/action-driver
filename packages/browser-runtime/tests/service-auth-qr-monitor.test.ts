// @vitest-environment node
import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { monitorAuthQrCode, startAuthQrPageWatch } from '../src/service-auth-qr-monitor'

test('QR monitor publishes replacements and marks disappearance after three confirmed misses', async () => {
  const signal = new AbortController().signal
  const events: Array<[string, boolean]> = []
  const sequence = [{ payload: 'first' }, { payload: 'second' }, null, null, null]
  await monitorAuthQrCode({
    signal, initialPayload: 'first', completeWhenQrCodeDisappears: true,
    pageBindingStatus: async () => null,
    scan: async () => sequence.shift(),
    publish: (payload, disappeared) => { events.push([payload, disappeared === true]) },
    wait: async () => {}
  })
  expect(events).toEqual([['first', false], ['first', false], ['second', false], ['second', true]])
})

test('page QR watch captures fresh JPEG frames and stops after a published replacement', async () => {
  const calls: any[] = []
  const published: string[] = []
  const pageTimeouts: Array<number | undefined> = []
  let watcher!: ReturnType<typeof startAuthQrPageWatch>
  watcher = startAuthQrPageWatch({
    tabId: '7', timeoutMs: 55, initialPayload: 'first', qrOnly: false,
    pageBindingStatus: async () => null,
    cdp: { call: async (id, method, params, options) => {
      calls.push([id, method, params, options])
      return { data: 'AAAA' }
    } },
    playwright: { evaluateOnPlaywrightPage: async (_tab, _page, options) => {
      pageTimeouts.push(options.timeoutMs)
      return { payload: 'second', points: [{ x: 0, y: 0 }, { x: 2, y: 0 },
        { x: 2, y: 2 }, { x: 0, y: 2 }] }
    } },
    publish: (payload) => {
      published.push(payload)
      if (payload === 'second') watcher.stop()
    }
  })
  await watcher.done
  expect(published).toEqual(['first', 'second'])
  expect(calls).toEqual([[7, 'Page.captureScreenshot', {
    format: 'jpeg', fromSurface: true, optimizeForSpeed: true, quality: 80
  }, { preserveDebuggerOnTimeout: true, timeoutMs: 2000 }]])
  expect(pageTimeouts).toEqual([55])
})

test('QR watch uses the pinned WASM decoder for every new frame before page fallback', async () => {
  const png = await readFile(resolve('packages/browser-runtime/tests/fixtures/auth-qr.png'))
  let pageDecodes = 0
  const published: string[] = []
  let watcher!: ReturnType<typeof startAuthQrPageWatch>
  watcher = startAuthQrPageWatch({
    tabId: '7', initialPayload: 'first', qrOnly: false,
    pageBindingStatus: async () => null,
    cdp: { call: async () => ({ data: png.toString('base64') }) },
    filesystem: { readBytes: async (url: URL) => await readFile(url) },
    playwright: { evaluateOnPlaywrightPage: async () => { pageDecodes++; return undefined } },
    publish: (payload) => {
      published.push(payload)
      if (payload !== 'first') watcher.stop()
    }
  })
  const timeout = setTimeout(() => watcher.stop(), 2000)
  await watcher.done
  clearTimeout(timeout)
  expect(published).toEqual(['first', 'https://example.com/signin'])
  expect(pageDecodes).toBe(0)
})

test('QR monitor ignores uncertain scans and stops on changed origin', async () => {
  const events: Array<[string, boolean]> = []
  let pageChecks = 0
  let scans = 0
  await monitorAuthQrCode({
    signal: new AbortController().signal, initialPayload: 'first', completeWhenQrCodeDisappears: true,
    pageBindingStatus: async () => ++pageChecks > 1 ? 'origin_changed' : null,
    scan: async () => { scans++; return undefined },
    publish: (payload, disappeared) => { events.push([payload, disappeared === true]) },
    wait: async () => {}
  })
  expect(pageChecks).toBe(2)
  expect(scans).toBe(8)
  expect(events).toEqual([['first', false]])
})

test('QR monitor keeps polling after page change only in QR-only flow and stops on abort', async () => {
  const controller = new AbortController()
  let scans = 0
  const published: string[] = []
  await monitorAuthQrCode({
    signal: controller.signal, initialPayload: 'first', completeWhenQrCodeDisappears: true,
    pageBindingStatus: async () => 'page_changed',
    scan: async () => { scans++; controller.abort(); return { payload: 'second' } },
    publish: (payload) => { published.push(payload) },
    wait: async () => {}
  })
  expect(scans).toBe(1)
  expect(published).toEqual(['first'])
})
