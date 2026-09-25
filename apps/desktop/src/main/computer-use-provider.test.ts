import { describe, expect, it, vi } from 'vitest'
import { createComputerUseProvider } from './computer-use-provider'

describe('Computer Use provider', () => {
  it('passes a validated observe request to the native helper', async () => {
    const execute = vi.fn(async () => ({ observationId: 'obs-1', tree: {} }))
    const provider = createComputerUseProvider({ execute })
    const result = await provider.execute({ operation: 'observe', maxElements: 50, maxDepth: 5 })
    expect(provider).toMatchObject({ skillId: 'computer-use', providerId: 'native.computer-use' })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      version: 1, operation: 'observe', maxElements: 50, maxDepth: 5
    }), undefined)
    expect(result).toEqual({ observationId: 'obs-1', tree: {} })
  })

  it('passes capture only to the transport that extracts raw bytes before returning a Skill result', async () => {
    const execute = vi.fn(async () => ({ base64: 'sensitive' }))
    const provider = createComputerUseProvider({ execute })
    await provider.execute({ operation: 'capture', maxWidth: 100, maxHeight: 100 })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ operation: 'capture' }), undefined)
  })
})
