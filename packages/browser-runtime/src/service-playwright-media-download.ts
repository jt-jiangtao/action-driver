interface Params {
  tab_id: number
  selector: string
  timeout_ms?: number | undefined
}
interface Context {
  downloads: {
    withDownload<T>(id: number, run: () => Promise<T>): Promise<T>
    enableMediaDownload(id: number, url: string, frameId: string): Promise<() => Promise<unknown>>
    waitForDownload(id: number, timeoutMs: number): Promise<{ filename: string }>
  }
  security: { ensureDownloadSourcePolicyAllowed(id: number): Promise<unknown> }
  playwright: {
    evaluateOnPlaywrightSelectorWithTarget(
      id: number,
      selector: string,
      page: (element: any) => unknown,
      options: Record<string, unknown>
    ): Promise<{ result: string; frameIdentity?: { frameId: string } | null }>
    evaluateOnPlaywrightSelector(
      id: number,
      selector: string,
      page: (element: any, injected: any, url: string) => unknown,
      options: Record<string, unknown>
    ): Promise<unknown>
  }
}
export async function downloadLocatorMedia(params: Params, context: Context) {
  const id = Number(params.tab_id)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  return await context.downloads.withDownload(id, async () => {
    await context.security.ensureDownloadSourcePolicyAllowed(id)
    const timeoutMs = Math.min(
        Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 120000),
        120000
      ),
      deadlineMs = Date.now() + timeoutMs
    const remaining = () => {
      const left = deadlineMs - Date.now()
      if (left <= 0) throw Error(`Timed out after ${timeoutMs}ms downloading media.`)
      return left
    }
    const { result: url, frameIdentity } =
      await context.playwright.evaluateOnPlaywrightSelectorWithTarget(
        id,
        params.selector,
        (element: any) => {
          element.scrollIntoView({ block: 'center', inline: 'nearest' })
          const source =
            element.closest?.('img, video, source, a[href]') ??
            element.querySelector?.('img, video, source, a[href]') ??
            element
          const read = (node: any, key: string) => {
            if (key === 'src' && node.getAttribute('src')?.trim() === '') return null
            const value = node[key]
            return typeof value === 'string' && value.length > 0 ? value : null
          }
          const url =
            read(source, 'currentSrc') ?? read(source, 'src') ?? read(source, 'href') ?? ''
          if (!url) throw Error('Matched element does not expose a downloadable URL')
          return url
        },
        { includeFrameIdentity: true, deadlineMs, timeoutMs: remaining() }
      )
    if (frameIdentity == null) throw Error('Could not determine the media frame')
    remaining()
    const release = await context.downloads.enableMediaDownload(id, url, frameIdentity.frameId)
    try {
      await context.playwright.evaluateOnPlaywrightSelector(
        id,
        params.selector,
        (element: any, _injected: any, url: string) => {
          const link = element.ownerDocument.createElement('a')
          link.href = url
          link.download = url.split('/').pop()?.split('?')[0] || 'download'
          link.rel = 'noopener'
          link.style.display = 'none'
          element.ownerDocument.body.appendChild(link)
          link.click()
          link.remove()
          return true
        },
        { arg: url, deadlineMs, timeoutMs: remaining() }
      )
      return { path: (await context.downloads.waitForDownload(id, remaining())).filename }
    } finally {
      await release()
    }
  })
}
