import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ComputerUseError, ComputerUseTransportError, ServerErrorCode } from './errors.js'
import { NativePipeTransport, VersionMismatchError, type NativePipe } from './native-pipe.js'
import { decodeMessageFrames, encodeMessageFrame } from './rpc-codec.js'
export interface NativeHost {
  env?: Record<string, string | undefined>
  nativePipe?: { createConnection: (path: string) => Promise<NativePipe> }
  launchServices?: {
    openApplication: (
      target: { applicationPath: string } | { bundleIdentifier: string }
    ) => Promise<unknown>
  }
}
const trimmed = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
const errorOf = (value: unknown) => (value instanceof Error ? value : new Error(String(value)))
class ConnectionUnavailable extends Error {
  constructor(cause: unknown) {
    super(`Sky Computer Use native pipe is unavailable: ${errorOf(cause).message}`)
  }
}
async function deadline<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
async function connect(
  create: (path: string) => Promise<NativePipe>,
  path: string,
  version: string,
  timeout: number
): Promise<NativePipeTransport> {
  const end = Date.now() + timeout
  let lastError: unknown
  for (;;) {
    const remaining = end - Date.now()
    if (remaining <= 0) throw new ConnectionUnavailable(lastError)
    let pipe: NativePipe | undefined
    const pending = create(path)
    try {
      pipe = await deadline(pending, remaining, 'Sky Computer Use native pipe connection timed out')
    } catch (error) {
      pending.then(
        (pipe) => pipe.end(),
        () => {}
      )
      lastError = error
    }
    if (pipe) {
      const transport = new NativePipeTransport(pipe, version)
      try {
        await transport.ping(Math.min(1000, Math.max(1, end - Date.now())))
        return transport
      } catch (error) {
        transport.close()
        if (
          error instanceof VersionMismatchError ||
          (error instanceof ComputerUseError &&
            error.code === ServerErrorCode.incompatibleClientVersion)
        )
          throw error
        lastError = error
      }
    }
    if (Date.now() >= end) throw new ConnectionUnavailable(lastError)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
function ensureService(pipe: NativePipe): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer: Buffer = Buffer.alloc(0),
      settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pipe.off('data', onData)
      pipe.off('error', onError)
      pipe.off('close', onClose)
      if (error) reject(error)
      else resolve()
    }
    const onData = (chunk: Uint8Array) => {
      try {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)])
        const decoded = decodeMessageFrames(buffer)
        buffer = decoded.remainingData
        for (const raw of decoded.messages) {
          const message = JSON.parse(raw)
          if (typeof message === 'object' && message !== null && message.id === 0) {
            if ('error' in message)
              finish(
                new Error(
                  typeof message.error?.message === 'string'
                    ? message.error.message
                    : 'Sky Computer Use host service ensure failed'
                )
              )
            else if ('result' in message) finish()
            else finish(new Error('Sky Computer Use host service returned an invalid response'))
          }
        }
      } catch (error) {
        finish(errorOf(error))
      }
    }
    const onError = (error: Error) => finish(error),
      onClose = () =>
        finish(new Error('Sky Computer Use host service connection closed before response'))
    const timer = setTimeout(
      () => finish(new Error('Sky Computer Use host service ensure timed out')),
      5000
    )
    pipe.on('data', onData)
    pipe.on('error', onError)
    pipe.on('close', onClose)
    try {
      pipe.write(
        encodeMessageFrame(
          JSON.stringify({
            id: 0,
            jsonrpc: '2.0',
            method: 'ensureService',
            params: { service: 'computer-use' }
          })
        )
      )
    } catch (error) {
      finish(errorOf(error))
    }
  })
}
async function startService(host: NativeHost): Promise<void> {
  const hostPath = trimmed(host.env?.NODE_REPL_HOST_SERVICES_PIPE_PATH)
  if (hostPath) {
    const create = host.nativePipe?.createConnection
    if (!create) throw new Error('Sky Computer Use requires nodeRepl.nativePipe support')
    const pending = create(hostPath)
    let pipe: NativePipe
    try {
      pipe = await deadline(pending, 5000, 'Sky Computer Use host service connection timed out')
    } catch (error) {
      pending.then(
        (pipe) => pipe.end(),
        () => {}
      )
      throw error
    }
    try {
      await ensureService(pipe)
    } finally {
      pipe.end()
    }
    return
  }
  const launch = host.launchServices?.openApplication
  if (!launch) throw new Error('Sky Computer Use requires nodeRepl.launchServices support')
  const explicit = trimmed(host.env?.SKY_CUA_SERVICE_PATH),
    home = trimmed(host.env?.CODEX_HOME)
  const application = home ? join(home, 'computer-use', 'Codex Computer Use.app') : undefined
  await launch(
    explicit
      ? { applicationPath: explicit }
      : application && existsSync(application)
        ? { applicationPath: application }
        : { bundleIdentifier: 'com.openai.sky.CUAService' }
  )
}
export async function createNativeTransport(
  version: string,
  host?: NativeHost
): Promise<NativePipeTransport> {
  host ??= (globalThis as typeof globalThis & { nodeRepl?: NativeHost }).nodeRepl
  if (!host)
    throw new ComputerUseTransportError('Sky Computer Use requires the trusted nodeRepl runtime')
  const create = host.nativePipe?.createConnection
  if (typeof create !== 'function')
    throw new ComputerUseTransportError('Sky Computer Use native pipe is unavailable')
  const path =
    trimmed(host.env?.SKY_CUA_SERVICE_NATIVE_PIPE_PATH) ??
    join(
      homedir(),
      'Library',
      'Group Containers',
      '2DC432GLL2.com.openai.sky.CUAService',
      'IPC',
      'computeruse.sock'
    )
  try {
    return await connect(create, path, version, 250)
  } catch (error) {
    if (!(error instanceof ConnectionUnavailable)) throw error
  }
  try {
    await startService(host)
  } catch (error) {
    throw new ComputerUseTransportError('Sky Computer Use service startup request failed', {
      cause: error
    })
  }
  try {
    return await connect(create, path, version, 5000)
  } catch (error) {
    throw new ComputerUseTransportError('Sky Computer Use native pipe startup failed', {
      cause: error
    })
  }
}
