import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillProviderHost,
  createMockSkillProviderHost,
  type HostedSkillProvider
} from './skill-provider-host'

afterEach(() => {
  vi.useRealTimers()
})

describe('SkillProviderHost', () => {
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
