import { createDisplaySideEffect } from './display.js'
import type { ApiManifest } from './api-view.js'
import type { ProductBrowserHost } from './host-port.js'

export interface RuntimeSetupOptions {
  host?: ProductBrowserHost | undefined
  environment?: string | null | undefined
  undocumentedApiMembers?: string[] | undefined
  excludedDocumentation?: string[] | undefined
  decorateTab?: ((tab: object) => void) | undefined
}
export interface RuntimeFactoryOptions {
  apiManifest: ApiManifest
  disabledMemberIds: Set<string>
  decorateTab: RuntimeSetupOptions['decorateTab']
  displaySideEffect: (value: unknown) => Promise<void>
  executeAgentCommand: (input: Record<string, unknown>) => Promise<unknown>
}
/** Initialize the composed Browser/Tab client through an explicit owned host. */
export async function initializeBrowserRuntime<T>(
  options: RuntimeSetupOptions = {},
  createAgent: (options: RuntimeFactoryOptions) => T
): Promise<Awaited<T>> {
  const host = options.host
  if (host == null || typeof host.setup !== 'function' || typeof host.execute !== 'function')
    throw new Error('BROWSER_HOST_UNAVAILABLE')
  const { apiManifest, disabledMemberIds } = await host.setup({
    environment: options.environment ?? 'codex-app',
    undocumentedApiMembers: options.undocumentedApiMembers,
    excludedDocumentation: options.excludedDocumentation
  })
  return await createAgent({
    apiManifest,
    decorateTab: options.decorateTab,
    disabledMemberIds: new Set(disabledMemberIds),
    displaySideEffect: createDisplaySideEffect(
      {
        displayImage: (bytes) => host.displayImage(bytes),
        displayValue: (value) => console.log(value)
      },
      100000
    ),
    executeAgentCommand: (params) => host.execute(params)
  })
}
