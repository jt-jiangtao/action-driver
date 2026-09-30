import { describe, expect, it } from 'vitest'
import { STREAM_PROTOCOL } from '@action-driver/runtime-contracts'
import { registerRuntimeConnectionIpc } from '../../../src/main/runtime-connection-ipc'
import { RUNTIME_CONNECTION_IPC_CHANNEL } from '../../../src/shared/runtime-connection-contract'

describe('runtime connection IPC', () => {
  it('exposes the ready stream descriptor without putting the token in the URL', async () => {
    let handler: (() => unknown) | undefined
    registerRuntimeConnectionIpc(
      {
        handle(channel, registered) {
          expect(channel).toBe(RUNTIME_CONNECTION_IPC_CHANNEL)
          handler = registered
        }
      },
      {
        baseUrl: 'http://127.0.0.1:4321',
        streamPath: '/stream',
        streamProtocol: STREAM_PROTOCOL
      },
      'launch-token'
    )

    expect(await handler?.()).toEqual({
      wsUrl: 'ws://127.0.0.1:4321/stream',
      protocol: STREAM_PROTOCOL,
      accessToken: 'launch-token'
    })
  })
})
