import { tabCapabilityFactories, browserCapabilityFactories } from './capability-registry.js'
import { TabControls } from './tab-controls.js'
import { BrowserControls } from './browser-controls.js'
import { PlaywrightAPI } from './playwright.js'
import { AXAPI, CUAAPI, DomCUAAPI, ContentAPI, TabClipboardAPI, TabDevAPI } from './tab-apis.js'
import { Documentation } from './browser-agent.js'
import { TabsControls, BrowserUserControls } from './tab-collections.js'
import { Capabilities } from './capabilities.js'
import type {
  Capability,
  CapabilityInfo,
  CapabilityDocumentation,
  TabCapabilityOptions,
  BrowserCapabilityOptions
} from './capabilities.js'
import type { AgentTransport } from './transport.js'
import type { Scope } from './locator.js'

type TabFactories = ReadonlyMap<string, (options: TabCapabilityOptions) => Capability>
type BrowserFactories = ReadonlyMap<string, (options: BrowserCapabilityOptions) => Capability>
interface TabOptions {
  browserId: string
  tabPayload?: { id?: string }
  transport?: AgentTransport
  documentation?: CapabilityDocumentation
  capabilities?: CapabilityInfo[] | null | undefined
  tabFactories?: TabFactories
}
/** Complete Tab composition with overridable capability registrations. */
export class ComposedTab extends TabControls {
  declare playwright: PlaywrightAPI
  declare dom_cua: DomCUAAPI
  declare cua: CUAAPI
  declare ax: AXAPI
  declare content: ContentAPI
  declare clipboard: TabClipboardAPI
  declare dev: TabDevAPI
  declare capabilities: Capabilities
  constructor({
    browserId,
    tabPayload,
    transport,
    documentation,
    capabilities,
    tabFactories = tabCapabilityFactories
  }: TabOptions) {
    super({
      browserId,
      ...(tabPayload === undefined ? {} : { tabPayload }),
      ...(transport === undefined ? {} : { transport })
    })
    const scope = { browserId, tabId: this.id, transport } as Scope
    this.playwright = new PlaywrightAPI(scope)
    this.dom_cua = new DomCUAAPI(scope)
    this.cua = new CUAAPI(scope)
    this.ax = new AXAPI(scope)
    this.content = new ContentAPI(scope)
    this.clipboard = new TabClipboardAPI(scope)
    this.dev = new TabDevAPI(scope)
    const selected: Record<string, Capability> = {}
    for (const info of capabilities ?? []) {
      const create = tabFactories.get(info.id)
      if (create != null)
        Object.assign(selected, {
          [info.id]: create({ ...scope, documentation: documentation!, info })
        })
    }
    this.capabilities = new Capabilities(selected)
  }
}
interface BrowserOptions {
  browserId: string
  transport: AgentTransport
  onBrowserUsed?: (() => void) | undefined
  capabilities?: { browser?: CapabilityInfo[] | null; tab?: CapabilityInfo[] | null } | null
  browserFactories?: BrowserFactories
  tabFactories?: TabFactories
}
/** Browser collections and concrete capabilities with overridable registries. */
export class ComposedBrowser extends BrowserControls {
  declare capabilities: Capabilities
  declare tabs: TabsControls<ComposedTab>
  declare user: BrowserUserControls<ComposedTab>
  constructor({
    browserId,
    transport,
    onBrowserUsed,
    capabilities,
    browserFactories = browserCapabilityFactories,
    tabFactories = tabCapabilityFactories
  }: BrowserOptions) {
    super({ browserId, transport, ...(onBrowserUsed === undefined ? {} : { onBrowserUsed }) })
    const documentation = new Documentation(transport)
    const selected: Record<string, Capability> = {}
    for (const info of capabilities?.browser ?? []) {
      const create = browserFactories.get(info.id)
      if (create != null) selected[info.id] = create({ browserId, documentation, info, transport })
    }
    this.capabilities = new Capabilities(selected)
    const createTab = (tabPayload: { id?: string }) =>
      new ComposedTab({
        browserId,
        transport,
        documentation,
        tabPayload,
        capabilities: capabilities?.tab,
        tabFactories
      })
    this.tabs = new TabsControls({ browserId, transport, createTab })
    this.user = new BrowserUserControls({ browserId, transport, createTab })
  }
}
