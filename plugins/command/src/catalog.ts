import { presentations } from './presentation.js'
import type { PluginCatalog, ToolDefinition } from '@actiondriver/plugin-sdk'
type Kind = 'shell' | 'python' | 'node' | 'ts'

const inputSchema: ToolDefinition['inputSchema'] = {
  type: 'object',
  properties: {
    script: { type: 'string', minLength: 1, maxLength: 1024 * 1024 },
    args: { type: 'array', items: { type: 'string' }, maxItems: 256 }
  },
  required: ['script'],
  additionalProperties: false
}

export const commandDescriptors: Array<{ kind: Kind; id: string; modelName: string; description: string }> = [
    { kind: 'shell', id: 'tools.local.command.shell.run', modelName: 'tools.local.command.shell.run', description: 'Run macOS zsh script source in the current session workspace. Bundled rg is available.' },
    { kind: 'python', id: 'tools.local.command.python.run', modelName: 'tools.local.command.python.run', description: 'Run Python 3 source with the bundled interpreter and standard library.' },
    { kind: 'node', id: 'tools.local.command.node.run', modelName: 'tools.local.command.node.run', description: 'Run JavaScript source with bundled Node.js and built-in modules.' },
    { kind: 'ts', id: 'tools.local.command.typescript.run', modelName: 'tools.local.command.typescript.run', description: 'Run TypeScript source with bundled Node.js native type stripping. Only erasable TypeScript syntax is supported.' }
  ]

export function createCommandCatalog(timeoutMs = 120_000): PluginCatalog {
  return { tools: [...commandDescriptors.map<ToolDefinition>(({ id, modelName, description }) => ({
    id, presentation: presentations[id], version: 2, modelName, description, inputSchema, risk: 'high',
    sideEffects: { filesystem: 'write', network: true }, timeoutMs
  })), workspaceDependenciesDefinition], skills: [] }
}


export const workspaceDependenciesDefinition: ToolDefinition = {
  id: 'tools.local.command.dependencies.load', presentation: presentations['tools.local.command.dependencies.load'], version: 1, modelName: 'tools.local.command.dependencies.load',
  description: 'Read the absolute paths of bundled office document dependencies.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  risk: 'low', sideEffects: { filesystem: 'read', network: false }, timeoutMs: 30_000
}

export const catalog = createCommandCatalog()

export default catalog
