import { workspaceDependenciesDefinition } from '@actiondriver/command-plugin/catalog'
import type { ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
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
