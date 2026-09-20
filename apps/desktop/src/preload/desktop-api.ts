export interface DesktopApi {
  getEnvironment(): { platform: NodeJS.Platform; version: string }
}

export function createDesktopApi(platform: NodeJS.Platform, version: string): DesktopApi {
  return {
    getEnvironment: () => ({ platform, version })
  }
}
