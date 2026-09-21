import { describe, expect, it } from 'vitest'
import type { AgentRuntimeClient } from './agent-ipc'
import { createMainContainer, resolveMainServices } from './container'
import { ModelConnectionService } from './model-connections/model-connection-service'
import type { RuntimeSupervisor } from './runtime-supervisor'
import { SkillProviderHost } from './skill-provider-host'

describe('main composition root', () => {
  it('resolves the window factory through Inversify', () => {
    const services = resolveMainServices(createMainContainer({ mode: 'mock' }))
    const options = services.windowOptionsFactory('/tmp/preload.js', '/tmp/actiondriver.png')

    expect(options.width).toBe(1440)
    expect(options.title).toBe('ActionDriver')
    expect(options.icon).toBe('/tmp/actiondriver.png')
    expect(options.webPreferences?.preload).toBe('/tmp/preload.js')
  })

  it('binds the Mock SkillProviderHost in the Main composition root', () => {
    const services = resolveMainServices(createMainContainer({ mode: 'mock' }))

    expect(services.skillProviderHost).toBeInstanceOf(SkillProviderHost)
    expect(services.runtimeSupervisor).toBeNull()
    expect(services.runtimeClient).toBeNull()
    expect(services.modelConnectionService).toBeNull()
  })

  it('binds the local Runtime lifecycle and client without changing Main consumers', () => {
    const runtimeSupervisor = {
      start: async () => undefined,
      stop: async () => undefined
    } as RuntimeSupervisor
    const runtimeClient = {
      request: async () => ({ accepted: true }),
      subscribeEvents: async () => ({ subscriptionId: 'subscription-1', cursor: 0 })
    } as unknown as AgentRuntimeClient
    const skillProviderHost = new SkillProviderHost()
    const modelConnectionService = new ModelConnectionService({
      store: { read: () => [], write: () => undefined },
      cipher: { isAvailable: () => true, encrypt: (value) => value, decrypt: (value) => value },
      transport: { request: async () => ({ status: 200, body: {}, text: '' }) }
    })

    const services = resolveMainServices(
      createMainContainer({
        mode: 'local',
        runtimeSupervisor,
        runtimeClient,
        skillProviderHost,
        modelConnectionService
      })
    )

    expect(services.runtimeSupervisor).toBe(runtimeSupervisor)
    expect(services.runtimeClient).toBe(runtimeClient)
    expect(services.skillProviderHost).toBe(skillProviderHost)
    expect(services.modelConnectionService).toBe(modelConnectionService)
  })
})
