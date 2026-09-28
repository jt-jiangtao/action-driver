import { decodeAuthQrWithPage } from './service-auth-qr-page.js'
import { decodeAuthQrWithWasm } from './service-auth-qr-wasm.js'

type PageBindingStatus = 'origin_changed' | 'page_changed' | 'locator_invalid' | null
interface QrMonitorOptions {
  signal: AbortSignal
  initialPayload: string
  completeWhenQrCodeDisappears: boolean
  pageBindingStatus(): Promise<PageBindingStatus>
  scan(): Promise<{ payload: string } | null | undefined>
  publish(payload: string, disappeared?: boolean): void
  wait?(startedAt: number, signal: AbortSignal): Promise<void>
}
async function waitForNextScan(startedAt: number, signal: AbortSignal) {
  const remaining = 125 - (Date.now() - startedAt)
  if (remaining <= 0 || signal.aborted) return
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve() }, remaining)
    signal.addEventListener('abort', done, { once: true })
  })
}
/** Watch a QR region using an injected decoder; no credential payload is logged or retained. */
export async function monitorAuthQrCode(options: QrMonitorOptions): Promise<void> {
  let poll = 0
  let currentPayload = options.initialPayload
  let missing = 0
  let pageChanged = false
  options.publish(currentPayload)
  while (!options.signal.aborted) {
    const startedAt = Date.now()
    if (poll % 8 === 0) {
      try {
        const status = await options.pageBindingStatus()
        if (status !== null) {
          if (!options.completeWhenQrCodeDisappears || status !== 'page_changed') return
          pageChanged = true
        }
      } catch {
        missing = 0
        await (options.wait ?? waitForNextScan)(startedAt, options.signal)
        continue
      }
    }
    let detected: { payload: string } | null | undefined
    try { detected = await options.scan() } catch { detected = undefined }
    if (options.signal.aborted) return
    if (detected === undefined) missing = 0
    else if (detected !== null) {
      if (pageChanged) return
      currentPayload = detected.payload
      missing = 0
      options.publish(currentPayload)
    } else if (options.completeWhenQrCodeDisappears && ++missing >= 3) {
      try {
        const status = await options.pageBindingStatus()
        if (status !== null && status !== 'page_changed') return
      } catch {
        missing = 0
        await (options.wait ?? waitForNextScan)(startedAt, options.signal)
        continue
      }
      if (!options.signal.aborted) options.publish(currentPayload, true)
      return
    }
    poll++
    await (options.wait ?? waitForNextScan)(startedAt, options.signal)
  }
}

interface PageQrWatchOptions {
  tabId: string
  timeoutMs?: number
  initialPayload: string
  qrOnly: boolean
  pageBindingStatus(): Promise<PageBindingStatus>
  cdp: {
    call(
      tabId: number,
      method: 'Page.captureScreenshot',
      params: { format: 'jpeg'; fromSurface: true; optimizeForSpeed: true; quality: 80 },
      options: { preserveDebuggerOnTimeout: true; timeoutMs: 2000 }
    ): Promise<{ data: string }>
  }
  playwright: Parameters<typeof decodeAuthQrWithPage>[2]['playwright']
  filesystem?: { readBytes(url: URL): Promise<Uint8Array> }
  publish(payload: string, disappeared?: boolean): void
}
/** Poll fresh frames through the pinned WASM reader, then the page decoder when needed. */
export function startAuthQrPageWatch(options: PageQrWatchOptions): { stop(): void; done: Promise<void> } {
  const controller = new AbortController()
  const done = monitorAuthQrCode({
    signal: controller.signal,
    initialPayload: options.initialPayload,
    completeWhenQrCodeDisappears: options.qrOnly,
    pageBindingStatus: options.pageBindingStatus,
    publish: options.publish,
    scan: async () => {
      try {
        const frame = await options.cdp.call(
          Number(options.tabId),
          'Page.captureScreenshot',
          { format: 'jpeg', fromSurface: true, optimizeForSpeed: true, quality: 80 },
          { preserveDebuggerOnTimeout: true, timeoutMs: 2000 }
        )
        const screenshotUrl = `data:image/jpeg;base64,${frame.data}`
        const wasm = options.filesystem == null ? undefined
          : await decodeAuthQrWithWasm(screenshotUrl, { filesystem: options.filesystem })
        return wasm !== undefined ? wasm : await decodeAuthQrWithPage(
          screenshotUrl, { tab_id: options.tabId,
            ...(options.timeoutMs == null ? {} : { timeout_ms: options.timeoutMs }) },
          { playwright: options.playwright })
      } catch { return undefined }
    }
  }).catch(() => {})
  return { stop: () => controller.abort(), done }
}
