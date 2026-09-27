import { presentations } from '../presentation.js'
import type { ToolDefinition, PluginCatalog } from '@actiondriver/plugin-sdk'
export const definition: ToolDefinition = {
    id: 'tools.local.web.open',
        presentation: presentations['tools.local.web.open'],
    version: 1,
    modelName: 'tools.local.web.open',
    description:
      'Read the bounded plain-text content of one public HTTP(S) HTML page by URL. Does not execute JavaScript or follow page links.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', minLength: 1, maxLength: 2_048 } },
      required: ['url'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffects: { filesystem: 'none', network: true },
    timeoutMs: 15_000
  }
export const catalog: PluginCatalog = { tools: [definition], skills: [] }
export default catalog
