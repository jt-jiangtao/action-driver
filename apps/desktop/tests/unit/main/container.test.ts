import { describe, expect, it } from 'vitest'
import { createMainServices } from '../../../src/main/container'
import type { RuntimeSupervisor } from '../../../src/main/runtime-supervisor'
import { SkillProviderHost } from '../../../src/main/skill-provider-host'

describe('main composition root', () => {
  it('returns typed services directly from an explicit factory', () => {
    const services = createMainServices({ mode: 'mock' })
    expect(services.windowOptionsFactory('/tmp/preload.js', '/tmp/icon.png').title).toBe('ActionDriver')
    expect(services.runtimeSupervisor).toBeNull()
  })

  it('provides the window factory directly', () => {
    const services = createMainServices({ mode: 'mock' })
    const options = services.windowOptionsFactory('/tmp/preload.js', '/tmp/actiondriver.png')

    expect(options.width).toBe(1440)
    expect(options.title).toBe('ActionDriver')
    expect(options.icon).toBe('/tmp/actiondriver.png')
    expect(options.webPreferences?.preload).toBe('/tmp/preload.js')
  })

  it('provides the Mock SkillProviderHost in the Main composition root', () => {
    const services = createMainServices({ mode: 'mock' })

    expect(services.skillProviderHost).toBeInstanceOf(SkillProviderHost)
    expect(services.runtimeSupervisor).toBeNull()
  })

  it('injects the local Runtime lifecycle and capability host', () => {
    const runtimeSupervisor = {
      start: async () => undefined,
      stop: async () => undefined
    } as RuntimeSupervisor
    const skillProviderHost = new SkillProviderHost()

    const services = createMainServices({
      mode: 'local',
      runtimeSupervisor,
      skillProviderHost
    })

    expect(services.runtimeSupervisor).toBe(runtimeSupervisor)
    expect(services.skillProviderHost).toBe(skillProviderHost)
  })
})
