import { isAbsolute, resolve } from 'node:path'
import type { ToolCall, ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
import { resolveExecutionRuntimePaths } from './runtime-paths'
import { runProcess } from './process-runner'

type Registered = { definition: ToolDefinition; executor: ToolExecutor }
const argsSchema = { type: 'array', items: { type: 'string' } }
const scriptSchema = {
  type: 'object',
  oneOf: [
    { type: 'object', properties: { code: { type: 'string', minLength: 1 }, args: argsSchema }, required: ['code'], additionalProperties: false },
    { type: 'object', properties: { file: { type: 'string', minLength: 1 }, args: argsSchema }, required: ['file'], additionalProperties: false }
  ]
}

export async function createScriptTools(options: {
  workspaceRoot: string
  runtimeDist: string
  arch?: NodeJS.Architecture
  timeoutMs?: number
}): Promise<Registered[]> {
  const spec = async (kind: 'shell' | 'python' | 'node', args: string[]) => {
    const paths = await resolveExecutionRuntimePaths(
      options.runtimeDist, options.arch, [kind === 'shell' ? 'rg' : kind]
    )
    const executable = kind === 'shell' ? '/bin/zsh' : paths[kind]
    const env = { ...process.env, PATH: paths.path, PYTHONHOME: resolve(paths.python, '..', '..'), PYTHONNOUSERSITE: '1' }
    return { executable, args, cwd: options.workspaceRoot, env, maxOutputBytes: 1024 * 1024 }
  }
  const base = (id: string, modelName: string, description: string, inputSchema: ToolDefinition['inputSchema']): ToolDefinition => ({
    id, version: 1, modelName, description, inputSchema,
    risk: 'high', sideEffects: { filesystem: 'write', network: true },
    timeoutMs: options.timeoutMs ?? 120_000
  })
  return [
    {
      definition: base('local.shell.run', 'shell_run', 'Run a macOS zsh terminal command in the workspace. Supports pipes, redirection, and bundled rg, python3 and node.', {
        type: 'object', properties: { command: { type: 'string', minLength: 1 } }, required: ['command'], additionalProperties: false
      }),
      executor: { async *execute(call: ToolCall, signal?: AbortSignal) {
        const command = call.arguments.command
        if (typeof command !== 'string' || !command.trim()) throw new Error('TOOL_INPUT_INVALID')
        yield* runProcess(await spec('shell', ['-lc', command]), signal)
      } }
    },
    ...(['python', 'node'] as const).map((kind): Registered => ({
      definition: base(`local.${kind}.run`, `${kind}_run`, `Run ${kind === 'python' ? 'Python 3 with its standard library' : 'Node.js with built-in modules'} using the interpreter bundled with the app. Provide code or a script file, plus optional args.`, scriptSchema),
      executor: { async *execute(call: ToolCall, signal?: AbortSignal) {
        const { code, file, args } = call.arguments
        if ((typeof code === 'string') === (typeof file === 'string') ||
          (typeof code === 'string' && !code.trim()) ||
          (typeof file === 'string' && !file.trim()) ||
          (args !== undefined && (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')))) {
          throw new Error('TOOL_INPUT_INVALID')
        }
        const invocation = typeof code === 'string'
          ? [kind === 'python' ? '-c' : '-e', code, ...(args ?? [])]
          : [isAbsolute(file as string) ? file as string : resolve(options.workspaceRoot, file as string), ...(args ?? [])]
        yield* runProcess(await spec(kind, invocation), signal)
      } }
    }))
  ]
}
