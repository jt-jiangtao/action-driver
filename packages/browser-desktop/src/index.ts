import { setupBrowserRuntime } from '@actiondriver/browser-runtime'
import type { ActionDriverBrowserHost, RuntimeSetupOptions } from '@actiondriver/browser-runtime'
import { readDesktopResource } from './resources.js'
import type { DesktopEnvironment } from './resources.js'

export interface BrowserDesktopOptions extends Omit<RuntimeSetupOptions, 'environment' | 'host'> {
  host: ActionDriverBrowserHost
  environment: DesktopEnvironment
}

/** The source client is byte-identical to browser-runtime's client, so use one implementation. */
export function setupBrowserDesktop(options: BrowserDesktopOptions) {
  if (!options?.host) throw new Error('BROWSER_HOST_UNAVAILABLE')
  const { host, environment } = options
  return setupBrowserRuntime({
    ...options,
    host: {
      setup: (setupOptions) => host.setup(setupOptions),
      async execute(command) {
        if (command.type === 'tab_browser_auth_handoff')
          await readDesktopResource(environment, 'browserAuthSafetyPrecheck.md')
        return host.execute(command)
      },
      displayImage: (bytes) => host.displayImage(bytes),
      close: () => host.close()
    }
  })
}

export { createBrowserDesktopService } from './service.js'
export { createBrowserDesktopSessionController } from './session-controller.js'
export type {
  BrowserDesktopHostSession,
  BrowserHostSnapshot,
  BrowserSessionActor,
  BrowserSessionCommand,
  BrowserSessionControl,
  BrowserSessionSnapshot,
  BrowserSessionStatus,
  BrowserSurface,
  BrowserTabSnapshot
} from './session-contract.js'
export { listDesktopResources, readDesktopResource } from './resources.js'
export type { DesktopEnvironment } from './resources.js'
