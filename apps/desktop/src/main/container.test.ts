import { describe, expect, it } from 'vitest'
import { createMainContainer, resolveMainServices } from './container'
import { SkillProviderHost } from './skill-provider-host'

describe('main composition root', () => {
  it('resolves the window factory through Inversify', () => {
    const services = resolveMainServices(createMainContainer())
    const options = services.windowOptionsFactory('/tmp/preload.js')

    expect(options.width).toBe(1440)
    expect(options.webPreferences?.preload).toBe('/tmp/preload.js')
  })

  it('binds the Mock SkillProviderHost in the Main composition root', () => {
    const services = resolveMainServices(createMainContainer())

    expect(services.skillProviderHost).toBeInstanceOf(SkillProviderHost)
  })
})
