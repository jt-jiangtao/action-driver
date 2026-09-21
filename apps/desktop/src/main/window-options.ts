import type { BrowserWindowConstructorOptions } from 'electron'
import { APP_NAME } from './app-identity'

export function createMainWindowOptions(
  _preloadPath: string,
  iconPath: string
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    useContentSize: true,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: '#FFFFFF',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 17 },
    webPreferences: {
      preload: _preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}
