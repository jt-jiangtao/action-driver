import type { STREAM_PROTOCOL } from '@actiondriver/runtime-contracts'

export const RUNTIME_CONNECTION_IPC_CHANNEL = 'actiondriver:runtime-connection:get' as const

export type RuntimeConnectionInfo = {
  wsUrl: string
  protocol: typeof STREAM_PROTOCOL
  accessToken: string
}

export interface RuntimeConnectionDesktopApi {
  get(): Promise<RuntimeConnectionInfo>
}
