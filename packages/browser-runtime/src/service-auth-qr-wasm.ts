import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { normalizeAuthQrCode } from './service-auth-qr.js'

type Reader = Pick<typeof import('zxing-wasm/reader'), 'prepareZXingModule' | 'readBarcodes'>
type QrHost = { filesystem: { readBytes(url: URL): Promise<Uint8Array> } }

const prepared = new WeakMap<Reader, Promise<void>>()
const defaultReader: Reader = { prepareZXingModule, readBarcodes }
const require = createRequire(import.meta.url)

async function prepareReader(host: QrHost, reader: Reader): Promise<void> {
  let pending = prepared.get(reader)
  if (pending == null) {
    pending = (async () => {
      const wasmUrl = pathToFileURL(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))
      const bytes = await host.filesystem.readBytes(wasmUrl)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      await reader.prepareZXingModule({ overrides: { wasmBinary: copy.buffer } })
    })()
    prepared.set(reader, pending)
  }
  await pending
}

/** Decode with the same pinned reader WASM as the original service, before the page fallback. */
export async function decodeAuthQrWithWasm(
  screenshotUrl: string,
  host: QrHost,
  reader: Reader = defaultReader
) {
  try {
    await prepareReader(host, reader)
    const encoded = screenshotUrl.split(',', 2)[1]
    if (encoded == null) return undefined
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    const codes = await reader.readBarcodes(bytes, { formats: ['QRCode'], maxNumberOfSymbols: 2 })
    if (codes.length === 0) return null
    if (codes.length !== 1) return undefined
    const code = codes[0]
    return code?.isValid
      ? normalizeAuthQrCode(code.text, [
          code.position.topLeft, code.position.topRight,
          code.position.bottomRight, code.position.bottomLeft
        ]) ?? undefined
      : undefined
  } catch { return undefined }
}
