import type { ToolCall, ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
import type { AgentFileStore } from './agent-file-store'
import type { SkillInstaller } from './skill-installer'

type Registered = { definition: ToolDefinition; executor: ToolExecutor }

export function createSkillRuntimeTools(options: {
  store: AgentFileStore
  installer: SkillInstaller
}): Registered[] {
  return [
    {
      definition: {
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
      },
      executor: {
        async *execute(call: ToolCall) {
          const skillId = call.arguments.skillId
          const path = call.arguments.path
          if (typeof skillId !== 'string' || (path !== undefined && typeof path !== 'string')) {
            throw new Error('TOOL_INPUT_INVALID')
          }
          const file = await options.store.readEnabledSkillFile(skillId, path)
          yield { kind: 'result', output: { skillId, path: file.path, content: file.content } }
        }
      }
    },
    {
      definition: {
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
      },
      executor: {
        async *execute(call: ToolCall) {
          const { source, path, url } = call.arguments
          const input = source === 'local' && typeof path === 'string'
            ? { source: 'local' as const, path }
            : source === 'github' && typeof url === 'string'
              ? { source: 'github' as const, url }
              : null
          if (!input) throw new Error('TOOL_INPUT_INVALID')
          const installed = await options.installer.installSkill(input)
          yield { kind: 'result', output: installed }
        }
      }
    }
  ]
}
