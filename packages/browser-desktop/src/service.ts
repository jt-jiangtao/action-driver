import type { ProductBrowserHost } from '@action-driver/browser-runtime'
import { readDesktopResource } from './resources.js'
import type { DesktopEnvironment } from './resources.js'

export interface BrowserDesktopServiceOptions {
  host: ProductBrowserHost
  environment: DesktopEnvironment
}
export interface BrowserDesktopService {
  setup(): ReturnType<ProductBrowserHost['setup']>
  execute(command: Record<string, unknown>): Promise<unknown>
  dispose(): Promise<void>
}

/** Separate desktop service lifecycle; capability implementation remains on the owned host. */
export function createBrowserDesktopService({ host, environment }: BrowserDesktopServiceOptions): BrowserDesktopService {
  let setupPromise: ReturnType<ProductBrowserHost['setup']> | undefined
  let closing: Promise<void> | undefined
  let closed = false
  return {
    async setup() {
      if (closed) throw new Error('BROWSER_DESKTOP_CLOSED')
      setupPromise ??= host.setup({ environment })
      return setupPromise
    },
    async execute(command: Record<string, unknown>) {
      if (closed) throw new Error('BROWSER_DESKTOP_CLOSED')
      if (!setupPromise) throw new Error('BROWSER_DESKTOP_NOT_SETUP')
      await setupPromise
      if (closed) throw new Error('BROWSER_DESKTOP_CLOSED')
      if (command.type === 'tab_browser_auth_handoff')
        await readDesktopResource(environment, 'browserAuthSafetyPrecheck.md')
      return host.execute(command)
    },
    dispose() {
      if (!closing) {
        closed = true
        closing = (async () => {
          if (setupPromise) await setupPromise.catch(() => {})
          await host.close()
        })()
      }
      return closing
    }
  }
}
