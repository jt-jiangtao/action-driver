import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeSupervisor,
  type RuntimeProcess,
  type RuntimeProcessFactory
} from './runtime-supervisor'

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

function harness() {
  const processes: FakeRuntimeProcess[] = []
  const factory: RuntimeProcessFactory = {
    fork: vi.fn(() => {
      const process = new FakeRuntimeProcess()
      processes.push(process)
      return process
    })
  }
  const supervisor = new RuntimeSupervisor(factory, '/app/agent-runtime.js', {
    shutdownTimeoutMs: 1_000
  })
  return { factory, processes, supervisor }
}

describe('RuntimeSupervisor', () => {
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
