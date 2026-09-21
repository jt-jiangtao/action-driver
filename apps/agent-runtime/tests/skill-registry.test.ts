import { describe, expect, it } from 'vitest'
import { RuntimeSkillRegistry, type SkillProvider, type SkillProviderResult } from '../src/index'

function provider(skillId: string, providerId: string, contractVersion = 1): SkillProvider {
  return {
    skillId,
    providerId,
    providerVersion: '1.0.0',
    contractVersion,
    async execute({ input }): Promise<SkillProviderResult> {
      return { ok: true, providerId, input }
    }
  }
}

describe('RuntimeSkillRegistry', () => {
  it('registers and resolves providers by skill id plus contract version', () => {
    const registry = new RuntimeSkillRegistry()
    const browserV1 = provider('browser-use', 'browser.mock.v1', 1)
    const browserV2 = provider('browser-use', 'browser.mock.v2', 2)

    registry.register(browserV1)
    registry.register(browserV2)

    expect(registry.resolve('browser-use', 1)).toBe(browserV1)
    expect(registry.resolve('browser-use', 2)).toBe(browserV2)
  })

  it('takes one provider offline without affecting another capability', () => {
    const registry = new RuntimeSkillRegistry()
    const browser = provider('browser-use', 'browser.mock')
    const computer = provider('computer-use', 'computer.mock')
    registry.register(browser)
    registry.register(computer)

    expect(registry.unregister(browser.providerId)).toBe(true)
    expect(() => registry.resolve('browser-use', 1)).toThrow(
      'CAPABILITY_UNAVAILABLE: browser-use@1'
    )
    expect(registry.resolve('computer-use', 1)).toBe(computer)
    expect(registry.unregister('missing.provider')).toBe(false)
  })

  it('returns a typed capability error for missing versions', () => {
    const registry = new RuntimeSkillRegistry()

    try {
      registry.resolve('browser-use', 9)
      throw new Error('Expected resolve to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    }
  })
})
