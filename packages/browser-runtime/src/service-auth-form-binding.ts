export interface AuthSelectorBinding {
  domainAndRegistry: string
  frameId: string
  loaderId: string
  origin: string
  targetKey: string
  url: string
}
interface AuthFormRequest {
  tab_id: string
  timeout_ms?: number
  fields: Array<{ selector: string }>
  submit?: { selector: string } | null
  options?: Array<{ id: string; selector?: string | null }> | null
}
interface SelectorContext {
  playwright: {
    evaluateOnPlaywrightSelectorWithTarget(
      tabId: string,
      selector: string,
      evaluate: (element: Element) => string,
      options: { includeFrameIdentity: true; timeoutMs: number | undefined }
    ): Promise<{
      frameIdentity?: {
        domainAndRegistry?: string
        frameId: string
        loaderId: string
        url: string
      }
      result: string
      target: { tabId: number; sessionId?: string; targetId?: string }
    }>
  }
}
function origin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch { return null }
}
function sameDocument(left: AuthSelectorBinding, right: AuthSelectorBinding): boolean {
  return left.frameId === right.frameId && left.loaderId === right.loaderId && left.url === right.url
}
export async function captureAuthSelectorBinding(
  tabId: string,
  selector: string,
  timeoutMs: number | undefined,
  context: SelectorContext
): Promise<AuthSelectorBinding> {
  const { frameIdentity, result, target } =
    await context.playwright.evaluateOnPlaywrightSelectorWithTarget(
      tabId,
      selector,
      (element) => element.ownerDocument.defaultView?.location.href ?? window.location.href,
      { includeFrameIdentity: true, timeoutMs }
    )
  if (frameIdentity == null) throw Error('Browser auth frame has no document identity')
  const frameOrigin = origin(frameIdentity.url)
  if (frameOrigin == null) throw Error('Browser auth frame has no origin')
  if (frameIdentity.url !== result.split('#', 1)[0])
    throw Error('Browser auth frame URL mismatch')
  return {
    domainAndRegistry: frameIdentity.domainAndRegistry ?? '',
    frameId: frameIdentity.frameId,
    loaderId: frameIdentity.loaderId,
    origin: frameOrigin,
    targetKey: `${target.tabId}:${target.sessionId ?? ''}:${target.targetId ?? ''}`,
    url: frameIdentity.url
  }
}
export async function captureAuthFormBinding(
  request: AuthFormRequest,
  context: SelectorContext,
  fallbackSelector?: string
): Promise<AuthSelectorBinding | null> {
  try {
    const selectors = [
      ...request.fields.map(({ selector }) => selector),
      ...(request.submit == null ? [] : [request.submit.selector])
    ]
    if (selectors.length === 0) selectors.push(fallbackSelector ?? 'html')
    const bindings = await Promise.all(selectors.map((selector) =>
      captureAuthSelectorBinding(request.tab_id, selector, request.timeout_ms, context)))
    const first = bindings[0]
    return first != null && bindings.every((binding) =>
      binding.targetKey === first.targetKey &&
      binding.origin === first.origin && sameDocument(binding, first))
      ? first
      : null
  } catch { return null }
}
export async function captureAuthOptionBindings(
  request: AuthFormRequest,
  context: SelectorContext
): Promise<Map<string, AuthSelectorBinding> | null> {
  try {
    const bindings = new Map<string, AuthSelectorBinding>()
    await Promise.all((request.options ?? []).map(async ({ id, selector }) => {
      if (selector != null)
        bindings.set(id, await captureAuthSelectorBinding(
          request.tab_id, selector, request.timeout_ms, context))
    }))
    return bindings
  } catch { return null }
}
export async function revalidateAuthFormBinding(
  request: AuthFormRequest,
  previous: AuthSelectorBinding,
  context: SelectorContext,
  fallbackSelector?: string
): Promise<'locator_invalid' | 'page_changed' | 'origin_changed' | null> {
  const current = await captureAuthFormBinding(request, context, fallbackSelector)
  return current == null ? 'locator_invalid'
    : current.targetKey !== previous.targetKey ? 'page_changed'
      : current.origin !== previous.origin ? 'origin_changed'
        : sameDocument(previous, current) ? null : 'page_changed'
}
