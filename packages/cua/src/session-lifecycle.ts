import { createDocumentationReader } from './documentation.js'
import type { SessionHost } from './computer-session.js'
import type { SessionBrowser } from './browser-session.js'

interface EmitOptions {
  emit?: boolean
  browser?: SessionBrowser | undefined
}
/** Shared documentation ownership and output queue for all enabled CUA surfaces. */
export function createSessionLifecycle(getHost: () => SessionHost | undefined) {
  const browserDocs = new Map<string, Promise<string>>()
  const docs = createDocumentationReader({ getRequestMeta: () => getHost()?.requestMeta })
  let coreText: string | undefined,
    coreOwner: unknown,
    emittedBrowserApis = false
  let queue: Promise<void> = Promise.resolve()
  const emittedBrowserDocs = new Map<string, { text: string; owner: unknown }>()
  function enqueue(
    operation: (write: NonNullable<SessionHost['write']>, metadata: unknown) => Promise<void>
  ) {
    const host = getHost()
    const write = host?.write?.bind(host)
    if (write === undefined) return Promise.resolve()
    const metadata = host?.requestMeta
    const pending = queue.then(() => operation(write, metadata))
    queue = pending.catch(() => {})
    return pending
  }
  function emit(state?: unknown, options?: EmitOptions) {
    return enqueue(async (write, metadata) => {
      const browser = options?.browser
      let core = '',
        apis = '',
        selected = ''
      if (coreText === undefined) {
        const source = getHost()?.env?.TINYSKY_ALT_INITIALIZE_DOCS ?? 'core-cua-repl'
        core = await docs.readDocumentation(source)
        if (source === 'core-cua-repl')
          core += '\n' + (await docs.readComputerUseConfirmationPolicy())
      }
      if (browser !== undefined) {
        const text = await browserDocs.get(browser.browserId)
        if (!emittedBrowserApis) apis = await docs.readDocumentation('other-browser-apis')
        if (text !== undefined && !emittedBrowserDocs.has(browser.browserId)) selected = text
      }
      let output = ''
      if (options?.emit !== false)
        output = typeof state === 'string' ? state : (JSON.stringify(state) ?? '')
      if (core !== '') {
        await write(core, 'cua.core')
        coreOwner = metadata
      }
      coreText ??= core
      const text = [apis, selected].filter((value) => value !== '').join('\n\n')
      if (browser !== undefined && text !== '') {
        await write(text, `cua.browser.${browser.browserId}`)
        emittedBrowserDocs.set(browser.browserId, { text, owner: metadata })
      }
      if (browser !== undefined) emittedBrowserApis = true
      if (output !== '') await write(output, 'cua.state')
    })
  }
  function rewriteDocumentation() {
    return enqueue(async (write, metadata) => {
      if (coreText && !(metadata != null && metadata === coreOwner)) {
        await write(coreText, 'cua.core')
        coreOwner = metadata
      }
      for (const [id, item] of emittedBrowserDocs) {
        if (!(metadata != null && metadata === item.owner)) {
          await write(item.text, `cua.browser.${id}`)
          item.owner = metadata
        }
      }
    })
  }
  return { browserDocs, emit, rewriteDocumentation }
}
export type SessionLifecycle = ReturnType<typeof createSessionLifecycle>
