import type { PluginContext } from '@actiondriver/plugin-sdk'
import { activate as search } from './search/extension.js'
import { activate as reader } from './reader/extension.js'
export async function activate(context: PluginContext): Promise<void> {
  reader(context)
  await search(context)
}
