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
  computerHelperPath: string
  /** The helper bundle, needed to start it through LaunchServices rather than as a child process. */
  computerHelperBundlePath: string
  /** Root of every runtime-owned file: rollout logs, projection, auxiliary state, workspaces. */
  dataRoot: string
  workspaceRoot: string
}

export function resolveRuntimePaths(options: RuntimePathOptions): RuntimePaths {
  if (options.platform !== 'darwin') {
    throw new Error(`RUNTIME_PLATFORM_UNSUPPORTED: ${options.platform}`)
  }
  if (options.arch !== 'arm64' && options.arch !== 'x64') {
    throw new Error(`RUNTIME_ARCH_UNSUPPORTED: ${options.arch}`)
  }

  const computerHelperBundlePath = options.isPackaged
    ? resolve(options.resourcesPath, '..', 'Helpers', 'Action-Driver Computer Use.app')
    : resolve(options.appPath, '../..', 'plugins', 'computer-use', 'native', 'dist', options.arch,
      'Action-Driver Computer Use.app')
  return {
    runtimeEntryPath: options.isPackaged
      ? resolve(options.resourcesPath, 'agent-runtime', 'dist', 'index.js')
      : resolve(options.appPath, '..', 'agent-runtime', 'dist', 'index.js'),
    computerHelperBundlePath,
    computerHelperPath: resolve(computerHelperBundlePath, 'Contents', 'MacOS',
      'action-driver-computer-use'),
    dataRoot: resolve(options.userDataPath, 'data'),
    workspaceRoot: resolve(options.userDataPath, 'workspace')
  }
}
