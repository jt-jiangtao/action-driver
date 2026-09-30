import { describe, expect, it } from 'vitest'
import { resolveRuntimePaths } from '../../../src/main/runtime-paths'

describe('Runtime paths', () => {
  it('resolves the development build beside the desktop workspace package', () => {
    expect(
      resolveRuntimePaths({
        isPackaged: false,
        appPath: '/repo/apps/desktop',
        resourcesPath: '/unused',
        userDataPath: '/Users/test/Library/Application Support/Action-Driver',
        platform: 'darwin',
        arch: 'arm64'
      })
    ).toEqual({
      runtimeEntryPath: '/repo/apps/local-runtime/dist/index.js',
      computerHelperBundlePath: '/repo/plugins/computer-use/native/dist/arm64/Action-Driver Computer Use.app',
      computerHelperPath: '/repo/plugins/computer-use/native/dist/arm64/Action-Driver Computer Use.app/Contents/MacOS/action-driver-computer-use',
      dataRoot: '/Users/test/Library/Application Support/Action-Driver/data',
      workspaceRoot: '/Users/test/Library/Application Support/Action-Driver/workspace'
    })
  })

  it.each(['arm64', 'x64'] as const)(
    'resolves the packaged macOS %s artifact from Resources',
    (arch) => {
      expect(
        resolveRuntimePaths({
          isPackaged: true,
          appPath: '/Applications/Action-Driver.app/Contents/Resources/app.asar',
          resourcesPath: `/Applications/Action-Driver-${arch}.app/Contents/Resources`,
          userDataPath: '/tmp/action-driver-user-data',
          platform: 'darwin',
          arch
        })
      ).toEqual({
        runtimeEntryPath: `/Applications/Action-Driver-${arch}.app/Contents/Resources/local-runtime/dist/index.js`,
        computerHelperBundlePath: `/Applications/Action-Driver-${arch}.app/Contents/Helpers/Action-Driver Computer Use.app`,
        computerHelperPath: `/Applications/Action-Driver-${arch}.app/Contents/Helpers/Action-Driver Computer Use.app/Contents/MacOS/action-driver-computer-use`,
        dataRoot: '/tmp/action-driver-user-data/data',
        workspaceRoot: '/tmp/action-driver-user-data/workspace'
      })
    }
  )

  it('rejects unsupported packaged targets instead of guessing an artifact path', () => {
    expect(() =>
      resolveRuntimePaths({
        isPackaged: true,
        appPath: 'C:\\app',
        resourcesPath: 'C:\\resources',
        userDataPath: 'C:\\data',
        platform: 'win32',
        arch: 'x64'
      })
    ).toThrowError('RUNTIME_PLATFORM_UNSUPPORTED')
  })
})
