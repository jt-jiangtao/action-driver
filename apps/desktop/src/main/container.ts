import type { BrowserWindowConstructorOptions } from 'electron'
import { Container } from 'inversify'
import { createMainWindowOptions } from './window-options'
import { createMockSkillProviderHost, type SkillProviderHost } from './skill-provider-host'

export type WindowOptionsFactory = (preloadPath: string) => BrowserWindowConstructorOptions

const MAIN_TYPES = {
  skillProviderHost: Symbol.for('actiondriver.skill-provider-host'),
  windowOptionsFactory: Symbol.for('actiondriver.window-options-factory')
} as const

export interface MainServices {
  skillProviderHost: SkillProviderHost
  windowOptionsFactory: WindowOptionsFactory
}

export function createMainContainer(): Container {
  const container = new Container()
  container
    .bind<WindowOptionsFactory>(MAIN_TYPES.windowOptionsFactory)
    .toConstantValue(createMainWindowOptions)
  container
    .bind<SkillProviderHost>(MAIN_TYPES.skillProviderHost)
    .toConstantValue(createMockSkillProviderHost())
  return container
}

export function resolveMainServices(container: Container): MainServices {
  return {
    skillProviderHost: container.get(MAIN_TYPES.skillProviderHost),
    windowOptionsFactory: container.get(MAIN_TYPES.windowOptionsFactory)
  }
}
