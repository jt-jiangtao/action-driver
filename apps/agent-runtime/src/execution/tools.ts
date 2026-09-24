import { resolve } from 'node:path'
import type { ToolCall, ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
import { resolveExecutionRuntimePaths } from './runtime-paths'
import { runProcess } from './process-runner'

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
  workspaceRoot: string
  runtimeDist: string
  arch?: NodeJS.Architecture
  timeoutMs?: number
}): Promise<Registered[]> {
  const descriptors: Array<{ kind: Kind; id: string; modelName: string; description: string }> = [
    { kind: 'shell', id: 'local.shell.run', modelName: 'shell_run', description: 'Run macOS zsh script source in the workspace. Bundled rg is available.' },
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
      async *execute(call: ToolCall, signal?: AbortSignal) {
        const { script, args } = readInput(call.arguments)
        const runtimeKind = kind === 'ts' ? 'node' : kind
        const paths = await resolveExecutionRuntimePaths(
          options.runtimeDist, options.arch, [runtimeKind === 'shell' ? 'rg' : runtimeKind]
        )
        const executable = kind === 'shell' ? '/bin/zsh' : kind === 'python' ? paths.python : paths.node
        const env = {
          ...process.env,
          PATH: paths.path,
          PYTHONHOME: resolve(paths.python, '..', '..'),
          PYTHONNOUSERSITE: '1'
        }
        const invocation = kind === 'shell' ? ['-s', '--', ...args]
          : kind === 'python' ? ['-', ...args]
            : kind === 'ts' ? ['--input-type=module-typescript', '-', ...args]
              : ['-', ...args]
        yield* runProcess({
          executable, args: invocation, cwd: options.workspaceRoot, env,
          maxOutputBytes: 1024 * 1024, stdin: script
        }, signal)
      }
    }
  }))
}
