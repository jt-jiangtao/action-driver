import type { PluginContext } from '@action-driver/plugin-sdk'
import { activate as search } from './search/extension.js'
import { activate as reader } from './reader/extension.js'
export async function activate(context: PluginContext): Promise<void> {
  await reader(context)
  await search(context)
}
