import type { BrowserWindowConstructorOptions } from 'electron'
import { Container } from 'inversify'
import type { AgentRuntimeClient } from './agent-ipc'
import type { ModelConnectionService } from '@actiondriver/model-connections'
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
  modelConnectionService: Symbol.for('actiondriver.model-connection-service'),
  windowOptionsFactory: Symbol.for('actiondriver.window-options-factory')
} as const

export interface MainServices {
  skillProviderHost: SkillProviderHost
  runtimeClient: AgentRuntimeClient | null
  runtimeSupervisor: RuntimeSupervisor | null
  modelConnectionService: ModelConnectionService | null
  windowOptionsFactory: WindowOptionsFactory
}

export type MainContainerOptions =
  | { mode: 'mock' }
  | {
      mode: 'local'
      runtimeClient: AgentRuntimeClient
      runtimeSupervisor: RuntimeSupervisor
      skillProviderHost: SkillProviderHost
      modelConnectionService?: ModelConnectionService
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
  container
    .bind<ModelConnectionService | null>(MAIN_TYPES.modelConnectionService)
    .toConstantValue(
      options.mode === 'local' ? (options.modelConnectionService ?? null) : null
    )
  return container
}

export function resolveMainServices(container: Container): MainServices {
  return {
    skillProviderHost: container.get(MAIN_TYPES.skillProviderHost),
    runtimeClient: container.get(MAIN_TYPES.runtimeClient),
    runtimeSupervisor: container.get(MAIN_TYPES.runtimeSupervisor),
    modelConnectionService: container.get(MAIN_TYPES.modelConnectionService),
    windowOptionsFactory: container.get(MAIN_TYPES.windowOptionsFactory)
  }
}
