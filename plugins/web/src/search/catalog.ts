import { presentations } from '../presentation.js'
import type { PluginCatalog, ToolDefinition } from '@actiondriver/plugin-sdk'

export function createSearchDefinition(timeoutMs = 10_000): ToolDefinition {
  return {
    id: 'tools/local/web/search',
        presentation: presentations['tools/local/web/search'],
    version: 1,
    modelName: 'tools_local_web_search',
    description: 'Search the public web through a local SearXNG service',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 512 },
        categories: { type: 'string', maxLength: 128 },
        language: { type: 'string', maxLength: 32 },
        safesearch: { type: 'integer', minimum: 0, maximum: 2 },
        pageno: { type: 'integer', minimum: 1, maximum: 10 },
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
