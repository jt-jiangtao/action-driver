import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './desktop-api'
import { RUNTIME_CONNECTION_IPC_CHANNEL } from '../shared/runtime-connection-contract'

describe('preload Runtime bootstrap', () => {
  it('exposes only environment and the authenticated Runtime connection', async () => {
    const connection = {
      wsUrl: 'ws://127.0.0.1:4321/stream',
      protocol: 'actiondriver.stream.v2',
      accessToken: 'launch-token'
    }
    const invoke = vi.fn(async () => connection)
    const api = createDesktopApi('darwin', '0.1.0', { invoke })
    expect(Object.keys(api).sort()).toEqual(['getEnvironment', 'runtimeConnection', 'skillFolders'])
    expect(api.getEnvironment()).toEqual({ platform: 'darwin', version: '0.1.0' })
    await expect(api.runtimeConnection.get()).resolves.toEqual(connection)
    expect(invoke).toHaveBeenCalledWith(RUNTIME_CONNECTION_IPC_CHANNEL, {})
  })
})
