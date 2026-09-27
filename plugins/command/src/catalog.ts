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
    { kind: 'shell', id: 'local.shell.run', modelName: 'shell_run', description: 'Run macOS zsh script source in the current session workspace. Bundled rg is available.' },
    { kind: 'python', id: 'local.python.run', modelName: 'python_run', description: 'Run Python 3 source with the bundled interpreter and standard library.' },
    { kind: 'node', id: 'local.node.run', modelName: 'node_run', description: 'Run JavaScript source with bundled Node.js and built-in modules.' },
    { kind: 'ts', id: 'local.typescript.run', modelName: 'ts_run', description: 'Run TypeScript source with bundled Node.js native type stripping. Only erasable TypeScript syntax is supported.' }
  ]

export function createCommandCatalog(timeoutMs = 120_000): PluginCatalog {
  return { tools: commandDescriptors.map(({ id, modelName, description }) => ({
    id, version: 2, modelName, description, inputSchema, risk: 'high',
    sideEffects: { filesystem: 'write', network: true }, timeoutMs
  })), skills: [] }
}
export const catalog = createCommandCatalog()
export default catalog
