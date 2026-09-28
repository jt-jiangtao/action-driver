export interface AuthPageBinding {
  domainAndRegistry: string
  frameId: string
  loaderId: string
  securityOrigin: string
  url: string
}
interface AuthPageContext {
  cdp: {
    call(tabId: number, method: 'Page.getFrameTree'): Promise<{
      frameTree: { frame: {
        domainAndRegistry?: string
        id?: string
        loaderId?: string
        securityOrigin?: string
        url?: string
      } }
    }>
  }
}
function webOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}
export async function captureAuthPageBinding(
  tabId: string,
  expectedOrigin: string,
  context: AuthPageContext
): Promise<AuthPageBinding | 'origin_changed' | 'page_changed'> {
  const { frame } = (await context.cdp.call(Number(tabId), 'Page.getFrameTree')).frameTree
  if (webOrigin(frame.securityOrigin) !== expectedOrigin || webOrigin(frame.url) !== expectedOrigin)
    return 'origin_changed'
  if (!frame.id || !frame.loaderId || !frame.securityOrigin || !frame.url)
    return 'page_changed'
  return {
    domainAndRegistry: frame.domainAndRegistry ?? '',
    frameId: frame.id,
    loaderId: frame.loaderId,
    securityOrigin: frame.securityOrigin,
    url: frame.url
  }
}
export async function revalidateAuthPageBinding(
  tabId: string,
  expectedOrigin: string,
  binding: AuthPageBinding,
  context: AuthPageContext
): Promise<'origin_changed' | 'page_changed' | null> {
  const current = await captureAuthPageBinding(tabId, expectedOrigin, context)
  if (typeof current === 'string') return current
  return current.frameId === binding.frameId && current.loaderId === binding.loaderId &&
    current.url === binding.url ? null : 'page_changed'
}
