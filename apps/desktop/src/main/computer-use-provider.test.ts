import { describe, expect, it, vi } from 'vitest'
import { createComputerUseProvider } from './computer-use-provider'

describe('Computer Use provider', () => {
  // 4.1 removed the observation-based observe/capture operations, so the provider surface is
  // app-addressed only: app policy, session-scoped state and session supervision.
  it('carries the app-addressed state calls the JavaScript entry depends on', async () => {
    const execute = vi.fn(async () => ({ apps: [] }))
    const provider = createComputerUseProvider({ execute })
    expect(provider).toMatchObject({ skillId: 'computer-use', providerId: 'native.computer-use' })
    await provider.execute({ operation: 'list-apps' })
    await provider.execute({ operation: 'app-state', sessionId: 'session-1', app: 'TextEdit',
      maxElements: 300, maxDepth: 12, disableDiff: true })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ operation: 'list-apps' }), undefined)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'app-state', sessionId: 'session-1', app: 'TextEdit',
      maxElements: 300, maxDepth: 12, disableDiff: true
    }), undefined)
    await expect(provider.execute({ operation: 'observe', maxElements: 50, maxDepth: 5 }))
      .rejects.toThrow('Unsupported Computer Use command')
    await expect(provider.execute({ operation: 'shutdown' }))
      .rejects.toThrow('Unsupported Computer Use command')
  })
})
