import { normalizeAuthQrCode } from './service-auth-qr.js'

interface PageQrContext {
  playwright: {
    evaluateOnPlaywrightPage(
      tabId: string,
      evaluate: (element: unknown, input: { screenshotUrl: string }) => Promise<unknown>,
      options: { arg: { screenshotUrl: string }; isolatedWorld: true; timeoutMs: number | undefined }
    ): Promise<unknown>
  }
}
interface DetectedQr {
  payload: string
  points: Array<{ x: number; y: number }>
}
/** Browser BarcodeDetector fallback; the wasm decoder is a separately versioned boundary. */
export async function decodeAuthQrWithPage(
  screenshotUrl: string,
  params: { tab_id: string; timeout_ms?: number },
  context: PageQrContext
) {
  try {
    const decoded = await context.playwright.evaluateOnPlaywrightPage(
      params.tab_id,
      async (_element, input) => {
        const Detector = (globalThis as typeof globalThis & {
          BarcodeDetector?: new (options: { formats: string[] }) => {
            detect(bitmap: ImageBitmap): Promise<Array<{
              rawValue: string
              cornerPoints?: Array<{ x: number; y: number }>
              boundingBox?: { x: number; y: number; width: number; height: number }
            }>>
          }
        }).BarcodeDetector
        if (Detector == null) return undefined
        const encoded = input.screenshotUrl.split(',', 2)[1]
        if (encoded == null) return undefined
        const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
        try {
          const codes = await new Detector({ formats: ['qr_code'] }).detect(bitmap)
          if (codes.length === 0) return null
          if (codes.length !== 1) return undefined
          const code = codes[0]
          if (code == null || code.rawValue.length === 0) return undefined
          const points = code.cornerPoints != null && code.cornerPoints.length >= 4
            ? code.cornerPoints
            : code.boundingBox == null
              ? null
              : [
                  { x: code.boundingBox.x, y: code.boundingBox.y },
                  { x: code.boundingBox.x + code.boundingBox.width, y: code.boundingBox.y },
                  { x: code.boundingBox.x + code.boundingBox.width, y: code.boundingBox.y + code.boundingBox.height },
                  { x: code.boundingBox.x, y: code.boundingBox.y + code.boundingBox.height }
                ]
          return points == null ? undefined : { payload: code.rawValue, points }
        } finally { bitmap.close() }
      },
      { arg: { screenshotUrl }, isolatedWorld: true, timeoutMs: params.timeout_ms }
    ) as DetectedQr | null | undefined
    return decoded == null ? decoded : normalizeAuthQrCode(decoded.payload, decoded.points) ?? undefined
  } catch { return undefined }
}
