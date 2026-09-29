import { presentations } from '../presentation.js'
import type { ToolDefinition, PluginCatalog } from '@actiondriver/plugin-sdk'
export const definition: ToolDefinition = {
    id: 'tools.local.web.open',
        presentation: presentations['tools.local.web.open'],
    version: 1,
    modelName: 'tools_local_web_open',
    description:
      'Read bounded content of one public HTTP(S) URL through Jina Reader. Jina may render page scripts remotely; no user login session or automatic link traversal.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', minLength: 1, maxLength: 2_048 } },
      required: ['url'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffects: { filesystem: 'none', network: true },
    timeoutMs: 30_000
  }
export const catalog: PluginCatalog = { tools: [definition], skills: [] }
export default catalog
