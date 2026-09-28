import { readFileSync } from 'node:fs'
import { createMacComputer } from './mac/computer.js'
export function loadMacOptions(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform
): { target: 'mac'; [key: string]: unknown } {
  const path = env.OAI_SKY_CONFIG_PATH?.trim()
  const options = path
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { target: platform === 'darwin' ? 'mac' : platform }
  if (options?.target !== 'mac') throw new Error('Sky currently supports macOS only')
  return options
}
export type SkyMessage =
  | { type: 'setup' }
  | { type: 'execute'; method: string; args: unknown[] }
  | { type: 'drag_start' | 'drag_move' | 'drag_end'; handle_id: string; point?: unknown }
export type ServiceComputer = { target: string; [key: string]: unknown }
export function createSkyService(
  createComputer: () => ServiceComputer = () => {
    loadMacOptions()
    return createMacComputer()
  }
): (message: SkyMessage) => Promise<unknown> {
  let computer: ServiceComputer | undefined
  return async (message) => {
    computer ??= createComputer()
    switch (message.type) {
      case 'setup':
        return {
          target: computer.target,
          methods: Object.keys(computer).filter(
            (key) => typeof Reflect.get(computer!, key) === 'function'
          )
        }
      case 'execute': {
        const method = Object.getOwnPropertyDescriptor(computer, message.method)?.value
        if (typeof method !== 'function')
          throw new Error(`Sky runtime method is not available: ${message.method}`)
        const result = await method.call(computer, ...message.args)
        return message.method === 'stop_audio_recording'
          ? { filepath: result.filepath, data_url: result.data_url }
          : result
      }
      case 'drag_start':
        throw new Error('Sky drag handles require the Linux runtime')
      case 'drag_move':
      case 'drag_end':
        throw new Error('Sky drag handle has not been started')
      default:
        throw new Error(`Unreachable case: ${String(message)}`)
    }
  }
}
export const handleRpc = createSkyService()
