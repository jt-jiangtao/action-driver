import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startAgentRuntimeProcess } from '../src/runtime-process'

class FakeParentPort extends EventEmitter {
  readonly postMessage = vi.fn()
}

class LinkedPort extends EventEmitter {
  peer?: LinkedPort

  start(): void {}

  postMessage(message: unknown): void {
    queueMicrotask(() => this.peer?.emit('message', { data: message }))
  }
}

describe('Agent Runtime process entry', () => {
  it('announces readiness after receiving the private port and closes on shutdown', async () => {
    const parentPort = new FakeParentPort()
    const runtimePort = new LinkedPort()
    const mainPort = new LinkedPort()
    runtimePort.peer = mainPort
    mainPort.peer = runtimePort
    const exit = vi.fn()
    const databasePath = join(mkdtempSync(join(tmpdir(), 'actiondriver-process-')), 'runtime.db')
    const started = startAgentRuntimeProcess(parentPort, databasePath, exit)

    parentPort.emit('message', {
      data: { type: 'runtime.connect' },
      ports: [runtimePort]
    })
    await started

    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'runtime.ready' })

    parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
  })
})
