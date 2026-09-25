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

type Registered = { definition: ToolDefinition; executor: ToolExecutor }
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
  const descriptors: Array<{ kind: Kind; id: string; modelName: string; description: string }> = [
    { kind: 'shell', id: 'local.shell.run', modelName: 'shell_run', description: 'Run macOS zsh script source in the current session workspace. Bundled rg is available.' },
    { kind: 'python', id: 'local.python.run', modelName: 'python_run', description: 'Run Python 3 source with the bundled interpreter and standard library.' },
    { kind: 'node', id: 'local.node.run', modelName: 'node_run', description: 'Run JavaScript source with bundled Node.js and built-in modules.' },
    { kind: 'ts', id: 'local.typescript.run', modelName: 'ts_run', description: 'Run TypeScript source with bundled Node.js native type stripping. Only erasable TypeScript syntax is supported.' }
  ]
  return descriptors.map(({ kind, id, modelName, description }) => ({
    definition: {
      id, version: 2, modelName, description, inputSchema,
      risk: 'high', sideEffects: { filesystem: 'write', network: true },
      timeoutMs: options.timeoutMs ?? 120_000
    },
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
