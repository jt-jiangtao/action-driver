import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createParentPortEndpoint, waitForRuntimeMessagePort } from '../src/parent-port-endpoint'

class FakeParentPort extends EventEmitter {
  readonly postMessage = vi.fn()
}

class FakeTransferredPort extends FakeParentPort {
  readonly start = vi.fn()
}

describe('parentPort runtime endpoint', () => {
  it('unwraps MessageEvent data and uses process exit as disconnect', () => {
    const port = new FakeParentPort()
    const lifecycle = new EventEmitter()
    const endpoint = createParentPortEndpoint(port, lifecycle)
    const onMessage = vi.fn()
    const onClose = vi.fn()
    endpoint.onMessage(onMessage)
    endpoint.onClose(onClose)

    endpoint.postMessage({ type: 'test' })
    port.emit('message', { data: { type: 'reply' }, ports: [] })
    lifecycle.emit('exit')

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'test' })
    expect(onMessage).toHaveBeenCalledWith({ type: 'reply' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('accepts the private MessageChannel port transferred through parentPort', async () => {
    const parentPort = new FakeParentPort()
    const transferredPort = new FakeTransferredPort()
    const endpointPromise = waitForRuntimeMessagePort(parentPort)

    parentPort.emit('message', {
      data: { type: 'runtime.connect' },
      ports: [transferredPort]
    })
    const endpoint = await endpointPromise
    endpoint.postMessage({ type: 'handshake.request' })

    expect(transferredPort.start).toHaveBeenCalledOnce()
    expect(transferredPort.postMessage).toHaveBeenCalledWith({ type: 'handshake.request' })
  })
})
