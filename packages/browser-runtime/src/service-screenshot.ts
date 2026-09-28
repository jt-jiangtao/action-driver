import type { BrowserCdp } from './service-cdp.js'
import type { CdpEvent } from './service-cdp-events.js'
interface Params {
  tab_id: number | string
  fullPage?: boolean
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
}
interface Context {
  cdp: Pick<BrowserCdp, 'call' | 'waitForEvent' | 'withInternalScreencast'>
  credentialObservationGate?: { observe<T>(run: () => Promise<T>, id: number): Promise<T> }
}
const format = 'jpeg',
  quality = 80
async function cssScale(id: number, context: Context) {
  try {
    const response = (await context.cdp.call(
      id,
      'Runtime.evaluate',
      { expression: 'window.devicePixelRatio', returnByValue: true },
      { telemetryAttrs: { 'browser_use.cdp.eval.kind': 'device_pixel_ratio' } }
    )) as { result?: { value?: unknown } }
    const ratio = response?.result?.value
    if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0) return 1 / ratio
  } catch {}
  return 1
}
const frameEvent = (event: CdpEvent) =>
  event.method === 'Page.screencastFrame' ||
  (event.method === 'Page.screencastVisibilityChanged' && event.params?.visible === false)
async function viewportStream(
  id: number,
  size: { height: number; width: number } | undefined,
  context: Context
) {
  const height = size == null ? undefined : Math.round(size.height),
    width = size == null ? undefined : Math.round(size.width)
  if (height != null && (height <= 0 || width == null || width <= 0)) return undefined
  return await context.cdp.withInternalScreencast(id, async (matches) => {
    const abort = new AbortController(),
      deadline = Date.now() + 2000
    const wait = () => {
      const result = context.cdp.waitForEvent(id, (event) => matches(event) && frameEvent(event), {
        signal: abort.signal,
        timeoutMessage: 'Timed out waiting for a viewport screencast frame.',
        timeoutMs: Math.max(1, deadline - Date.now())
      })
      void result.catch(() => {})
      return result
    }
    let pending = wait(),
      started = false
    try {
      started = true
      const start = Date.now() / 1000
      await context.cdp.call(id, 'Page.startScreencast', {
        everyNthFrame: 1,
        format,
        ...(height == null ? {} : { maxHeight: height, maxWidth: width }),
        quality
      })
      for (;;) {
        const event = await pending
        if (event == null || event.method !== 'Page.screencastFrame' || event.params == null)
          return undefined
        const session = event.params.sessionId
        if (typeof session !== 'number') return undefined
        const metadata = event.params.metadata,
          timestamp =
            typeof metadata === 'object' && metadata != null
              ? Reflect.get(metadata, 'timestamp')
              : undefined
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < start) {
          pending = wait()
          await context.cdp.call(id, 'Page.screencastFrameAck', { sessionId: session })
          continue
        }
        const data = event.params.data
        try {
          await context.cdp.call(id, 'Page.stopScreencast')
          started = false
        } finally {
          await context.cdp.call(id, 'Page.screencastFrameAck', { sessionId: session })
        }
        return typeof data === 'string' && data.length > 0 ? data : undefined
      }
    } catch {
      return undefined
    } finally {
      abort.abort()
      await pending.catch(() => {})
      if (started) await context.cdp.call(id, 'Page.stopScreencast').catch(() => {})
    }
  })
}
function crop(params: Params) {
  if (
    params.cropX == null ||
    params.cropY == null ||
    params.cropWidth == null ||
    params.cropHeight == null
  )
    return undefined
  if (params.cropWidth <= 0 || params.cropHeight <= 0)
    throw Error('tab_screenshot crop width and height must be positive')
  return {
    x: params.cropX,
    y: params.cropY,
    width: params.cropWidth,
    height: params.cropHeight,
    scale: 1
  }
}
async function screenshot(params: Params, context: Context, mode: 'css' | 'device') {
  const id = Number(params.tab_id),
    options: Record<string, unknown> = { format, quality },
    region = crop(params),
    scale = mode === 'device' ? 1 : await cssScale(id, context)
  if (region != null) {
    options.captureBeyondViewport = true
    options.clip = { ...region, scale }
  } else if (params.fullPage === true) {
    const { cssContentSize } = (await context.cdp.call(id, 'Page.getLayoutMetrics')) as {
      cssContentSize?: { x?: number; y?: number; width: number; height: number }
    }
    if (
      cssContentSize?.width == null ||
      cssContentSize.height == null ||
      cssContentSize.width <= 0 ||
      cssContentSize.height <= 0
    )
      throw Error(
        'Page.getLayoutMetrics returned no valid cssContentSize for full-page screenshot.'
      )
    options.captureBeyondViewport = true
    options.clip = {
      x: cssContentSize.x ?? 0,
      y: cssContentSize.y ?? 0,
      width: cssContentSize.width,
      height: cssContentSize.height,
      scale
    }
  } else {
    type Viewport = { pageX: number; pageY: number; clientWidth: number; clientHeight: number }
    let viewport: Viewport | undefined
    if (mode === 'css')
      viewport = (
        (await context.cdp.call(id, 'Page.getLayoutMetrics')) as { cssVisualViewport: Viewport }
      ).cssVisualViewport
    const stream =
      mode === 'device' || scale <= 1
        ? await viewportStream(
            id,
            viewport == null
              ? undefined
              : { height: viewport.clientHeight, width: viewport.clientWidth },
            context
          )
        : undefined
    if (stream != null) return { data: stream }
    viewport ??= (
      (await context.cdp.call(id, 'Page.getLayoutMetrics')) as { cssVisualViewport: Viewport }
    ).cssVisualViewport
    options.clip = {
      x: viewport.pageX,
      y: viewport.pageY,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      scale
    }
  }
  const result = (await context.cdp.call(id, 'Page.captureScreenshot', options, {
    preserveDebuggerOnTimeout: true,
    timeoutMs: mode === 'device' && region == null && params.fullPage !== true ? 2000 : 5000
  })) as { data?: string }
  if (typeof result.data !== 'string' || !result.data)
    throw Error(`Page.captureScreenshot returned no data for tab ${id}.`)
  return { data: result.data }
}
export async function captureTabScreenshot(
  params: Params,
  context: Context,
  mode: 'css' | 'device' = 'css'
) {
  const run = () => screenshot(params, context, mode)
  return context.credentialObservationGate == null
    ? await run()
    : await context.credentialObservationGate.observe(run, Number(params.tab_id))
}
