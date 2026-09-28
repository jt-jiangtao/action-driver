import { createApiView, disabledMembersForBrowser } from './api-view.js'
import type { ApiManifest } from './api-view.js'
import { Agent } from './browser-agent.js'
import type { CreateBrowserOptions, BrowserInfo } from './browser-agent.js'
import { FunctionAgentTransport } from './transport.js'
import type { AgentTransport } from './transport.js'

interface FactoryOptions<T> {
  apiManifest: ApiManifest
  disabledMemberIds: Set<string>
  runtimeTypes: Record<string, unknown>
  createBrowser: (options: {
    browserId: string
    capabilities: unknown
    onBrowserUsed: () => void
    transport: AgentTransport
  }) => T
  tabType?: abstract new (...args: never[]) => object
  decorateTab?: ((tab: object) => void) | undefined
}
/** Internal assembly; the complete Browser/Tab registry is supplied separately. */
export class BrowserApiFactory<T> {
  apiManifest: ApiManifest
  disabledMemberIds: Set<string>
  view: ReturnType<typeof createApiView>
  #construct: FactoryOptions<T>['createBrowser']
  constructor({
    apiManifest,
    disabledMemberIds,
    runtimeTypes,
    createBrowser,
    tabType,
    decorateTab
  }: FactoryOptions<T>) {
    this.apiManifest = apiManifest
    this.disabledMemberIds = disabledMemberIds
    this.view = createApiView(apiManifest, runtimeTypes, {
      ...(tabType === undefined ? {} : { tabType }),
      ...(decorateTab === undefined ? {} : { decorateTab })
    })
    this.#construct = createBrowser
  }
  createBrowser = ({ browserInfo, onBrowserUsed, transport }: CreateBrowserOptions): T => {
    const disabled = disabledMembersForBrowser(
      this.apiManifest,
      browserInfo as BrowserInfo & {
        apiSupportOverrides?: Record<string, boolean | null | undefined>
      },
      this.disabledMemberIds
    )
    return this.view(
      this.#construct({
        browserId: browserInfo.id,
        capabilities: browserInfo.capabilities,
        onBrowserUsed,
        transport
      }),
      disabled
    )
  }
  wrapAgent<A>(agent: A): A {
    return this.view(agent, this.disabledMemberIds)
  }
  createAgent(options: ConstructorParameters<typeof FunctionAgentTransport>[0]): Agent<T> {
    return this.wrapAgent(
      new Agent({
        createBrowser: this.createBrowser,
        transport: new FunctionAgentTransport(options)
      })
    )
  }
}
