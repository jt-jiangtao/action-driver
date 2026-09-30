import type { DesktopApi } from '../../preload/desktop-api'

declare global {
  interface Window {
    productDesktop: DesktopApi
  }
}

export {}
