import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { ToolCall, ToolDefinition, ToolExecutorEvent } from '@actiondriver/runtime-contracts'
import { SandboxPathGuard } from './path-guard'

const COMMANDS = ['rg', 'head', 'tail', 'wc'] as const
type SandboxCommand = (typeof COMMANDS)[number]

export function createSandboxShellTool(
  guard: SandboxPathGuard,
  options: {
    executables: Record<SandboxCommand, string>
    spawnProcess?: (file: string, args: string[], options: SpawnOptions) => ChildProcess
    maxOutputBytes?: number
    timeoutMs?: number
  }
): { definition: ToolDefinition; executor: { execute(call: ToolCall, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent> } } {
  const spawnProcess = options.spawnProcess ?? spawn
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 10_000
  return {
    definition: {
      id: 'sandbox.shell.run', version: 1, modelName: 'sandbox_shell_run',
      description: 'Run a read-only rg, head, tail or wc command in the workspace',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: [...COMMANDS] },
          args: { type: 'array', items: { type: 'string' }, maxItems: 32 }
        },
        required: ['command', 'args'], additionalProperties: false
      },
      risk: 'medium', sideEffects: { filesystem: 'read', network: false }, timeoutMs
    },
    executor: {
      async *execute(call, signal) {
        const command = call.arguments.command
        const args = call.arguments.args
        if (typeof command !== 'string' || !COMMANDS.includes(command as SandboxCommand)) {
          throw new Error('SANDBOX_COMMAND_DENIED: command is not allowed')
        }
        if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
          throw new Error('SANDBOX_ARGUMENT_DENIED: args must be strings')
        }
        const executable = options.executables[command as SandboxCommand]
        if (!isAbsolute(executable)) {
          throw new Error('SANDBOX_EXECUTABLE_UNAVAILABLE: trusted executable path is required')
        }
        const validatedArgs = await validateArguments(command as SandboxCommand, args, guard)
        const child = spawnProcess(executable, validatedArgs, {
          shell: false,
          detached: true,
          cwd: guard.workspaceRoot,
          env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
          stdio: ['ignore', 'pipe', 'pipe']
        })
        const queue: ToolExecutorEvent[] = []
        let wake: (() => void) | null = null
        let closed = false
        let exitCode: number | null = null
        let failure: Error | null = null
        let bytes = 0
        let aborted = signal?.aborted ?? false
        let timedOut = false
        const notify = () => { wake?.(); wake = null }
        const terminate = () => {
          if (child.pid) {
            try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
          } else child.kill('SIGTERM')
        }
        const onAbort = () => { aborted = true; terminate() }
        if (signal?.aborted) terminate()
        signal?.addEventListener('abort', onAbort, { once: true })
        const timeout = setTimeout(() => { timedOut = true; terminate() }, timeoutMs)
        const forceKill = setTimeout(() => {
          if (!closed) {
            if (child.pid) {
              try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
            } else child.kill('SIGKILL')
          }
        }, timeoutMs + 500)
        const onData = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
          bytes += data.length
          if (bytes > maxOutputBytes) {
            failure = new Error('SANDBOX_OUTPUT_LIMIT: command output exceeded limit')
            terminate()
          } else {
            queue.push({ kind: 'content', stream, delta: data.toString('utf8') })
            notify()
          }
        }
        child.stdout?.on('data', onData('stdout'))
        child.stderr?.on('data', onData('stderr'))
        child.on('error', (error) => { failure = error; closed = true; notify() })
        child.on('close', (code) => { exitCode = code; closed = true; notify() })
        try {
          while (!closed || queue.length) {
            if (queue.length) {
              yield queue.shift()!
            } else {
              await new Promise<void>((resolve) => { wake = resolve })
            }
          }
          if (aborted) throw Object.assign(new Error('SANDBOX_CANCELLED'), { name: 'AbortError' })
          if (timedOut) throw new Error('SANDBOX_TIMEOUT')
          if (failure) throw failure
          if (exitCode !== 0) throw new Error(`SANDBOX_EXIT_NONZERO: ${exitCode}`)
          yield { kind: 'result', output: { exitCode, byteLength: bytes } }
        } finally {
          clearTimeout(timeout)
          clearTimeout(forceKill)
          signal?.removeEventListener('abort', onAbort)
          if (!closed) terminate()
        }
      }
    }
  }
}

async function validateArguments(
  command: SandboxCommand,
  args: string[],
  guard: SandboxPathGuard
): Promise<string[]> {
  if (args.length > 32 || args.some((arg) => !arg || /[|&;<>()$`\r\n]/.test(arg))) {
    throw new Error('SANDBOX_ARGUMENT_DENIED: unsafe argument')
  }
  let index = 0
  const flags: string[] = []
  if (command === 'rg') {
    while (index < args.length && ['-n', '--line-number', '-i', '-l'].includes(args[index]!)) {
      flags.push(args[index++]!)
    }
    const pattern = args[index++]
    if (!pattern || pattern.startsWith('-')) {
      throw new Error('SANDBOX_ARGUMENT_DENIED: rg pattern is required')
    }
    const paths = args.slice(index)
    return [
      ...flags,
      '--',
      pattern,
      ...(await resolvePaths(paths.length ? paths : ['.'], guard))
    ]
  }
  if (command === 'head' || command === 'tail') {
    if (args[index] === '-n') {
      const count = args[index + 1]
      if (!count || !/^[1-9]\d{0,5}$/.test(count)) {
        throw new Error('SANDBOX_ARGUMENT_DENIED: invalid line count')
      }
      flags.push('-n', count)
      index += 2
    }
  } else if (['-l', '-w', '-c'].includes(args[index] ?? '')) {
    flags.push(args[index++]!)
  }
  const paths = args.slice(index)
  if (!paths.length) throw new Error('SANDBOX_ARGUMENT_DENIED: a workspace path is required')
  return [...flags, '--', ...(await resolvePaths(paths, guard))]
}

async function resolvePaths(paths: string[], guard: SandboxPathGuard): Promise<string[]> {
  return Promise.all(paths.map(async (path) => {
    if (path.startsWith('-')) throw new Error('SANDBOX_ARGUMENT_DENIED: unknown flag')
    return (await guard.resolveExisting(path)).absolutePath
  }))
}
