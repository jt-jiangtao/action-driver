import type { SkillProvider, SkillRegistry } from './ports'

export class CapabilityUnavailableError extends Error {
  readonly code = 'CAPABILITY_UNAVAILABLE'

  constructor(skillId: string, contractVersion: number) {
    super(`CAPABILITY_UNAVAILABLE: ${skillId}@${contractVersion}`)
    this.name = 'CapabilityUnavailableError'
  }
}

export class RuntimeSkillRegistry implements SkillRegistry {
  private readonly providers = new Map<string, SkillProvider>()
  private readonly registrationsByProvider = new Map<string, Set<string>>()

  register(provider: SkillProvider): void {
    const key = this.key(provider.skillId, provider.contractVersion)
    const previous = this.providers.get(key)
    if (previous) this.registrationsByProvider.get(previous.providerId)?.delete(key)

    this.providers.set(key, provider)
    const registrations = this.registrationsByProvider.get(provider.providerId) ?? new Set<string>()
    registrations.add(key)
    this.registrationsByProvider.set(provider.providerId, registrations)
  }

  unregister(providerId: string): boolean {
    const registrations = this.registrationsByProvider.get(providerId)
    if (!registrations) return false

    for (const key of registrations) {
      if (this.providers.get(key)?.providerId === providerId) this.providers.delete(key)
    }
    this.registrationsByProvider.delete(providerId)
    return true
  }

  resolve(skillId: string, contractVersion: number): SkillProvider {
    const provider = this.providers.get(this.key(skillId, contractVersion))
    if (!provider) throw new CapabilityUnavailableError(skillId, contractVersion)
    return provider
  }

  private key(skillId: string, contractVersion: number): string {
    return `${skillId}@${contractVersion}`
  }
}
