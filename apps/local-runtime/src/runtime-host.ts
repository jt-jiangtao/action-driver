export type RuntimeServiceDescriptor = {
  baseUrl: string
  streamPath: string
  streamProtocol: string
}

export type RuntimeReadyDescriptor = { service: RuntimeServiceDescriptor | null }

export interface RuntimeHost {
  ready(descriptor: RuntimeReadyDescriptor): void
  onShutdown(handler: () => void): void
}
