import { describe, expect, it } from 'vitest'
import { resolveRuntimePaths } from '../../../src/main/runtime-paths'

describe('Runtime paths', () => {
  it('resolves the development build beside the desktop workspace package', () => {
    expect(
      resolveRuntimePaths({
        isPackaged: false,
        appPath: '/repo/apps/desktop',
        resourcesPath: '/unused',
        userDataPath: '/Users/test/Library/Application Support/ActionDriver',
        platform: 'darwin',
        arch: 'arm64'
      })
    ).toEqual({
      runtimeEntryPath: '/repo/apps/agent-runtime/dist/index.js',
      computerHelperBundlePath: '/repo/plugins/computer-use/native/dist/arm64/ActionDriver Computer Use.app',
      computerHelperPath: '/repo/plugins/computer-use/native/dist/arm64/ActionDriver Computer Use.app/Contents/MacOS/actiondriver-computer-use',
      dataRoot: '/Users/test/Library/Application Support/ActionDriver/data',
      workspaceRoot: '/Users/test/Library/Application Support/ActionDriver/workspace'
    })
  })

  it.each(['arm64', 'x64'] as const)(
    'resolves the packaged macOS %s artifact from Resources',
    (arch) => {
      expect(
        resolveRuntimePaths({
          isPackaged: true,
          appPath: '/Applications/ActionDriver.app/Contents/Resources/app.asar',
          resourcesPath: `/Applications/ActionDriver-${arch}.app/Contents/Resources`,
          userDataPath: '/tmp/actiondriver-user-data',
          platform: 'darwin',
          arch
        })
      ).toEqual({
        runtimeEntryPath: `/Applications/ActionDriver-${arch}.app/Contents/Resources/agent-runtime/dist/index.js`,
        computerHelperBundlePath: `/Applications/ActionDriver-${arch}.app/Contents/Helpers/ActionDriver Computer Use.app`,
        computerHelperPath: `/Applications/ActionDriver-${arch}.app/Contents/Helpers/ActionDriver Computer Use.app/Contents/MacOS/actiondriver-computer-use`,
        dataRoot: '/tmp/actiondriver-user-data/data',
        workspaceRoot: '/tmp/actiondriver-user-data/workspace'
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
