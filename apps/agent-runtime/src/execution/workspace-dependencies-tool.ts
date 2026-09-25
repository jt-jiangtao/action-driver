import type { ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
import { resolveOfficeDependencyPaths } from './runtime-paths'

export function createWorkspaceDependenciesTool(runtimeDist: string): {
  definition: ToolDefinition
  executor: ToolExecutor
} {
  return {
    definition: {
      id: 'workspace.dependencies.load', version: 1,
      modelName: 'load_workspace_dependencies',
      description: 'Read the absolute paths of bundled office document dependencies.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'low', sideEffects: { filesystem: 'read', network: false }, timeoutMs: 30_000
    },
    executor: {
      async *execute() {
        yield { kind: 'result', output: await resolveOfficeDependencyPaths(runtimeDist) }
      }
    }
  }
}
