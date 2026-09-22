import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
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

    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'runtime.ready', service: null })

    parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
  })

  it('reports the HTTP service address when the client injected a token', async () => {
    const parentPort = new FakeParentPort()
    const runtimePort = new LinkedPort()
    const mainPort = new LinkedPort()
    runtimePort.peer = mainPort
    mainPort.peer = runtimePort
    const exit = vi.fn()
    const databasePath = join(mkdtempSync(join(tmpdir(), 'actiondriver-http-')), 'runtime.db')

    const started = startAgentRuntimeProcess(parentPort, databasePath, exit, {
      ACTIONDRIVER_SERVICE_TOKEN: 'service-token',
      ACTIONDRIVER_CREDENTIAL_KEY: 'credential-secret',
      ACTIONDRIVER_RUNTIME_VERSION: '1.2.3'
    })
    parentPort.emit('message', {
      data: { type: 'runtime.connect' },
      ports: [runtimePort]
    })
    await started

    const readyMessage = parentPort.postMessage.mock.calls.find(
      ([message]) => (message as { type: string }).type === 'runtime.ready'
    )?.[0] as { type: string; service: { baseUrl: string } }
    expect(readyMessage.service.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const socket = new WebSocket(`${readyMessage.service.baseUrl.replace('http:', 'ws:')}/stream`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const nextMessage = () =>
      new Promise<Record<string, unknown>>((resolve) => {
        socket.once('message', (data) =>
          resolve(JSON.parse(data.toString()) as Record<string, unknown>)
        )
      })
    let message = nextMessage()
    socket.send(
      JSON.stringify({
        type: 'auth',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-auth',
        createdAt: '2026-09-23T00:00:00.000Z',
        payload: { token: 'service-token' }
      })
    )
    await expect(message).resolves.toMatchObject({ type: 'session.ready' })
    message = nextMessage()
    socket.send(
      JSON.stringify({
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-resume',
        createdAt: '2026-09-23T00:00:01.000Z',
        requestId: 'missing-request',
        afterCursor: 0
      })
    )
    await expect(message).resolves.toMatchObject({
      type: 'request.error',
      requestId: 'missing-request'
    })
    socket.close()

    parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
  })
})
