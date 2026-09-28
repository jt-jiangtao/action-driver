import { createMacComputer } from './mac/computer.js'
import { loadMacOptions, type SkyMessage, type ServiceComputer } from './service.js'
export interface RpcHost {
  rpc?: (service: string, message: SkyMessage) => Promise<unknown>
}
interface Setup {
  target: string
  methods: string[]
}
export type SkyProxy = ReturnType<typeof createMacComputer>
export async function createSkyProxy(
  options: { host?: RpcHost; createLocal?: () => ServiceComputer } = {}
): Promise<SkyProxy> {
  const host = options.host ?? (globalThis as typeof globalThis & { nodeRepl?: RpcHost }).nodeRepl
  let setup: Setup | undefined, error: unknown, computer: ServiceComputer | undefined
  async function rpc(message: SkyMessage): Promise<unknown> {
    if (typeof host?.rpc !== 'function')
      throw new Error('Computer Use requires a trusted Node REPL Sky service')
    let result = await host.rpc('sky', message)
    if (message.type === 'execute' && message.method === 'stop_audio_recording') {
      const audio = result as { filepath: string; data_url: string }
      result = {
        filepath: audio.filepath,
        bytes: Uint8Array.from(Buffer.from(audio.data_url.split(',')[1] ?? '', 'base64')),
        data_url: audio.data_url
      }
    }
    return result ?? undefined
  }
  if (typeof host?.rpc === 'function') {
    try {
      setup = (await rpc({ type: 'setup' })) as Setup
    } catch (failed) {
      error = failed
    }
  }
  function local(): ServiceComputer {
    if (computer) return computer
    if (host === undefined)
      return (computer = (
        options.createLocal ??
        (() => {
          loadMacOptions()
          return createMacComputer()
        })
      )())
    if (typeof host.rpc !== 'function')
      throw new Error('sky requires node_repl; configure NODE_REPL_TRUSTED_SERVICES')
    const result: ServiceComputer = { target: setup?.target as string }
    for (const method of setup?.methods ?? [])
      Reflect.set(result, method, (...args: unknown[]) => rpc({ type: 'execute', method, args }))
    return (computer = result)
  }
  return new Proxy({} as SkyProxy, {
    // The async factory must never expose a thenable during Promise resolution.
    get(_target, key) {
      if (key === 'then') return undefined
      const value = local(),
        member = Reflect.get(value, key)
      return typeof member === 'function'
        ? member.bind(value)
        : key in value || error === undefined
          ? member
          : () => Promise.reject(error)
    },
    getOwnPropertyDescriptor(_target, key) {
      return Object.getOwnPropertyDescriptor(local(), key)
    },
    has(_target, key) {
      return key in local()
    },
    ownKeys() {
      return Object.keys(local())
    }
  })
}
