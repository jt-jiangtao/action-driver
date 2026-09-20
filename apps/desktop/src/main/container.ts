import type { BrowserWindowConstructorOptions } from 'electron'
import { Container } from 'inversify'
import { createMainWindowOptions } from './window-options'

export type WindowOptionsFactory = (preloadPath: string) => BrowserWindowConstructorOptions

const MAIN_TYPES = {
  windowOptionsFactory: Symbol.for('actiondriver.window-options-factory')
} as const

export interface MainServices {
  windowOptionsFactory: WindowOptionsFactory
}

export function createMainContainer(): Container {
  const container = new Container()
  container
    .bind<WindowOptionsFactory>(MAIN_TYPES.windowOptionsFactory)
    .toConstantValue(createMainWindowOptions)
  return container
}

export function resolveMainServices(container: Container): MainServices {
  return { windowOptionsFactory: container.get(MAIN_TYPES.windowOptionsFactory) }
}
