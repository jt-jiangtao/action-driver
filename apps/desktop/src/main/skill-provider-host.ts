import type { SkillExecuteRequest, SkillExecuteResult } from '@actiondriver/runtime-contracts'

export type HostedSkillProvider = {
  readonly providerId: string
  readonly providerVersion: string
  readonly skillId: string
  execute(input: unknown, signal?: AbortSignal): Promise<unknown>
}

export type HostedInvocationState = 'running' | 'completed' | 'failed' | 'timed_out'

class SkillProviderHostError extends Error {
  constructor(
    readonly code: 'CAPABILITY_UNAVAILABLE' | 'SKILL_TIMEOUT' | 'SKILL_PROVIDER_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'SkillProviderHostError'
  }
}

export class SkillProviderHost {
  private readonly providers = new Map<string, HostedSkillProvider>()
  private readonly invocationStates = new Map<string, HostedInvocationState>()

  register(provider: HostedSkillProvider): void {
    this.providers.set(provider.providerId, provider)
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId)
  }

  getInvocationState(invocationId: string): HostedInvocationState | undefined {
    return this.invocationStates.get(invocationId)
  }

  execute(request: SkillExecuteRequest, deadlineUnixMs: number): Promise<SkillExecuteResult> {
    const provider = this.providers.get(request.resolvedProviderId)
    if (
      !provider ||
      provider.skillId !== request.requestedSkillId ||
      provider.providerVersion !== request.providerVersion
    ) {
      return Promise.reject(
        new SkillProviderHostError(
          'CAPABILITY_UNAVAILABLE',
          `CAPABILITY_UNAVAILABLE: ${request.resolvedProviderId}`
        )
      )
    }

    const remainingMs = deadlineUnixMs - Date.now()
    if (remainingMs <= 0) {
      this.invocationStates.set(request.invocationId, 'timed_out')
      return Promise.reject(
        new SkillProviderHostError('SKILL_TIMEOUT', `SKILL_TIMEOUT: ${request.invocationId}`)
      )
    }

    this.invocationStates.set(request.invocationId, 'running')
    const controller = new AbortController()

    return new Promise<SkillExecuteResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.invocationStates.get(request.invocationId) !== 'running') return
        this.invocationStates.set(request.invocationId, 'timed_out')
        controller.abort()
        reject(
          new SkillProviderHostError('SKILL_TIMEOUT', `SKILL_TIMEOUT: ${request.invocationId}`)
        )
      }, remainingMs)

      void provider.execute(request.input, controller.signal).then(
        (output) => {
          if (this.invocationStates.get(request.invocationId) !== 'running') return
          clearTimeout(timeout)
          this.invocationStates.set(request.invocationId, 'completed')
          resolve({
            event: {
              id: `event:${request.invocationId}:completed`,
              invocationId: request.invocationId,
              skillId: request.requestedSkillId,
              state: 'succeeded',
              occurredAt: new Date().toISOString()
            },
            output
          })
        },
        (error: unknown) => {
          if (this.invocationStates.get(request.invocationId) !== 'running') return
          clearTimeout(timeout)
          this.invocationStates.set(request.invocationId, 'failed')
          reject(
            new SkillProviderHostError(
              'SKILL_PROVIDER_FAILED',
              error instanceof Error ? error.message : String(error)
            )
          )
        }
      )
    })
  }
}

export function createMockSkillProviderHost(): SkillProviderHost {
  const host = new SkillProviderHost()
  host.register(createEchoProvider('browser-use', 'mock.browser'))
  host.register(createEchoProvider('computer-use', 'mock.computer'))
  return host
}

function createEchoProvider(skillId: string, providerId: string): HostedSkillProvider {
  return {
    skillId,
    providerId,
    providerVersion: '1.0.0',
    async execute(input) {
      return { providerId, input }
    }
  }
}
