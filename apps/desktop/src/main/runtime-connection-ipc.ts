import { STREAM_PROTOCOL } from '@action-driver/runtime-contracts'
import type { RuntimeServiceDescriptor } from './runtime-supervisor'
import {
  RUNTIME_CONNECTION_IPC_CHANNEL,
  type RuntimeConnectionInfo
} from '../shared/runtime-connection-contract'

export interface RuntimeConnectionIpcMain {
  handle(
    channel: string,
    handler: () => RuntimeConnectionInfo | Promise<RuntimeConnectionInfo>
  ): void
}

export function registerRuntimeConnectionIpc(
  ipcMain: RuntimeConnectionIpcMain,
  descriptor: RuntimeServiceDescriptor,
  accessToken: string
): void {
  if (descriptor.streamProtocol !== STREAM_PROTOCOL) {
    throw new Error(`Unsupported Runtime stream protocol: ${descriptor.streamProtocol}`)
  }
  const url = new URL(descriptor.streamPath, descriptor.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const connection: RuntimeConnectionInfo = {
    wsUrl: url.toString(),
    protocol: STREAM_PROTOCOL,
    accessToken
  }
  ipcMain.handle(RUNTIME_CONNECTION_IPC_CHANNEL, () => connection)
}
