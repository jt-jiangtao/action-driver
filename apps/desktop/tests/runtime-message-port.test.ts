import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  adaptRuntimeMessageChannel,
  createMessagePortMainEndpoint
} from '../src/main/runtime-message-port'

class FakeMessagePortMain extends EventEmitter {
  readonly postMessage = vi.fn()
  readonly start = vi.fn()
}

describe('MessagePortMain runtime endpoint', () => {
  it('starts the port, unwraps MessageEvent data, and observes close', () => {
    const port = new FakeMessagePortMain()
    const endpoint = createMessagePortMainEndpoint(port)
    const onMessage = vi.fn()
    const onClose = vi.fn()
    endpoint.onMessage(onMessage)
    endpoint.onClose(onClose)

    endpoint.postMessage({ type: 'test' })
    port.emit('message', { data: { type: 'reply' }, ports: [] })
    port.emit('close')

    expect(port.start).toHaveBeenCalledOnce()
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'test' })
    expect(onMessage).toHaveBeenCalledWith({ type: 'reply' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the peer port separate for transfer to the UtilityProcess', () => {
    const port1 = new FakeMessagePortMain()
    const port2 = new FakeMessagePortMain()

    const channel = adaptRuntimeMessageChannel({ port1, port2 })

    expect(channel.transferPort).toBe(port2)
    expect(port1.start).toHaveBeenCalledOnce()
    expect(port2.start).not.toHaveBeenCalled()
  })
})
