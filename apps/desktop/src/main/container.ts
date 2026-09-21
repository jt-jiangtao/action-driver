import type { BrowserWindowConstructorOptions } from 'electron'
import { Container } from 'inversify'
import type { AgentRuntimeClient } from './agent-ipc'
import type { RuntimeSupervisor } from './runtime-supervisor'
import { createMainWindowOptions } from './window-options'
import { createMockSkillProviderHost, type SkillProviderHost } from './skill-provider-host'

export type WindowOptionsFactory = (
  preloadPath: string,
  iconPath: string
) => BrowserWindowConstructorOptions

const MAIN_TYPES = {
  skillProviderHost: Symbol.for('actiondriver.skill-provider-host'),
  runtimeClient: Symbol.for('actiondriver.runtime-client'),
  runtimeSupervisor: Symbol.for('actiondriver.runtime-supervisor'),
  windowOptionsFactory: Symbol.for('actiondriver.window-options-factory')
} as const

export interface MainServices {
  skillProviderHost: SkillProviderHost
  runtimeClient: AgentRuntimeClient | null
  runtimeSupervisor: RuntimeSupervisor | null
  windowOptionsFactory: WindowOptionsFactory
}

export type MainContainerOptions =
  | { mode: 'mock' }
  | {
      mode: 'local'
      runtimeClient: AgentRuntimeClient
      runtimeSupervisor: RuntimeSupervisor
      skillProviderHost: SkillProviderHost
    }

export function createMainContainer(options: MainContainerOptions): Container {
  const container = new Container()
  container
    .bind<WindowOptionsFactory>(MAIN_TYPES.windowOptionsFactory)
    .toConstantValue(createMainWindowOptions)
  container
    .bind<SkillProviderHost>(MAIN_TYPES.skillProviderHost)
    .toConstantValue(
      options.mode === 'local' ? options.skillProviderHost : createMockSkillProviderHost()
    )
  container
    .bind<AgentRuntimeClient | null>(MAIN_TYPES.runtimeClient)
    .toConstantValue(options.mode === 'local' ? options.runtimeClient : null)
  container
    .bind<RuntimeSupervisor | null>(MAIN_TYPES.runtimeSupervisor)
    .toConstantValue(options.mode === 'local' ? options.runtimeSupervisor : null)
  return container
}

export function resolveMainServices(container: Container): MainServices {
  return {
    skillProviderHost: container.get(MAIN_TYPES.skillProviderHost),
    runtimeClient: container.get(MAIN_TYPES.runtimeClient),
    runtimeSupervisor: container.get(MAIN_TYPES.runtimeSupervisor),
    windowOptionsFactory: container.get(MAIN_TYPES.windowOptionsFactory)
  }
}
