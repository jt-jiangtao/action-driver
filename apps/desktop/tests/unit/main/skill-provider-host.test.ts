import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillProviderHost,
  createMockSkillProviderHost,
  createProductionSkillProviderHost,
  type HostedSkillProvider
} from '../../../src/main/skill-provider-host'

afterEach(() => {
  vi.useRealTimers()
})

describe('SkillProviderHost', () => {
  it('keeps Browser and Computer unavailable in production without real providers', async () => {
    const host = createProductionSkillProviderHost()
    expect(host.hasSkill('browser-use')).toBe(false)
    expect(host.hasSkill('computer-use')).toBe(false)
    await expect(host.execute({
      invocationId: 'browser-production', requestedSkillId: 'browser-use',
      resolvedProviderId: 'mock.browser', providerVersion: '1.0.0', input: {}
    }, Date.now() + 1_000)).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })

  it('reports a requested user hand-off back to the Runtime', async () => {
    const host = createMockSkillProviderHost()

    await expect(
      host.execute(
        {
          invocationId: 'browser-handoff',
          requestedSkillId: 'browser-use',
          resolvedProviderId: 'mock.browser',
          providerVersion: '1.0.0',
          input: { goal: '预订酒店', needsUser: true }
        },
        Date.now() + 1_000
      )
    ).resolves.toMatchObject({
      output: { providerId: 'mock.browser', needsUser: true }
    })
  })

  it('executes independent Mock Browser and Computer reverse calls', async () => {
    const host = createMockSkillProviderHost()

    await expect(
      host.execute(
        {
          invocationId: 'browser-1',
          requestedSkillId: 'browser-use',
          resolvedProviderId: 'mock.browser',
          providerVersion: '1.0.0',
          input: { action: 'open-url', url: 'https://example.com' }
        },
        Date.now() + 1_000
      )
    ).resolves.toMatchObject({
      output: {
        providerId: 'mock.browser',
        input: { action: 'open-url', url: 'https://example.com' }
      }
    })

    await expect(
      host.execute(
        {
          invocationId: 'computer-1',
          requestedSkillId: 'computer-use',
          resolvedProviderId: 'mock.computer',
          providerVersion: '1.0.0',
          input: { action: 'activate-app', bundleId: 'com.example.app' }
        },
        Date.now() + 1_000
      )
    ).resolves.toMatchObject({ output: { providerId: 'mock.computer' } })
  })

  it('checks the current Skill authorization before every reverse call', async () => {
    const host = createMockSkillProviderHost()
    const authorize = vi.fn(async () => {
      throw new Error('CAPABILITY_UNAVAILABLE: browser-use')
    })

    await expect(
      host.execute(
        {
          invocationId: 'browser-disabled',
          requestedSkillId: 'browser-use',
          resolvedProviderId: 'mock.browser',
          providerVersion: '1.0.0',
          input: {}
        },
        Date.now() + 1_000,
        authorize
      )
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE: browser-use')
    expect(authorize).toHaveBeenCalledWith('browser-use')
    expect(host.getInvocationState('browser-disabled')).toBeUndefined()
  })

  it('rejects calls after a provider goes offline without affecting other providers', async () => {
    const host = createMockSkillProviderHost()
    expect(host.unregister('mock.browser')).toBe(true)

    await expect(
      host.execute(
        {
          invocationId: 'browser-offline',
          requestedSkillId: 'browser-use',
          resolvedProviderId: 'mock.browser',
          providerVersion: '1.0.0',
          input: {}
        },
        Date.now() + 1_000
      )
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })

    await expect(
      host.execute(
        {
          invocationId: 'computer-online',
          requestedSkillId: 'computer-use',
          resolvedProviderId: 'mock.computer',
          providerVersion: '1.0.0',
          input: {}
        },
        Date.now() + 1_000
      )
    ).resolves.toBeTruthy()
  })

  it('keeps timeout terminal when a provider response arrives late', async () => {
    vi.useFakeTimers()
    let resolveProvider!: (value: unknown) => void
    const provider: HostedSkillProvider = {
      providerId: 'mock.slow-browser',
      providerVersion: '1.0.0',
      skillId: 'browser-use',
      async execute() {
        return new Promise((resolve) => {
          resolveProvider = resolve
        })
      }
    }
    const host = new SkillProviderHost()
    host.register(provider)
    const execution = host.execute(
      {
        invocationId: 'slow-1',
        requestedSkillId: 'browser-use',
        resolvedProviderId: provider.providerId,
        providerVersion: provider.providerVersion,
        input: {}
      },
      Date.now() + 50
    )

    const rejection = expect(execution).rejects.toMatchObject({ code: 'SKILL_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(50)
    await rejection
    expect(host.getInvocationState('slow-1')).toBe('timed_out')

    resolveProvider({ late: true })
    await vi.runAllTimersAsync()
    expect(host.getInvocationState('slow-1')).toBe('timed_out')
  })
})
