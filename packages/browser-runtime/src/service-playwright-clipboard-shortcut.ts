import type { PlaywrightInput } from './service-playwright-input.js'
import { pastePage, runClipboardPageAction } from './service-playwright-paste.js'
import { copyOrCutPage, commitVirtualCut } from './service-playwright-copy.js'
import type { ClipboardItemWire } from './service-clipboard.js'
import type { CdpTarget } from './service-cdp-execution.js'
interface Focus {
  target: CdpTarget
  executionContextId?: number | undefined
  inputTargetToken?: string | undefined
}
interface Cdp {
  callTarget(target: CdpTarget, method: string, params: Record<string, unknown>): Promise<any>
  targetForFrameOrAttach?(id: number, frameId: string): Promise<CdpTarget | null>
}
interface Clipboard {
  runExclusive<T>(run: () => Promise<T>): Promise<T>
  ensurePageClipboard(cdp: unknown, target: CdpTarget): Promise<unknown>
  read(): ClipboardItemWire[]
  write(items: ClipboardItemWire[], command: string): unknown
}
interface Context {
  playwright: PlaywrightInput
  cdp: Cdp
  clipboard: Clipboard
}
const protectedCredentialFieldPolicy = {
  attributes: ['type', 'autocomplete', 'id', 'name', 'placeholder', 'aria-label', 'title'],
  pattern:
    'user[-_ ]?name|e[-_ ]?mail|one[-_ ]?time[-_ ]?code|password|passcode|passwd|\\botp\\b|\\b(?:2fa|mfa)\\b|phone|mobile|\\btel\\b'
}
const focusedFrameExpression = `(() => {
  const focusedFrameElementInRoot = (root) => {
    const active = root.activeElement;
    if (active == null) return null;
    const activeWindow = active.ownerDocument.defaultView ?? window;
    if (active instanceof activeWindow.HTMLElement && active.shadowRoot != null)
      return focusedFrameElementInRoot(active.shadowRoot);
    if (
      active instanceof activeWindow.HTMLIFrameElement ||
      active instanceof activeWindow.HTMLFrameElement
    ) {
      try {
        const frameDocument =
          active.contentDocument ?? active.contentWindow?.document ?? null;
        if (frameDocument != null)
          return focusedFrameElementInRoot(frameDocument);
      } catch {}
      return active;
    }
    return null;
  };
  return focusedFrameElementInRoot(document);
})()`
/** Resolve the active native clipboard target across focus-owned frames. */
export async function focusedClipboardTarget(
  cdp: Cdp,
  id: number,
  initial: Focus = { target: { tabId: id } }
): Promise<Focus> {
  let current = initial
  const seen = new Set<string>()
  for (;;) {
    const target = current.target,
      key = `${target.sessionId ?? ''}:${target.targetId ?? ''}:${current.executionContextId ?? ''}`
    if (seen.has(key)) throw Error('Browser Use encountered a focused frame cycle')
    seen.add(key)
    const response = await cdp.callTarget(target, 'Runtime.evaluate', {
      contextId: current.executionContextId,
      expression: focusedFrameExpression,
      returnByValue: false
    })
    if (response.exceptionDetails != null)
      throw Error('Browser Use could not inspect the focused frame')
    const objectId = response.result.objectId
    if (objectId == null) return current
    let frameId: string | undefined
    try {
      frameId = (await cdp.callTarget(target, 'DOM.describeNode', { objectId })).node.frameId
    } finally {
      await cdp.callTarget(target, 'Runtime.releaseObject', { objectId }).catch(() => {})
    }
    if (frameId == null) return current
    const attached = await cdp.targetForFrameOrAttach?.(id, frameId)
    if (attached != null) {
      current = { target: attached }
      continue
    }
    const world = await cdp.callTarget(target, 'Page.createIsolatedWorld', {
      frameId,
      grantUniveralAccess: false,
      worldName: 'browser-use-virtual-clipboard'
    })
    current = { target, executionContextId: world.executionContextId }
  }
}
export async function performVirtualClipboardShortcut(
  action: 'paste' | 'paste-plain-text' | 'copy' | 'cut',
  id: number,
  context: Context,
  focus: () => Promise<Focus>,
  command = 'playwright_locator_press'
) {
  await context.clipboard.runExclusive(async () => {
    const prepared = await focus(),
      target = await focusedClipboardTarget(context.cdp, id, prepared)
    let args: { action: string; clipboardItems: ClipboardItemWire[]; cutToken?: string }
    switch (action) {
      case 'paste':
        args = { action, clipboardItems: context.clipboard.read() }
        break
      case 'paste-plain-text':
        args = { action: 'paste', clipboardItems: context.clipboard.read() }
        for (const item of args.clipboardItems)
          item.entries = item.entries.filter((entry) => entry.mime_type === 'text/plain')
        break
      case 'copy':
        args = { action, clipboardItems: [] }
        break
      case 'cut':
        args = { action, clipboardItems: [], cutToken: crypto.randomUUID() }
        break
      default:
        throw Error(`Browser Use encountered an unsupported clipboard shortcut: ${action}`)
    }
    const result = (await runClipboardPageAction({
      args: {
        ...args,
        protectedCredentialFieldPolicy,
        clipboardItems: args.clipboardItems.filter((item) => item.entries.length > 0),
        iabInputTargetToken: prepared.inputTargetToken
      },
      commandType: command,
      ctx: context,
      pageFunction: args.action === 'paste' ? pastePage : copyOrCutPage,
      tabId: id,
      target: target.target,
      executionContextId: target.executionContextId
    })) as { items?: ClipboardItemWire[]; cutToken?: string }
    if (args.action !== 'paste' && result.items != null) {
      context.clipboard.write(result.items, command)
      if (args.action === 'cut' && result.cutToken != null)
        await runClipboardPageAction({
          args: { cutToken: result.cutToken },
          commandType: command,
          ctx: context,
          pageFunction: commitVirtualCut as any,
          tabId: id,
          target: target.target,
          executionContextId: target.executionContextId
        })
    }
  })
}
