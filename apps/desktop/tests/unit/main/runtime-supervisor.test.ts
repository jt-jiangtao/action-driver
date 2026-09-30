import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeSupervisor,
  runtimeProcessEnvironment,
  type RuntimeProcess,
  type RuntimeProcessFactory
} from '../../../src/main/runtime-supervisor'

class FakeRuntimeProcess implements RuntimeProcess {
  readonly messages: unknown[] = []
  readonly kill = vi.fn(() => this.emitExit(0))
  private readonly messageListeners: Array<(message: unknown) => void> = []
  private readonly exitListeners: Array<(code: number | null) => void> = []

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  on(
    event: 'message' | 'exit',
    listener: ((value: unknown) => void) | ((code: number | null) => void)
  ): void {
    if (event === 'message') this.messageListeners.push(listener as (message: unknown) => void)
    else this.exitListeners.push(listener as (code: number | null) => void)
  }

  emitMessage(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message))
  }

  emitExit(code: number | null): void {
    this.exitListeners.forEach((listener) => listener(code))
  }
}

function harness(options: ConstructorParameters<typeof RuntimeSupervisor>[2] = {}) {
  const processes: FakeRuntimeProcess[] = []
  const factory: RuntimeProcessFactory = {
    fork: vi.fn(() => {
      const process = new FakeRuntimeProcess()
      processes.push(process)
      return process
    })
  }
  const supervisor = new RuntimeSupervisor(factory, '/app/local-runtime.js', {
    shutdownTimeoutMs: 1_000,
    ...options
  })
  return { factory, processes, supervisor }
}

describe('RuntimeSupervisor', () => {
  it('enables vm modules for the Runtime process and keeps an existing NODE_OPTIONS', () => {
    expect(
      runtimeProcessEnvironment(
        { dataRoot: '/data', workspaceRoot: '/workspace' },
        { NODE_OPTIONS: '--max-old-space-size=2048' }
      )
    ).toMatchObject({
      NODE_OPTIONS: '--max-old-space-size=2048 --experimental-vm-modules',
      ACTION_DRIVER_RUNTIME_DATA_ROOT: '/data',
      ACTION_DRIVER_WORKSPACE_ROOT: '/workspace'
    })
    expect(
      runtimeProcessEnvironment(
        { dataRoot: '/data', workspaceRoot: '/workspace' },
        {}
      ).NODE_OPTIONS
    ).toBe('--experimental-vm-modules')
  })

  it('waits for the local capability connection before reporting ready', async () => {
    let releaseConnection: (() => void) | undefined
    const onServiceReady = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseConnection = resolve
        })
    )
    const { processes, supervisor } = harness({ onServiceReady })

    const starting = supervisor.start()
    processes[0]?.emitMessage({ type: 'runtime.ready', service: {
      baseUrl: 'http://127.0.0.1:45123', streamPath: '/stream', streamProtocol: 'test'
    } })

    expect(onServiceReady).toHaveBeenCalledOnce()
    expect(supervisor.state).toBe('starting')
    releaseConnection?.()
    await starting
    expect(supervisor.state).toBe('ready')
  })

  it('starts one UtilityProcess for concurrent window requests and becomes ready', async () => {
    const { factory, processes, supervisor } = harness()

    const first = supervisor.start()
    const second = supervisor.start()
    expect(factory.fork).toHaveBeenCalledOnce()
    expect(supervisor.state).toBe('starting')

    processes[0]?.emitMessage({ type: 'runtime.ready' })
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(supervisor.state).toBe('ready')
    expect(supervisor.serviceUrl).toBeNull()
  })

  it('captures the service base URL from the readiness message', async () => {
    const { processes, supervisor } = harness()

    const starting = supervisor.start()
    processes[0]?.emitMessage({
      type: 'runtime.ready',
      service: { baseUrl: 'http://127.0.0.1:45123' }
    })
    await starting

    expect(supervisor.serviceUrl).toBe('http://127.0.0.1:45123')
  })

  it('connects the stream before readiness and reconnects it to a restarted Runtime address', async () => {
    const onServiceReady = vi.fn(async () => undefined)
    const { processes, supervisor } = harness({ onServiceReady })
    const firstStart = supervisor.start()
    processes[0]?.emitMessage({
      type: 'runtime.ready',
      service: {
        baseUrl: 'http://127.0.0.1:45123',
        streamPath: '/stream',
        streamProtocol: 'action-driver.stream.v2'
      }
    })
    await firstStart
    expect(onServiceReady).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://127.0.0.1:45123',
      streamPath: '/stream',
      streamProtocol: 'action-driver.stream.v2'
    })

    processes[0]?.emitExit(1)
    processes[1]?.emitMessage({
      type: 'runtime.ready',
      service: {
        baseUrl: 'http://127.0.0.1:45124',
        streamPath: '/stream',
        streamProtocol: 'action-driver.stream.v2'
      }
    })
    await vi.waitFor(() => expect(supervisor.state).toBe('ready'))
    expect(onServiceReady).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://127.0.0.1:45124',
      streamPath: '/stream',
      streamProtocol: 'action-driver.stream.v2'
    })
  })

  it('ignores a stale capability connection after the Runtime has restarted', async () => {
    let failFirst!: (error: Error) => void
    const firstConnection = new Promise<void>((_resolve, reject) => { failFirst = reject })
    let connectionCount = 0
    const { processes, supervisor } = harness({
      onServiceReady: async () => {
        connectionCount += 1
        if (connectionCount === 1) await firstConnection
      }
    })
    const starting = supervisor.start()
    processes[0]?.emitMessage({ type: 'runtime.ready', service: {
      baseUrl: 'http://127.0.0.1:45123', streamPath: '/stream', streamProtocol: 'test'
    } })
    await vi.waitFor(() => expect(connectionCount).toBe(1))
    processes[0]?.emitExit(1)
    processes[1]?.emitMessage({ type: 'runtime.ready', service: {
      baseUrl: 'http://127.0.0.1:45124', streamPath: '/stream', streamProtocol: 'test'
    } })
    await starting
    failFirst(new Error('stale connection failed'))
    await vi.waitFor(() => expect(connectionCount).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(supervisor.state).toBe('ready')
    expect(supervisor.serviceUrl).toBe('http://127.0.0.1:45124')
  })

  it('terminates a process when capability registration fails during startup', async () => {
    const { processes, supervisor } = harness({
      onServiceReady: async () => { throw new Error('Capability registration failed') }
    })
    const starting = supervisor.start()
    processes[0]?.emitMessage({ type: 'runtime.ready', service: {
      baseUrl: 'http://127.0.0.1:45123', streamPath: '/stream', streamProtocol: 'test'
    } })
    await expect(starting).rejects.toThrow('Capability registration failed')
    expect(processes[0]?.kill).toHaveBeenCalledOnce()
    expect(supervisor.state).toBe('failed')
  })

  it('restarts at most three times inside a 60 second window', async () => {
    const { factory, processes, supervisor } = harness()
    const starting = supervisor.start()
    processes[0]?.emitMessage({ type: 'runtime.ready' })
    await starting

    for (let index = 0; index < 3; index += 1) {
      processes[index]?.emitExit(1)
      expect(supervisor.state).toBe('starting')
      processes[index + 1]?.emitMessage({ type: 'runtime.ready' })
      expect(supervisor.state).toBe('ready')
    }

    processes[3]?.emitExit(1)
    expect(factory.fork).toHaveBeenCalledTimes(4)
    expect(supervisor.state).toBe('failed')
  })

  it('keeps the original start pending across a crash before ready', async () => {
    const { processes, supervisor } = harness()
    const starting = supervisor.start()

    processes[0]?.emitExit(1)
    expect(processes).toHaveLength(2)
    processes[1]?.emitMessage({ type: 'runtime.ready' })

    await expect(starting).resolves.toBeUndefined()
    expect(supervisor.state).toBe('ready')
  })

  it('reports the runtime failure message when startup exhausts its restart budget', async () => {
    const { processes, supervisor } = harness({ maxRestarts: 0 })
    const starting = supervisor.start()
    processes[0]?.emitMessage({ type: 'runtime.failed', message: 'PROTOCOL_ERROR: Undeclared contribution tools/local/command/shell/run' })
    processes[0]?.emitExit(1)
    await expect(starting).rejects.toThrow('Undeclared contribution tools/local/command/shell/run')
  })

  it('sends shutdown and kills the process only after the timeout', async () => {
    vi.useFakeTimers()
    const { processes, supervisor } = harness()
    const starting = supervisor.start()
    processes[0]?.emitMessage({ type: 'runtime.ready' })
    await starting

    const stopping = supervisor.stop()
    expect(supervisor.state).toBe('stopping')
    expect(processes[0]?.messages).toContainEqual({ type: 'runtime.shutdown' })

    await vi.advanceTimersByTimeAsync(999)
    expect(processes[0]?.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await stopping
    expect(processes[0]?.kill).toHaveBeenCalledOnce()
    expect(supervisor.state).toBe('stopped')
    vi.useRealTimers()
  })
})
