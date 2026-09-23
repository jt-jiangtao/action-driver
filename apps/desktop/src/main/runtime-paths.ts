import { resolve } from 'node:path'

export type RuntimePathOptions = {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  userDataPath: string
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
}

export type RuntimePaths = {
  runtimeEntryPath: string
  databasePath: string
  workspaceRoot: string
}

export function resolveRuntimePaths(options: RuntimePathOptions): RuntimePaths {
  if (options.platform !== 'darwin') {
    throw new Error(`RUNTIME_PLATFORM_UNSUPPORTED: ${options.platform}`)
  }
  if (options.arch !== 'arm64' && options.arch !== 'x64') {
    throw new Error(`RUNTIME_ARCH_UNSUPPORTED: ${options.arch}`)
  }

  return {
    runtimeEntryPath: options.isPackaged
      ? resolve(options.resourcesPath, 'agent-runtime', 'dist', 'index.js')
      : resolve(options.appPath, '..', 'agent-runtime', 'dist', 'index.js'),
    databasePath: resolve(options.userDataPath, 'data', 'actiondriver.db'),
    workspaceRoot: resolve(options.userDataPath, 'workspace')
  }
}
