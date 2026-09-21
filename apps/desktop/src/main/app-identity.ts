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
    setIcon(icon: string | unknown): unknown
  } | undefined
}

export function applyDockIcon(application: DockIconTarget, iconPath: string): void {
  application.dock?.setIcon(iconPath)
}

/**
 * Resolves the brand icon used for the window and the Dock.
 *
 * A development run still executes the Electron bundle, so macOS derives the Dock *name* from that
 * bundle and only the runtime icon override applies. Packaged builds must additionally carry
 * CFBundleName/CFBundleDisplayName/CFBundleIconFile, otherwise the Dock falls back to the Electron
 * bundle icon while the app is starting or quitting.
 */
export function resolveDesktopIconPath(compiledMainDirectory: string): string {
  return join(compiledMainDirectory, '..', '..', 'resources', 'actiondriver.png')
}
