import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { ToolExecutorEvent } from '@actiondriver/runtime-contracts'

export type ProcessSpec = {
  executable: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  maxOutputBytes: number
}

export class ProcessOutputLimitError extends Error {
  readonly code = 'PROCESS_OUTPUT_LIMIT'

  constructor() {
    super('PROCESS_OUTPUT_LIMIT: command output exceeded limit')
    this.name = 'ProcessOutputLimitError'
  }
}

export class ProcessExitError extends Error {
  readonly code = 'PROCESS_EXIT_NONZERO'

  constructor(readonly exitCode: number | null) {
    super(`PROCESS_EXIT_NONZERO: ${exitCode}`)
    this.name = 'ProcessExitError'
  }
}

export async function* runProcess(spec: ProcessSpec, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent> {
  if (signal?.aborted) throw Object.assign(new Error('PROCESS_CANCELLED'), { name: 'AbortError' })
  const child = spawn(spec.executable, spec.args, {
    shell: false, detached: true, cwd: spec.cwd, env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const events: ToolExecutorEvent[] = []
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
  let wake: (() => void) | undefined
  let closed = false
  let code: number | null = null
  let failure: Error | undefined
  let bytes = 0
  let aborted = false
  let outputLimit = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const notify = () => { wake?.(); wake = undefined }
  const killGroup = (kind: NodeJS.Signals) => {
    if (!child.pid) return
    try { process.kill(-child.pid, kind) } catch { try { child.kill(kind) } catch { /* already exited */ } }
  }
  const terminate = () => {
    killGroup('SIGTERM')
    killTimer ??= setTimeout(() => killGroup('SIGKILL'), 500)
  }
  const onAbort = () => { aborted = true; terminate(); notify() }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  const onData = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
    const allowance = Math.max(0, spec.maxOutputBytes - bytes)
    const accepted = data.subarray(0, allowance)
    bytes += accepted.length
    if (accepted.length) {
      const delta = decoders[stream].write(accepted)
      if (delta) events.push({ kind: 'content', stream, delta })
    }
    if (accepted.length < data.length) { outputLimit = true; terminate() }
    notify()
  }
  child.stdout.on('data', onData('stdout'))
  child.stderr.on('data', onData('stderr'))
  child.on('error', (error) => { failure = error; closed = true; notify() })
  child.on('close', (exitCode) => { code = exitCode; closed = true; notify() })
  try {
    while (!closed || events.length) {
      if (events.length) yield events.shift()!
      else await new Promise<void>((resolve) => { wake = resolve })
    }
    if (!outputLimit) {
      for (const stream of ['stdout', 'stderr'] as const) {
        const delta = decoders[stream].end()
        if (delta) yield { kind: 'content', stream, delta }
      }
    }
    if (aborted) throw Object.assign(new Error('PROCESS_CANCELLED'), { name: 'AbortError' })
    if (outputLimit) throw new ProcessOutputLimitError()
    if (failure) throw failure
    if (code !== 0) throw new ProcessExitError(code)
    yield { kind: 'result', output: { exitCode: code, byteLength: bytes } }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (killTimer && !aborted && !outputLimit) clearTimeout(killTimer)
    if (!closed) terminate()
  }
}
