import type { RuntimeMessageEndpoint, RuntimeMessageListener } from '@actiondriver/runtime-contracts'

type MessageEventLike = { data: unknown; ports?: UtilityMessagePortLike[] }

export interface ParentPortLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: MessageEventLike) => void): unknown
  off(event: 'message', listener: (event: MessageEventLike) => void): unknown
}

export interface ProcessLifecycleLike {
  on(event: 'exit', listener: () => void): unknown
  off(event: 'exit', listener: () => void): unknown
}

export interface UtilityMessagePortLike {
  postMessage(message: unknown): void
  start(): void
  on(event: 'message', listener: (event: MessageEventLike) => void): unknown
  on(event: 'close', listener: () => void): unknown
  off(event: 'message', listener: (event: MessageEventLike) => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function createParentPortEndpoint(
  parentPort: ParentPortLike,
  lifecycle: ProcessLifecycleLike = process
): RuntimeMessageEndpoint {
  return {
    postMessage(message) {
      parentPort.postMessage(message)
    },
    onMessage(listener: RuntimeMessageListener) {
      const handleMessage = (event: MessageEventLike) => listener(event.data)
      parentPort.on('message', handleMessage)
      return () => parentPort.off('message', handleMessage)
    },
    onClose(listener) {
      lifecycle.on('exit', listener)
      return () => lifecycle.off('exit', listener)
    }
  }
}

export function createUtilityMessagePortEndpoint(
  port: UtilityMessagePortLike
): RuntimeMessageEndpoint {
  port.start()
  return {
    postMessage(message) {
      port.postMessage(message)
    },
    onMessage(listener) {
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

export function waitForRuntimeMessagePort(
  parentPort: ParentPortLike
): Promise<RuntimeMessageEndpoint> {
  return new Promise((resolve) => {
    const handleMessage = (event: MessageEventLike) => {
      if (
        typeof event.data !== 'object' ||
        event.data === null ||
        !('type' in event.data) ||
        event.data.type !== 'runtime.connect' ||
        !event.ports?.[0]
      ) {
        return
      }
      parentPort.off('message', handleMessage)
      resolve(createUtilityMessagePortEndpoint(event.ports[0]))
    }
    parentPort.on('message', handleMessage)
  })
}
