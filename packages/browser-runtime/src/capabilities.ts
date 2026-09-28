import type { AgentTransport } from './transport.js'

export interface CapabilityInfo {
  id: string
  description: string
}
export interface CapabilityDocumentation {
  get(name: string): Promise<string>
}
export interface Capability {
  info: CapabilityInfo
}

/** Shared metadata and documentation routing; concrete capability commands are separate. */
export class BrowserCapability {
  constructor(
    public transport: AgentTransport,
    public browserId: string,
    public documentationApi: CapabilityDocumentation,
    public info: CapabilityInfo
  ) {}
  get id() {
    return this.info.id
  }
  async documentation() {
    return await this.documentationApi.get(`capabilities/browser/${this.id}`)
  }
}
export class TabCapability {
  constructor(
    public transport: AgentTransport,
    public browserId: string,
    public tabId: string,
    public documentationApi: CapabilityDocumentation,
    public info: CapabilityInfo
  ) {}
  get id() {
    return this.info.id
  }
  async documentation() {
    return await this.documentationApi.get(`capabilities/tab/${this.id}`)
  }
}
export class Capabilities<T extends Capability = Capability> {
  #items: Record<string, T>
  constructor(items: Record<string, T>) {
    this.#items = items
  }
  async get(id: string): Promise<T> {
    const capability = this.#items[id]
    if (!capability) throw new Error(`Capability is not available: ${id}`)
    return capability
  }
  async list(): Promise<CapabilityInfo[]> {
    return Object.values(this.#items).map((capability) => capability.info)
  }
}

export interface BrowserCapabilityOptions {
  browserId: string
  documentation: CapabilityDocumentation
  info: CapabilityInfo
  transport: AgentTransport
}
export interface TabCapabilityOptions extends BrowserCapabilityOptions {
  tabId: string
}
interface RegistrationOptions<Options, T> {
  capability: new (options: Options) => T
  info: CapabilityInfo
  internalOnly?: boolean | null | undefined
}
function registration<Options extends { info: CapabilityInfo }, T>({
  capability,
  info,
  internalOnly
}: RegistrationOptions<Options, T>) {
  return {
    capability,
    create: (options: Omit<Options, 'info'>) => new capability({ ...options, info } as Options),
    id: info.id,
    info,
    ...(internalOnly == null ? {} : { internalOnly })
  }
}
export function browserRegistration<T>(options: RegistrationOptions<BrowserCapabilityOptions, T>) {
  return registration(options)
}
export function tabRegistration<T>(options: RegistrationOptions<TabCapabilityOptions, T>) {
  return registration(options)
}
