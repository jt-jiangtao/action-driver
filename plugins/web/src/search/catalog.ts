import { presentations } from '../presentation.js'
import type { PluginCatalog, ToolDefinition } from '@actiondriver/plugin-sdk'

export function createSearchDefinition(timeoutMs = 30_000): ToolDefinition {
  return {
    id: 'tools/local/web/search',
        presentation: presentations['tools/local/web/search'],
    version: 1,
    modelName: 'tools_local_web_search',
    description: 'Search the public web through Tavily. Returns sourced snippets; does not automatically read result URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 512 },
        maxResults: { type: 'integer', minimum: 1, maximum: 10 }
      },
      required: ['query'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffects: { filesystem: 'none', network: true },
    timeoutMs
  }
}

export const catalog: PluginCatalog = { tools: [createSearchDefinition()], skills: [] }
