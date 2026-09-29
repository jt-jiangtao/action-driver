// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { originalDocumentation } from '../original-service'
import { decodeAuthQrWithPage } from '../../src/service-auth-qr-page'

test('page QR fallback passes screenshot and isolated-world timeout, then normalizes bounds', async () => {
  const original = await originalDocumentation()
  const raw = {
    payload: 'https://example.com/signin',
    points: [{ x: 1, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 9 }, { x: 1, y: 9 }]
  }
  async function exercise(run: Function) {
    const calls: any[] = []
    const result = await run('data:image/jpeg;base64,AAAA', { tab_id: '7', timeout_ms: 900 }, {
      playwright: { evaluateOnPlaywrightPage: async (tabId: string, _fn: Function, options: any) => {
        calls.push([tabId, options])
        return raw
      } }
    })
    return { result, calls }
  }
  expect(await exercise(decodeAuthQrWithPage)).toEqual(await exercise(original.baselineAuthPageQrDecode))
})

test('browser QR decoder accepts one symbol, closes bitmap, and rejects multiple symbols', async () => {
  let closed = 0
  let detected: any[] = [{
    rawValue: 'https://example.com/signin',
    cornerPoints: [{ x: 1, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 9 }, { x: 1, y: 9 }]
  }]
  vi.stubGlobal('createImageBitmap', async () => ({ close: () => { closed++ } }))
  vi.stubGlobal('BarcodeDetector', class {
    constructor(options: { formats: string[] }) { expect(options.formats).toEqual(['qr_code']) }
    async detect() { return detected }
  })
  const context = {
    playwright: {
      evaluateOnPlaywrightPage: async (_id: string, callback: Function, options: any) =>
        await callback(null, options.arg)
    }
  }
  try {
    expect(await decodeAuthQrWithPage('data:image/jpeg;base64,AAAA', { tab_id: '7' }, context))
      .toEqual({ payload: 'https://example.com/signin', bounds: { x: 1, y: 2, width: 7, height: 7 } })
    detected = [detected[0], detected[0]]
    expect(await decodeAuthQrWithPage('data:image/jpeg;base64,AAAA', { tab_id: '7' }, context))
      .toBeUndefined()
    expect(closed).toBe(2)
  } finally { vi.unstubAllGlobals() }
})

test('page QR fallback suppresses evaluation errors and invalid geometry', async () => {
  const original = await originalDocumentation()
  for (const answer of [null, { payload: 'x', points: [{ x: 1, y: 1 }] }, Error('blocked')]) {
    async function exercise(run: Function) {
      return await run('data:image/jpeg;base64,AAAA', { tab_id: '7' }, {
        playwright: { evaluateOnPlaywrightPage: async () => {
          if (answer instanceof Error) throw answer
          return answer
        } }
      })
    }
    expect(await exercise(decodeAuthQrWithPage)).toEqual(await exercise(original.baselineAuthPageQrDecode))
  }
})
