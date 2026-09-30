import { utilityProcess } from 'electron'

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
  private stopPromise: Promise<void> | null = null
  private resolveStop: (() => void) | null = null
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null
  private readonly restartTimestamps: number[] = []
  private lastFailureMessage: string | null = null
  private readonly maxRestarts: number
  private readonly restartWindowMs: number
  private readonly shutdownTimeoutMs: number
  private readonly now: () => number
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
    this.onServiceReady = options.onServiceReady
  }

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve()
    if (this.state === 'starting' && this.readyPromise) return this.readyPromise
    if (this.state === 'stopping') return Promise.reject(new Error('Runtime is stopping'))
    if (this.state === 'failed')
      return Promise.reject(new Error('Runtime restart budget exhausted'))
    this.lastFailureMessage = null
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
    if (typeof message === 'object' && message !== null && 'type' in message &&
        message.type === 'runtime.failed' && 'message' in message && typeof message.message === 'string') {
      this.lastFailureMessage = message.message
      // A Runtime that fails before serving must be visible, not only recorded for the UI.
      console.error('[runtime] failed to start', message.message)
      return
    }
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'runtime.ready'
    ) {
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
          if (this.currentProcess !== process) return
          this.state = 'failed'
          this.currentProcess = null
          this.serviceBaseUrl = null
          this.serviceDescriptorValue = null
          process.kill()
          this.rejectReady?.(error instanceof Error ? error : new Error(String(error)))
          this.resolveReady = null
          this.rejectReady = null
          return
        }
        if (this.currentProcess !== process) return
      }
      this.state = 'ready'
      this.lastFailureMessage = null
      this.resolveReady?.()
      this.resolveReady = null
      this.rejectReady = null
    }
  }

  private handleExit(process: RuntimeProcess, code: number | null): void {
    if (this.currentProcess !== process) return
    console.error(`[runtime] exited with code ${String(code)} (state=${this.state})`)
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
      this.rejectReady?.(new Error(this.lastFailureMessage ?? `Runtime exited with code ${String(code)}`))
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
  dataRoot: string
  workspaceRoot: string
  agentHomeDirectory?: string
  serviceToken?: string
  credentialKey?: string
  trustedRendererOrigin?: string
}

/**
 * Environment for the Runtime utility process. The trusted Computer Use host inside the Runtime
 * loads the vendored `@oai/sky` sources through `vm.SourceTextModule`, and Electron only enables
 * that API through `NODE_OPTIONS` — `execArgv` is ignored for utility processes.
 */
export function runtimeProcessEnvironment(
  options: ElectronRuntimeProcessFactoryOptions,
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const nodeOptions = [base.NODE_OPTIONS?.trim(), '--experimental-vm-modules']
    .filter((value): value is string => Boolean(value))
    .join(' ')
  return {
    ...base,
    NODE_OPTIONS: nodeOptions,
    ACTION_DRIVER_RUNTIME_DATA_ROOT: options.dataRoot,
    ACTION_DRIVER_WORKSPACE_ROOT: options.workspaceRoot,
    ...(options.agentHomeDirectory ? { ACTION_DRIVER_AGENT_HOME: options.agentHomeDirectory } : {}),
    ...(options.serviceToken ? { ACTION_DRIVER_SERVICE_TOKEN: options.serviceToken } : {}),
    ...(options.credentialKey ? { ACTION_DRIVER_CREDENTIAL_KEY: options.credentialKey } : {}),
    ACTION_DRIVER_RENDERER_ORIGIN: options.trustedRendererOrigin ?? ''
  }
}

export function createElectronRuntimeProcessFactory(
  options: ElectronRuntimeProcessFactoryOptions
): RuntimeProcessFactory {
  return {
    fork(entryPath) {
      const child = utilityProcess.fork(entryPath, [], {
        env: runtimeProcessEnvironment(options),
        // A Runtime that dies before serving used to fail silently; keep its output visible.
        stdio: ['ignore', 'pipe', 'pipe']
      })
      child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[runtime] ${chunk}`))
      child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[runtime] ${chunk}`))
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
