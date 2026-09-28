import * as runtimeTypes from './index.js'
import { BrowserApiFactory } from './api-factory.js'
import { ComposedBrowser, ComposedTab } from './composition.js'
import { initializeBrowserRuntime } from './runtime-initialization.js'
import type { RuntimeSetupOptions } from './runtime-initialization.js'
/** Default client bootstrap retains the trusted browser RPC host boundary. */
export function setupBrowserRuntime(options: RuntimeSetupOptions = {}) {
  return initializeBrowserRuntime(
    options,
    ({ apiManifest, disabledMemberIds, decorateTab, executeAgentCommand, displaySideEffect }) =>
      new BrowserApiFactory({
        apiManifest,
        disabledMemberIds,
        runtimeTypes,
        tabType: ComposedTab,
        decorateTab,
        createBrowser: ({ capabilities, ...options }) =>
          new ComposedBrowser({
            ...options,
            ...(capabilities === undefined
              ? {}
              : {
                  capabilities: capabilities as Exclude<
                    ConstructorParameters<typeof ComposedBrowser>[0]['capabilities'],
                    undefined
                  >
                })
          })
      }).createAgent({ executeAgentCommand, displaySideEffect })
  )
}
