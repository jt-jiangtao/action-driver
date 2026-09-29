import type { PluginUiContributions } from '@actiondriver/plugin-contracts'

export const PLUGIN_CONTRIBUTIONS_LIST_CHANNEL = 'actiondriver:plugin-contributions:list'
export const PLUGIN_VIEW_OPEN_CHANNEL = 'actiondriver:plugin-contributions:open-view'
export const PLUGIN_COMMAND_EXECUTE_CHANNEL = 'actiondriver:plugin-contributions:execute-command'

/** Desktop surface for declared plugin views and menus; availability stays runtime-owned. */
export interface PluginContributionsDesktopApi {
  list(): Promise<PluginUiContributions>
  /** Activates the owning plugin on demand and places the view in its declared container. */
  openView(pluginId: string, viewId: string): Promise<void>
  /** Runs a declared command bound to a menu entry; the runtime re-checks condition and grants. */
  executeCommand(input: { pluginId: string; commandId: string; taskId?: string; input?: unknown }): Promise<unknown>
}
