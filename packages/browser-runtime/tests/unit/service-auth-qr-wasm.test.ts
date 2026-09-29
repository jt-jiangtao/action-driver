// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { decodeAuthQrWithWasm } from '../../src/service-auth-qr-wasm'
import { originalDocumentation } from '../original-service'

const screenshot = 'data:image/jpeg;base64,QUJD'
const position = {
  topLeft: { x: 1, y: 2 }, topRight: { x: 8, y: 2 },
  bottomRight: { x: 8, y: 9 }, bottomLeft: { x: 1, y: 9 }
}
function fixture(results: unknown[]) {
  const readBytes = vi.fn(async () => Uint8Array.of(1, 2, 3))
  const prepareZXingModule = vi.fn(() => undefined)
  const readBarcodes = vi.fn(async () => results)
  return {
    context: { filesystem: { readBytes } },
    decoder: { prepareZXingModule, readBarcodes },
    readBytes, prepareZXingModule, readBarcodes
  }
}
test('WASM QR reader pins bytes, parses one valid symbol and prepares only once', async () => {
  const f = fixture([{ isValid: true, text: 'https://example.com/signin', position }])
  const expected = { payload: 'https://example.com/signin', bounds: { x: 1, y: 2, width: 7, height: 7 } }
  expect(await decodeAuthQrWithWasm(screenshot, f.context, f.decoder)).toEqual(expected)
  expect(await decodeAuthQrWithWasm(screenshot, f.context, f.decoder)).toEqual(expected)
  expect(f.readBytes).toHaveBeenCalledTimes(1)
  expect(f.prepareZXingModule).toHaveBeenCalledTimes(1)
  const bytes = f.prepareZXingModule.mock.calls[0]?.[0].overrides.wasmBinary as ArrayBuffer
  expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3])
  expect(f.readBarcodes).toHaveBeenCalledWith(Uint8Array.of(65, 66, 67), {
    formats: ['QRCode'], maxNumberOfSymbols: 2
  })
})
test('WASM QR reader distinguishes no result from fallback-needed results', async () => {
  for (const [results, expected] of [
    [[], null],
    [[{ isValid: false, text: 'x', position }], undefined],
    [[{ isValid: true, text: 'x', position }, { isValid: true, text: 'y', position }], undefined]
  ] as const) {
    const f = fixture(results as unknown[])
    expect(await decodeAuthQrWithWasm(screenshot, f.context, f.decoder)).toBe(expected)
  }
  const broken = fixture([])
  broken.readBytes.mockRejectedValueOnce(Error('missing wasm'))
  expect(await decodeAuthQrWithWasm(screenshot, broken.context, broken.decoder)).toBeUndefined()
  expect(broken.readBarcodes).not.toHaveBeenCalled()
})

test('pinned reader decodes a real QR image using the original WASM bytes', async () => {
  const png = await readFile(resolve('packages/browser-runtime/tests/fixtures/auth-qr.png'))
  const originalWasm = await readFile(resolve(
    'thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/zxing_reader.wasm'
  ))
  const dependencyWasm = await readFile(createRequire(import.meta.url).resolve(
    'zxing-wasm/reader/zxing_reader.wasm'
  ))
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  expect(sha(dependencyWasm)).toBe('0e8d688d71932ebb6b8b33f700d43d3cb997f59ed9cab3c05102d7f10288a392')
  expect(sha(dependencyWasm)).toBe(sha(originalWasm))
  const readBytes = vi.fn(async (url: URL) => await readFile(url))
  const host = { filesystem: { readBytes } }
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const decoded = await decodeAuthQrWithWasm(dataUrl, host)
  expect(await decodeAuthQrWithWasm(dataUrl, host)).toEqual(decoded)
  expect(readBytes).toHaveBeenCalledTimes(1)
  const original = await originalDocumentation()
  const baseline = await original.baselineDecodeQrWithWasmFixture(dataUrl, originalWasm)
  expect(decoded).toEqual(baseline)
  expect(decoded?.payload).toBe('https://example.com/signin')
  expect(decoded?.bounds.width).toBeGreaterThan(0)
  expect(decoded?.bounds.height).toBeGreaterThan(0)
})
