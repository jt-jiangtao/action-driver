import { createConfiguredCUASession } from './runtime-factory.js'
import type { SessionBrowsers } from './browser-session.js'
/** Loads candidate packages only; original vendor and production loaders remain separate. */
export function createTinyskyAlt(
  options: { browser?: boolean; computer?: boolean } = {}
): ReturnType<typeof createConfiguredCUASession> {
  return createConfiguredCUASession(options, {
    loadBrowserSetup: async () => {
      const { setupBrowserRuntime } = await import('@actiondriver/browser-runtime')
      return async (options) => {
        const agent = await setupBrowserRuntime({
          ...options,
          // The view decorates Tab instances before exposing their session methods.
          decorateTab: (tab) =>
            options.decorateTab(tab as Parameters<typeof options.decorateTab>[0])
        })
        return agent as unknown as { browsers: SessionBrowsers }
      }
    },
    loadComputer: async () => (await import('@actiondriver/sky')).sky
  })
}
