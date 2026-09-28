import type { AgentTransport } from './transport.js'
import { dispatch } from './protocol.js'
export interface BrowserInfo {
  id: string
  name: string
  type: 'iab' | 'extension' | 'cdp'
  [key: string]: unknown
}
export interface CreateBrowserOptions {
  browserInfo: BrowserInfo
  onBrowserUsed: () => void
  transport: AgentTransport
}
export interface BrowserFactoryOptions<T> {
  createBrowser: (options: CreateBrowserOptions) => T
  onBrowserUsed?: ((info: BrowserInfo) => void) | undefined
  transport: AgentTransport
}
export class Documentation {
  #transport: AgentTransport
  constructor(transport: AgentTransport) {
    this.#transport = transport
  }
  async get(name: string) {
    return (await dispatch(this.#transport, 'get_documentation', { name })) as string
  }
}
export class Browsers<T = unknown> {
  #create: BrowserFactoryOptions<T>['createBrowser']
  #used: BrowserFactoryOptions<T>['onBrowserUsed']
  #transport: AgentTransport
  constructor({ createBrowser, onBrowserUsed, transport }: BrowserFactoryOptions<T>) {
    this.#create = createBrowser
    this.#used = onBrowserUsed
    this.#transport = transport
  }
  async list() {
    return (await dispatch(this.#transport, 'list_browsers')) as BrowserInfo[]
  }
  async get(id: string): Promise<Awaited<T>> {
    if (!id) throw new Error('browsers.get requires a browser id')
    return await this.#make((await dispatch(this.#transport, 'get_browser', { id })) as BrowserInfo)
  }
  async getDefault(): Promise<Awaited<T>> {
    return await this.#make((await dispatch(this.#transport, 'get_default_browser')) as BrowserInfo)
  }
  async getForUrl(url: string): Promise<Awaited<T>> {
    return await this.#make(
      (await dispatch(this.#transport, 'get_browser_for_url', { url })) as BrowserInfo
    )
  }
  #make(browserInfo: BrowserInfo) {
    this.#used?.(browserInfo)
    return this.#create({
      browserInfo,
      onBrowserUsed: () => this.#used?.(browserInfo),
      transport: this.#transport
    })
  }
}
export class Agent<T = unknown> {
  documentation: Documentation
  browsers: Browsers<T>
  constructor({ createBrowser, onBrowserUsed, transport }: BrowserFactoryOptions<T>) {
    if (!transport) throw new Error('Agent requires a transport instance')
    this.documentation = new Documentation(transport)
    this.browsers = new Browsers({ createBrowser, onBrowserUsed, transport })
  }
}
