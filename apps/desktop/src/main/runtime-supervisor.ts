import { MessageChannelMain, utilityProcess } from 'electron'
import type { RuntimeMessageEndpoint } from '@actiondriver/runtime-contracts'
import { adaptRuntimeMessageChannel } from './runtime-message-port'

export type RuntimeSupervisorState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'stopping'
  | 'failed'

export interface RuntimeProcess {
  postMessage(message: unknown): void
  kill(): void
  on(
    event: 'message' | 'exit',
    listener: ((message: unknown) => void) | ((code: number | null) => void)
  ): void
}

export interface RuntimeProcessFactory {
  fork(entryPath: string): RuntimeProcess
}

export type RuntimeSupervisorOptions = {
  maxRestarts?: number
  restartWindowMs?: number
  shutdownTimeoutMs?: number
  now?: () => number
  onRuntimeRpcReady?: () => Promise<void>
  onServiceReady?: (service: RuntimeServiceDescriptor) => Promise<void>
}

export type RuntimeServiceDescriptor = {
  baseUrl: string
  streamPath: string
  streamProtocol: string
}

export class RuntimeSupervisor {
  private currentProcess: RuntimeProcess | null = null
  private serviceBaseUrl: string | null = null
  private serviceDescriptorValue: RuntimeServiceDescriptor | null = null
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private rpcReadyPromise: Promise<void> = Promise.resolve()
  private resolveRpcReady: (() => void) | null = null
  private rejectRpcReady: ((error: Error) => void) | null = null
  private stopPromise: Promise<void> | null = null
  private resolveStop: (() => void) | null = null
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null
  private readonly restartTimestamps: number[] = []
  private readonly maxRestarts: number
  private readonly restartWindowMs: number
  private readonly shutdownTimeoutMs: number
  private readonly now: () => number
  private readonly onRuntimeRpcReady: (() => Promise<void>) | undefined
  private readonly onServiceReady:
    | ((service: RuntimeServiceDescriptor) => Promise<void>)
    | undefined

  state: RuntimeSupervisorState = 'stopped'

  /** Base URL of the service HTTP surface reported by the Runtime on readiness. */
  get serviceUrl(): string | null {
    return this.serviceBaseUrl
  }

  get serviceDescriptor(): RuntimeServiceDescriptor | null {
    return this.serviceDescriptorValue
  }

  constructor(
    private readonly processFactory: RuntimeProcessFactory,
    private readonly entryPath: string,
    options: RuntimeSupervisorOptions = {}
  ) {
    this.maxRestarts = options.maxRestarts ?? 3
    this.restartWindowMs = options.restartWindowMs ?? 60_000
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000
    this.now = options.now ?? Date.now
    this.onRuntimeRpcReady = options.onRuntimeRpcReady
    this.onServiceReady = options.onServiceReady
  }

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve()
    if (this.state === 'starting' && this.readyPromise) return this.readyPromise
    if (this.state === 'stopping') return Promise.reject(new Error('Runtime is stopping'))
    if (this.state === 'failed')
      return Promise.reject(new Error('Runtime restart budget exhausted'))
    return this.spawn()
  }

  stop(): Promise<void> {
    if (this.state === 'stopped') return Promise.resolve()
    if (this.state === 'stopping' && this.stopPromise) return this.stopPromise

    this.state = 'stopping'
    this.stopPromise = new Promise<void>((resolve) => {
      this.resolveStop = resolve
    })
    const process = this.currentProcess
    if (!process) {
      this.finishStop()
      return this.stopPromise
    }

    process.postMessage({ type: 'runtime.shutdown' })
    this.shutdownTimer = setTimeout(() => {
      if (this.currentProcess !== process || this.state !== 'stopping') return
      process.kill()
      if (this.currentProcess === process) {
        this.currentProcess = null
        this.finishStop()
      }
    }, this.shutdownTimeoutMs)
    return this.stopPromise
  }

  private spawn(preservePendingStart = false): Promise<void> {
    this.state = 'starting'
    if (this.onRuntimeRpcReady) {
      this.rpcReadyPromise = new Promise<void>((resolve, reject) => {
        this.resolveRpcReady = resolve
        this.rejectRpcReady = reject
      })
    } else {
      this.rpcReadyPromise = Promise.resolve()
      this.resolveRpcReady = null
      this.rejectRpcReady = null
    }
    if (!preservePendingStart || !this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.resolveReady = resolve
        this.rejectReady = reject
      })
    }
    const process = this.processFactory.fork(this.entryPath)
    this.currentProcess = process
    process.on('message', (message: unknown) => void this.handleMessage(process, message))
    process.on('exit', (code: number | null) => this.handleExit(process, code))
    return this.readyPromise
  }

  private async handleMessage(process: RuntimeProcess, message: unknown): Promise<void> {
    if (this.currentProcess !== process) return
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'runtime.rpc-ready'
    ) {
      if (this.onRuntimeRpcReady) {
        try {
          await this.onRuntimeRpcReady()
          this.resolveRpcReady?.()
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error))
          this.state = 'failed'
          this.rejectRpcReady?.(normalized)
          this.rejectReady?.(normalized)
        }
      }
      return
    }
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'runtime.ready'
    ) {
      if (this.onRuntimeRpcReady) {
        try {
          await this.rpcReadyPromise
        } catch {
          return
        }
      }
      if (this.state === 'failed') return
      const service = 'service' in message ? message.service : null
      this.serviceBaseUrl =
        service !== null && typeof service === 'object' && 'baseUrl' in service
          ? String((service as { baseUrl: string }).baseUrl)
          : null
      this.serviceDescriptorValue =
        service !== null &&
        typeof service === 'object' &&
        'baseUrl' in service &&
        'streamPath' in service &&
        'streamProtocol' in service
          ? {
              baseUrl: String(service.baseUrl),
              streamPath: String(service.streamPath),
              streamProtocol: String(service.streamProtocol)
            }
          : null
      if (this.serviceDescriptorValue && this.onServiceReady) {
        try {
          await this.onServiceReady(this.serviceDescriptorValue)
        } catch (error) {
          this.state = 'failed'
          this.rejectReady?.(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      this.state = 'ready'
      this.resolveReady?.()
      this.resolveReady = null
      this.rejectReady = null
    }
  }

  private handleExit(process: RuntimeProcess, code: number | null): void {
    if (this.currentProcess !== process) return
    const preservePendingStart = this.state === 'starting'
    this.currentProcess = null
    this.serviceBaseUrl = null
    this.serviceDescriptorValue = null

    if (this.state === 'stopping') {
      this.finishStop()
      return
    }

    const now = this.now()
    while (
      this.restartTimestamps.length > 0 &&
      now - this.restartTimestamps[0]! >= this.restartWindowMs
    ) {
      this.restartTimestamps.shift()
    }
    if (this.restartTimestamps.length >= this.maxRestarts) {
      this.state = 'failed'
      this.rejectReady?.(new Error(`Runtime exited with code ${String(code)}`))
      return
    }

    this.state = 'degraded'
    this.restartTimestamps.push(now)
    void this.spawn(preservePendingStart)
  }

  private finishStop(): void {
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer)
    this.shutdownTimer = null
    this.currentProcess = null
    this.serviceBaseUrl = null
    this.serviceDescriptorValue = null
    this.state = 'stopped'
    this.resolveStop?.()
    this.resolveStop = null
  }
}

export type ElectronRuntimeProcessFactoryOptions = {
  databasePath: string
  workspaceRoot: string
  serviceToken?: string
  credentialKey?: string
  onEndpoint(endpoint: RuntimeMessageEndpoint): void
}

export function createElectronRuntimeProcessFactory(
  options: ElectronRuntimeProcessFactoryOptions
): RuntimeProcessFactory {
  return {
    fork(entryPath) {
      const child = utilityProcess.fork(entryPath, [], {
        env: {
          ...process.env,
          ACTIONDRIVER_RUNTIME_DATABASE_PATH: options.databasePath,
          ACTIONDRIVER_WORKSPACE_ROOT: options.workspaceRoot,
          ...(options.serviceToken ? { ACTIONDRIVER_SERVICE_TOKEN: options.serviceToken } : {}),
          ...(options.credentialKey ? { ACTIONDRIVER_CREDENTIAL_KEY: options.credentialKey } : {})
        }
      })
      const messageChannel = new MessageChannelMain()
      const runtimeChannel = adaptRuntimeMessageChannel(messageChannel)
      options.onEndpoint(runtimeChannel.endpoint)
      child.postMessage({ type: 'runtime.connect' }, [messageChannel.port2])
      return {
        postMessage(message) {
          child.postMessage(message)
        },
        kill() {
          child.kill()
        },
        on(event, listener) {
          if (event === 'message') {
            child.on('message', listener as (message: unknown) => void)
          } else {
            child.on('exit', listener as (code: number) => void)
          }
        }
      }
    }
  }
}
