import type { PluginContext } from '@actiondriver/plugin-sdk'
import { catalog } from './catalog.js'
export function activate(context: PluginContext): void {
  for (const skill of catalog.skills) context.api.skills.register(skill)
}
