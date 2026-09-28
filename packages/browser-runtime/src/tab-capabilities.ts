import { TabCapability } from './capabilities.js'
import type { TabCapabilityOptions } from './capabilities.js'
import { TabBotDetectionCommands } from './commands/structured.js'
import {
  TabBrowserAuthCommands,
  TabPageAssetsCommands,
  WebMcpListTools
} from './commands/capability.js'
import { prepareBrowserAuthRequest } from './browser-auth-request.js'
import type { BrowserAuthRequest } from './browser-auth-request.js'
import { createWebMcpSnapshot } from './webmcp-snapshot.js'
import type { z } from 'zod/v3'
class ScopedTabCapability extends TabCapability {
  constructor({ browserId, documentation, info, tabId, transport }: TabCapabilityOptions) {
    super(transport, browserId, tabId, documentation, info)
  }
}
export class BotDetectionTabCapability extends ScopedTabCapability {
  async report(input: {
    reason: z.infer<typeof TabBotDetectionCommands.Report.PayloadSchema>['reason']
  }) {
    const payload = TabBotDetectionCommands.Report.PayloadSchema.parse({
      ...input,
      browser_id: this.browserId,
      tab_id: this.tabId
    })
    return TabBotDetectionCommands.Report.ResultSchema.parse(
      await this.transport.send({ command: TabBotDetectionCommands.Report.create(payload) })
    )
  }
}
export class BrowserAuthTabCapability extends ScopedTabCapability {
  async request(input: BrowserAuthRequest) {
    const request = prepareBrowserAuthRequest(input, {
      browserId: this.browserId,
      tabId: this.tabId
    })
    const command = TabBrowserAuthCommands.Handoff.create({
      ...request,
      browser_id: this.browserId,
      tab_id: this.tabId
    })
    command.parse()
    return TabBrowserAuthCommands.Handoff.ResultSchema.parse(await this.transport.send({ command }))
  }
}
export type PageAssetsBundleOptions = Omit<
  z.input<typeof TabPageAssetsCommands.Bundle.PayloadSchema>,
  'browser_id' | 'tab_id'
>
export class PageAssetsTabCapability extends ScopedTabCapability {
  async list() {
    return TabPageAssetsCommands.List.ResultSchema.parse(
      await this.transport.send({
        command: TabPageAssetsCommands.List.create({
          browser_id: this.browserId,
          tab_id: this.tabId
        })
      })
    )
  }
  async bundle(options: PageAssetsBundleOptions) {
    return TabPageAssetsCommands.Bundle.ResultSchema.parse(
      await this.transport.send({
        command: TabPageAssetsCommands.Bundle.create({
          ...options,
          browser_id: this.browserId,
          tab_id: this.tabId
        })
      })
    )
  }
}
export class TabWebMcpCapability extends ScopedTabCapability {
  async fetchTools() {
    const result = WebMcpListTools.ResultSchema.parse(
      await this.transport.send({
        command: WebMcpListTools.create({ browser_id: this.browserId, tab_id: this.tabId })
      })
    )
    return createWebMcpSnapshot({ tools: result.tools, context: this })
  }
}
