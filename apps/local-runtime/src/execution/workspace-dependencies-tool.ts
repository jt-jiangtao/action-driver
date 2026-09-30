import { workspaceDependenciesDefinition } from '@action-driver/command-plugin/catalog'
import type { ToolDefinition, ToolExecutor } from '@action-driver/runtime-contracts'
import { resolveOfficeDependencyPaths } from './runtime-paths'

export function createWorkspaceDependenciesTool(runtimeDist: string): {
  definition: ToolDefinition
  executor: ToolExecutor
} {
  return {
    definition: workspaceDependenciesDefinition,
    executor: {
      async *execute() {
        yield { kind: 'result', output: await resolveOfficeDependencyPaths(runtimeDist) }
      }
    }
  }
}
