import { createCUASession } from './session.js'
import { decorateBrowserTab } from './tab-adapter.js'
import type { SessionBrowsers } from './browser-session.js'
import type { MacComputer, SessionHost } from './computer-session.js'

export interface BrowserSetupOptions {
  decorateTab: typeof decorateBrowserTab
  environment: string | undefined
  undocumentedApiMembers: string[]
  excludedDocumentation: string[]
}
export interface CUARuntimeDependencies {
  loadBrowserSetup(): Promise<
    (options: BrowserSetupOptions) => Promise<{ browsers: SessionBrowsers }>
  >
  loadComputer(): Promise<MacComputer>
  getHost?: (() => SessionHost | undefined) | undefined
  platform?: string | undefined
}
/** Configuration and concurrent loading seam; concrete default loaders are still pending. */
export async function createConfiguredCUASession(
  options: { browser?: boolean; computer?: boolean } = {},
  dependencies: CUARuntimeDependencies
): ReturnType<typeof createCUASession> {
  // The Node REPL sandbox deliberately has no `process` global. The candidate
  // runtime currently targets macOS; its CLI host validates that platform.
  if ((dependencies.platform ?? 'darwin') !== 'darwin') {
    throw new Error('CUA runtime currently supports macOS only.')
  }
  const getHost =
    dependencies.getHost ??
    (() => (globalThis as typeof globalThis & { nodeRepl?: SessionHost }).nodeRepl)
  const initialHost = getHost()
  const [agent, computer] = await Promise.all([
    options.browser !== false
      ? dependencies.loadBrowserSetup().then((setup) => {
          const environment = initialHost?.env?.CUA_REPL_BROWSER_ENV
          if (
            environment !== undefined &&
            !['codex-app', 'training', 'cloud', 'orbit'].includes(environment)
          ) {
            throw new Error('Invalid CUA_REPL_BROWSER_ENV')
          }
          const excludedDocumentation = ['tab-claiming-chrome', 'tab-mentions-iab']
          if ((getHost()?.env?.TINYSKY_ALT_INITIALIZE_DOCS ?? 'core-cua-repl') === 'core-cua-repl')
            excludedDocumentation.push('confirmations')
          return setup({
            decorateTab: decorateBrowserTab,
            environment,
            undocumentedApiMembers: ['Tab.ax'],
            excludedDocumentation
          })
        })
      : undefined,
    options.computer !== false ? dependencies.loadComputer() : undefined
  ])
  return createCUASession({ agent, computer, getHost })
}
