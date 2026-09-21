import { join } from 'node:path'

export const APP_NAME = 'ActionDriver'

export type ApplicationNameTarget = {
  setName(name: string): void
}

export function applyApplicationName(application: ApplicationNameTarget): void {
  application.setName(APP_NAME)
}

export type DockIconTarget = {
  dock?: {
    setIcon(iconPath: string): unknown
  } | undefined
}

export function applyDockIcon(application: DockIconTarget, iconPath: string): void {
  application.dock?.setIcon(iconPath)
}

export function resolveDesktopIconPath(compiledMainDirectory: string): string {
  return join(compiledMainDirectory, '..', '..', 'resources', 'actiondriver.png')
}
