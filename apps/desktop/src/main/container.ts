import type { BrowserWindowConstructorOptions } from 'electron'
import type { RuntimeSupervisor } from './runtime-supervisor'
import { createMainWindowOptions } from './window-options'
import { createMockSkillProviderHost, type SkillProviderHost } from './skill-provider-host'

export type WindowOptionsFactory = (
  preloadPath: string,
  iconPath: string
) => BrowserWindowConstructorOptions

export interface MainServices {
  skillProviderHost: SkillProviderHost
  runtimeSupervisor: RuntimeSupervisor | null
  windowOptionsFactory: WindowOptionsFactory
}

export type MainServicesOptions =
  | { mode: 'mock' }
  | {
      mode: 'local'
      runtimeSupervisor: RuntimeSupervisor
      skillProviderHost: SkillProviderHost
    }

export function createMainServices(options: MainServicesOptions): MainServices {
  return {
    windowOptionsFactory: createMainWindowOptions,
    skillProviderHost: options.mode === 'local'
      ? options.skillProviderHost : createMockSkillProviderHost(),
    runtimeSupervisor: options.mode === 'local' ? options.runtimeSupervisor : null,
  }
}
