import type { PluginContext } from '@actiondriver/plugin-sdk'
import { createSearxngSearchTool } from './execution.js'
export async function activate(context: PluginContext): Promise<void> {
  const configuration = await context.api.storage.get('configuration')
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return
  const endpoint = configuration.endpoint
  if (typeof endpoint !== 'string' || !endpoint.trim()) return
  const tool = createSearxngSearchTool({ endpoint: endpoint.trim(), fetch: globalThis.fetch })
  context.api.tools.register(tool.definition, tool.executor)
}
