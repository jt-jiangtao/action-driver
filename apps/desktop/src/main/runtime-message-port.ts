import type { RuntimeMessageEndpoint, RuntimeMessageListener } from '@actiondriver/runtime-contracts'

type MessageEventLike = { data: unknown }

export interface MessagePortMainLike {
  postMessage(message: unknown): void
  start(): void
  on(event: 'message', listener: (event: MessageEventLike) => void): unknown
  on(event: 'close', listener: () => void): unknown
  off(event: 'message', listener: (event: MessageEventLike) => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export interface MessageChannelMainLike {
  port1: MessagePortMainLike
  port2: MessagePortMainLike
}

export type RuntimeMessageChannel = {
  endpoint: RuntimeMessageEndpoint
  transferPort: MessagePortMainLike
}

export function createMessagePortMainEndpoint(port: MessagePortMainLike): RuntimeMessageEndpoint {
  port.start()
  return {
    postMessage(message) {
      port.postMessage(message)
    },
    onMessage(listener: RuntimeMessageListener) {
      const handleMessage = (event: MessageEventLike) => listener(event.data)
      port.on('message', handleMessage)
      return () => port.off('message', handleMessage)
    },
    onClose(listener) {
      port.on('close', listener)
      return () => port.off('close', listener)
    }
  }
}

export function adaptRuntimeMessageChannel(channel: MessageChannelMainLike): RuntimeMessageChannel {
  return {
    endpoint: createMessagePortMainEndpoint(channel.port1),
    transferPort: channel.port2
  }
}
