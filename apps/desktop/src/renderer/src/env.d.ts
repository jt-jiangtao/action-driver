import type { DesktopApi } from '../../preload/desktop-api'

declare global {
  interface Window {
    actionDriverDesktop: DesktopApi
  }
}

export {}
