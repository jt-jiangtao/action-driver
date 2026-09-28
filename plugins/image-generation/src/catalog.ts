import { presentations } from './presentation.js'
import { skill } from './skill.js'
import type { ToolDefinition, PluginCatalog } from '@actiondriver/plugin-sdk'
export const definition: ToolDefinition = {
  id: 'tools/local/image-generation/generate',
        presentation: presentations['tools/local/image-generation/generate'],
  version: 1,
  modelName: 'tools_local_image_generation_generate',
  description:
    'Generate one to sixteen images from independent text prompts, with up to four requests running at once. Each image may complete separately.',
  inputSchema: {
    type: 'object',
    properties: {
      images: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: {
          type: 'object',
          properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 } },
          required: ['prompt'],
          additionalProperties: false
        }
      }
    },
    required: ['images'],
    additionalProperties: false
  },
  risk: 'medium',
  sideEffects: { filesystem: 'write', network: true },
  timeoutMs: 600_000
}

export const catalog: PluginCatalog = { tools: [definition], skills: [skill] }
export default catalog
