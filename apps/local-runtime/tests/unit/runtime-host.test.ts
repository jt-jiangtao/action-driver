import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElectronRuntimeHost } from '../../src/electron-host'
import { createNodeRuntimeHost } from '../../src/node-host'
import { startHostedLocalRuntime } from '../../src/runtime-host-runner'

describe('runtime hosts', () => {
  it('preserves the Electron ready descriptor and handles shutdown once', () => {
    const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
    const host = createElectronRuntimeHost(parent)
    const shutdown = vi.fn()
    host.onShutdown(shutdown)
    host.ready({
      service: {
        baseUrl: 'http://127.0.0.1:1234',
        streamPath: '/stream',
        streamProtocol: 'action-driver.stream.v2'
      }
    })
    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'runtime.ready',
      service: {
        baseUrl: 'http://127.0.0.1:1234',
        streamPath: '/stream',
        streamProtocol: 'action-driver.stream.v2'
      }
    })
    parent.emit('message', { data: { type: 'runtime.shutdown' } })
    parent.emit('message', { data: { type: 'runtime.shutdown' } })
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('uses process signals and unsubscribes after the first shutdown', () => {
    const signals = new EventEmitter()
    const host = createNodeRuntimeHost(signals, vi.fn())
    const shutdown = vi.fn()
    host.onShutdown(shutdown)
    signals.emit('SIGTERM')
    signals.emit('SIGINT')
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing lifecycle host before creating runtime files', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'action-driver-missing-host-'))
    await expect(
      startHostedLocalRuntime(null, {
        dataRoot,
        workspaceRoot: mkdtempSync(join(tmpdir(), 'action-driver-missing-host-workspace-'))
      })
    ).rejects.toThrow('RUNTIME_HOST_UNAVAILABLE')
    expect(existsSync(join(dataRoot, 'state.sqlite'))).toBe(false)
  })
})
