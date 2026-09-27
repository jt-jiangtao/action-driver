import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor
} from '@actiondriver/runtime-contracts'
import {
  OfficeDependenciesUnavailableError,
  resolveExecutionRuntimePaths,
  resolveOfficeDependencyPaths
} from './runtime-paths'
import { runProcess } from './process-runner'
import { ExecutionContextUnavailableError } from './session-execution-context'
import { SessionSandbox } from './session-sandbox'
import { commandDescriptors, createCommandCatalog } from '@actiondriver/command-plugin/catalog'

type Registered = { definition: ToolDefinition; executor: ToolExecutor }


function readInput(input: Record<string, unknown>): { script: string; args: string[] } {
  const { script, args } = input
  if (Object.keys(input).some((key) => key !== 'script' && key !== 'args') ||
    typeof script !== 'string' || !script.trim() ||
    (args !== undefined && (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')))) {
    throw new Error('TOOL_INPUT_INVALID')
  }
  return { script, args: args ?? [] }
}

export async function createScriptTools(options: {
  runtimeDist: string
  arch?: NodeJS.Architecture
  timeoutMs?: number
  sandbox?: SessionSandbox
}): Promise<Registered[]> {
  const sandbox =
    options.sandbox ?? new SessionSandbox({ runtimeRoots: [options.runtimeDist] })
  return commandDescriptors.map(({ kind }, index) => ({
    definition: createCommandCatalog(options.timeoutMs).tools[index]!,
    executor: {
      async *execute(
        call: ToolCall,
        signal?: AbortSignal,
        execution?: ToolExecutionContext
      ) {
        if (!execution?.workspace.root) throw new ExecutionContextUnavailableError()
        const { script, args } = readInput(call.arguments)
        const runtimeKind = kind === 'ts' ? 'node' : kind
        const paths = await resolveExecutionRuntimePaths(
          options.runtimeDist, options.arch, [runtimeKind === 'shell' ? 'rg' : runtimeKind]
        )
        const office = await resolveOfficeDependencyPaths(options.runtimeDist).catch((error: unknown) => {
          if (error instanceof OfficeDependenciesUnavailableError) return null
          throw error
        })
        const executable = kind === 'shell' ? '/bin/zsh' : kind === 'python' ? paths.python : paths.node
        const env: NodeJS.ProcessEnv = {
          PATH: office ? `${office.RUNTIME_BIN_DIR}:${paths.path}` : paths.path,
          PYTHONNOUSERSITE: '1'
        }
        if (office) Object.assign(env, office)
        const invocation = kind === 'shell' ? ['-f', '-s', '--', ...args]
          : kind === 'python' ? ['-', ...args]
            : kind === 'ts' ? ['--input-type=module-typescript', '-', ...args]
              : ['-', ...args]
        const launch = await sandbox.prepare({
          workspace: execution.workspace,
          environment: env
        })
        try {
          const command = launch.wrap(executable, invocation)
          yield* runProcess({
            executable: command.executable, args: command.args,
            cwd: execution.workspace.root, env: launch.environment,
            maxOutputBytes: 1024 * 1024, stdin: script
          }, signal)
        } finally {
          await launch.dispose()
        }
      }
    }
  }))
}
