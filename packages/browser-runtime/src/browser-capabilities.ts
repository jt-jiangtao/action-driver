import { BrowserCapability } from './capabilities.js'
import type { BrowserCapabilityOptions } from './capabilities.js'
import {
  BrowserManagementCommands,
  BrowserVisibilityCommands,
  BrowserViewportCommands
} from './commands/browser-capability.js'
class ScopedBrowserCapability extends BrowserCapability {
  constructor({ browserId, documentation, info, transport }: BrowserCapabilityOptions) {
    super(transport, browserId, documentation, info)
  }
}
export type ManagementNamespace = Record<string, (...args: unknown[]) => Promise<unknown>>
export class ManagementBrowserCapability extends ScopedBrowserCapability {
  windows: ManagementNamespace
  tabs: ManagementNamespace
  tabGroups: ManagementNamespace
  bookmarks: ManagementNamespace
  constructor(options: BrowserCapabilityOptions) {
    super(options)
    this.windows = this.createNamespace('windows')
    this.tabs = this.createNamespace('tabs')
    this.tabGroups = this.createNamespace('tabGroups')
    this.bookmarks = this.createNamespace('bookmarks')
  }
  async getAuditTrail() {
    return BrowserManagementCommands.GetAuditTrail.ResultSchema.parse(
      await this.transport.send({
        command: BrowserManagementCommands.GetAuditTrail.create({ browser_id: this.browserId })
      })
    )
  }
  async invoke(namespace: string, method: string, ...args: unknown[]) {
    return BrowserManagementCommands.Call.ResultSchema.parse(
      await this.transport.send({
        command: BrowserManagementCommands.Call.create({
          args,
          browser_id: this.browserId,
          method,
          namespace
        })
      })
    ).value
  }
  createNamespace(namespace: string): ManagementNamespace {
    return new Proxy(
      {},
      {
        get: (_target, key) => {
          if (
            typeof key === 'string' &&
            key !== 'then' &&
            key !== 'toJSON' &&
            !(key in Object.prototype)
          )
            return (...args: unknown[]) => this.invoke(namespace, key, ...args)
        }
      }
    )
  }
}
export class VisibilityBrowserCapability extends ScopedBrowserCapability {
  async set(visible: boolean) {
    const response = await this.transport.send({
      command: BrowserVisibilityCommands.Set.create({ browser_id: this.browserId, visible })
    })
    BrowserVisibilityCommands.Set.ResultSchema.parse(response)
  }
  async get() {
    return BrowserVisibilityCommands.Get.ResultSchema.parse(
      await this.transport.send({
        command: BrowserVisibilityCommands.Get.create({ browser_id: this.browserId })
      })
    ).visible
  }
}
export class ViewportBrowserCapability extends ScopedBrowserCapability {
  async set(size: { width: number; height: number }) {
    const response = await this.transport.send({
      command: BrowserViewportCommands.Set.create({ browser_id: this.browserId, ...size })
    })
    BrowserViewportCommands.Set.ResultSchema.parse(response)
  }
  async reset() {
    const response = await this.transport.send({
      command: BrowserViewportCommands.Reset.create({ browser_id: this.browserId })
    })
    BrowserViewportCommands.Reset.ResultSchema.parse(response)
  }
}
