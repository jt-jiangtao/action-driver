import type { ToolDefinition } from '@actiondriver/plugin-sdk'
export const readDefinition: ToolDefinition = {
        id: 'skill.read', version: 1, modelName: 'skill_read',
        description: 'Read SKILL.md or another text file in an enabled Skill.',
        inputSchema: {
          type: 'object',
          properties: {
            skillId: { type: 'string', minLength: 1 },
            path: { type: 'string', minLength: 1 }
          },
          required: ['skillId'], additionalProperties: false
        },
        risk: 'low', sideEffects: { filesystem: 'read', network: false }, timeoutMs: 30_000
      }

export const installDefinition: ToolDefinition = {
        id: 'skill.install', version: 1, modelName: 'skill_install',
        description: 'Install an instruction Skill from a local folder or GitHub repository path.',
        inputSchema: {
          type: 'object',
          oneOf: [
            { type: 'object', properties: { source: { const: 'local' }, path: { type: 'string', minLength: 1 } }, required: ['source', 'path'], additionalProperties: false },
            { type: 'object', properties: { source: { const: 'github' }, url: { type: 'string', minLength: 1 } }, required: ['source', 'url'], additionalProperties: false }
          ]
        },
        risk: 'high', sideEffects: { filesystem: 'write', network: true }, timeoutMs: 120_000
      }
