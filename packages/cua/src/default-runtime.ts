import { createConfiguredCUASession } from './runtime-factory.js'
import type { SessionBrowsers } from './browser-session.js'
import type { SessionHost, MacComputer } from './computer-session.js'
import type { ActionDriverBrowserHost } from '@actiondriver/browser-runtime'
import type { ActionDriverComputerHost } from '@actiondriver/sky'
import { randomUUID } from 'node:crypto'

export interface TinyskyOptions {
  browser?: boolean
  computer?: boolean
  browserHost?: ActionDriverBrowserHost
  computerHost?: ActionDriverComputerHost
  sessionId?: string
  sessionHost?: SessionHost
}
/** Assemble a CUA session from explicitly supplied ActionDriver hosts. */
export function createTinyskyAlt(
  options: TinyskyOptions = {}
): ReturnType<typeof createConfiguredCUASession> {
  if (options.browser !== false && !options.browserHost) throw new Error('BROWSER_HOST_UNAVAILABLE')
  if (options.computer !== false && !options.computerHost) throw new Error('SKY_HOST_UNAVAILABLE')
  const browserHost = options.browserHost
  return createConfiguredCUASession(options, {
    loadBrowserSetup: async () => {
      const { setupBrowserRuntime } = await import('@actiondriver/browser-runtime')
      return async (options) => {
        const agent = await setupBrowserRuntime({
          ...options,
          host: browserHost,
          // The view decorates Tab instances before exposing their session methods.
          decorateTab: (tab) =>
            options.decorateTab(tab as Parameters<typeof options.decorateTab>[0])
        })
        return agent as unknown as { browsers: SessionBrowsers }
      }
    },
    loadComputer: async () => {
      const { createActionDriverSky } = await import('@actiondriver/sky/actiondriver')
      return createActionDriverSky(options.computerHost!, {
        sessionId: options.sessionId ?? randomUUID()
      }) as unknown as MacComputer
    },
    getHost: () => ({
      ...options.sessionHost,
      env: { ...options.sessionHost?.env,
        CUA_REPL_BROWSER_ENV: options.sessionHost?.env?.CUA_REPL_BROWSER_ENV ?? 'training' }
    })
  })
}
