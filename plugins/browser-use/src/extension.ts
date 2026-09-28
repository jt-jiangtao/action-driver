import type { PluginContext } from '@actiondriver/plugin-sdk'
import { catalog } from './catalog.js'

export function activate(context: PluginContext): void {
  context.api.skills.register(catalog.skills[0]!)
}
