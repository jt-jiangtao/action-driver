import type { ApiManifest } from './api-view.js'

export interface BrowserServiceSetup {
  environment: 'codex-app' | 'training' | 'cloud' | 'orbit'
  undocumentedApiMembers?: string[] | undefined
  excludedDocumentation?: string[] | undefined
}
export interface BrowserServiceRuntime {
  apiManifest: ApiManifest
  disabledMemberIds: Set<string>
  executeAgentCommand(input: unknown): Promise<unknown>
}
interface ServiceBoundaries<Host> {
  prepareHost: () => Promise<Host>
  createRuntime: (
    options: BrowserServiceSetup,
    host: Host
  ) => BrowserServiceRuntime | Promise<BrowserServiceRuntime>
}
/** RPC state transitions; the native backend is assembled by the service entry. */
export function createBrowserService<Host>({
  prepareHost,
  createRuntime
}: ServiceBoundaries<Host>) {
  let current: Promise<BrowserServiceRuntime> | undefined
  const methods = {
    async setup({
      environment,
      undocumentedApiMembers,
      excludedDocumentation
    }: BrowserServiceSetup) {
      if (
        environment !== 'codex-app' &&
        environment !== 'training' &&
        environment !== 'cloud' &&
        environment !== 'orbit'
      ) {
        throw new Error('Invalid browser service environment')
      }
      current = prepareHost().then((host) =>
        createRuntime({ environment, undocumentedApiMembers, excludedDocumentation }, host)
      )
      const { apiManifest, disabledMemberIds } = await current
      return { apiManifest, disabledMemberIds: [...disabledMemberIds] }
    },
    async execute(input: unknown) {
      if (current == null) throw new Error('Browser runtime has not been initialized')
      return await (await current).executeAgentCommand(input)
    }
  }
  return async (request: { method: string; params: unknown }): Promise<unknown> => {
    const method = Object.getOwnPropertyDescriptor(methods, request.method)?.value
    if (typeof method !== 'function') throw new Error('Unsupported browser service request')
    return await method(request.params)
  }
}
