import type { ApiManifest } from './api-view.js'

export interface BrowserHostSetup {
  environment: string
  undocumentedApiMembers?: string[] | undefined
  excludedDocumentation?: string[] | undefined
}

/** Only an Action-Driver-owned host is accepted by the candidate client. */
export interface ProductBrowserHost {
  setup(options: BrowserHostSetup): Promise<{ apiManifest: ApiManifest; disabledMemberIds: string[] }>
  execute(command: Record<string, unknown>): Promise<unknown>
  displayImage(bytes: Uint8Array): void | Promise<void>
  close(): Promise<void>
}

/** Idempotent close and a fail-closed command boundary for injected hosts. */
export function createGuardedBrowserHost(host: ProductBrowserHost): ProductBrowserHost {
  let closed = false
  let closing: Promise<void> | undefined
  const assertOpen = () => {
    if (closed) throw new Error('BROWSER_HOST_CLOSED')
  }
  return {
    async setup(options) {
      assertOpen()
      return host.setup(options)
    },
    async execute(command) {
      assertOpen()
      return host.execute(command)
    },
    displayImage(bytes) {
      assertOpen()
      return host.displayImage(bytes)
    },
    close() {
      if (!closing) {
        closed = true
        closing = host.close()
      }
      return closing
    }
  }
}
