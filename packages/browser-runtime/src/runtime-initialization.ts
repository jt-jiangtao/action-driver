import { createDisplaySideEffect } from './display.js'
import type { ApiManifest } from './api-view.js'

export interface RuntimeSetupOptions {
  environment?: string | null | undefined
  undocumentedApiMembers?: string[] | undefined
  excludedDocumentation?: string[] | undefined
  decorateTab?: ((tab: object) => void) | undefined
}
interface SetupResult {
  apiManifest: ApiManifest
  disabledMemberIds: string[]
}
interface BrowserServiceRequest {
  method: 'setup' | 'execute'
  params: unknown
}
interface TrustedBrowserHost {
  rpc(service: 'browser', request: BrowserServiceRequest): Promise<unknown>
  emitImage(bytes: Uint8Array): void | Promise<void>
}
export interface RuntimeFactoryOptions {
  apiManifest: ApiManifest
  disabledMemberIds: Set<string>
  decorateTab: RuntimeSetupOptions['decorateTab']
  displaySideEffect: (value: unknown) => Promise<void>
  executeAgentCommand: (input: Record<string, unknown>) => Promise<unknown>
}
/** Initialize the composed Browser/Tab client through the trusted service. */
export async function initializeBrowserRuntime<T>(
  options: RuntimeSetupOptions = {},
  createAgent: (options: RuntimeFactoryOptions) => T
): Promise<Awaited<T>> {
  const host = (globalThis as typeof globalThis & { nodeRepl?: TrustedBrowserHost }).nodeRepl
  if (host == null || typeof host.rpc !== 'function') {
    throw new Error('Browser use requires a trusted Node REPL browser service')
  }
  // The host supplies a standalone RPC function; retain it across later host changes.
  const rpc = host.rpc
  const { apiManifest, disabledMemberIds } = (await rpc('browser', {
    method: 'setup',
    params: {
      environment: options.environment ?? 'codex-app',
      undocumentedApiMembers: options.undocumentedApiMembers,
      excludedDocumentation: options.excludedDocumentation
    }
  })) as SetupResult
  return await createAgent({
    apiManifest,
    decorateTab: options.decorateTab,
    disabledMemberIds: new Set(disabledMemberIds),
    displaySideEffect: createDisplaySideEffect(
      {
        displayImage: (bytes) => host.emitImage(bytes),
        displayValue: (value) => console.log(value)
      },
      100000
    ),
    executeAgentCommand: (params) => rpc('browser', { method: 'execute', params })
  })
}
