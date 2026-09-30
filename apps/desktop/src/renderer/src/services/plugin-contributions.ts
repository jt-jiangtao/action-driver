import type { PluginUiContributions } from '@action-driver/plugin-contracts'
import type { DesktopApi } from '../../../preload/desktop-api'

/** Renderer port for declared plugin views and menus. Availability stays runtime-owned. */
export interface PluginContributionsService {
  list(): Promise<PluginUiContributions>
  openView(pluginId: string, viewId: string): Promise<void>
  executeCommand(input: { pluginId: string; commandId: string; taskId?: string }): Promise<unknown>
}

export class DesktopPluginContributionsService implements PluginContributionsService {
  constructor(private readonly api: DesktopApi) {}
  list(): Promise<PluginUiContributions> {
    return this.api.pluginContributions.list()
  }
  openView(pluginId: string, viewId: string): Promise<void> {
    return this.api.pluginContributions.openView(pluginId, viewId)
  }
  executeCommand(input: { pluginId: string; commandId: string; taskId?: string }): Promise<unknown> {
    return this.api.pluginContributions.executeCommand(input)
  }
}

/** Mock composition has no plugin host, so the interface is simply empty. */
export class MockPluginContributionsService implements PluginContributionsService {
  async list(): Promise<PluginUiContributions> {
    return { views: [], menus: [] }
  }
  async openView(): Promise<void> {}
  async executeCommand(): Promise<unknown> {
    return null
  }
}
