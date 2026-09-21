import { describe, expect, it } from 'vitest'
import { resolveRuntimePaths } from './runtime-paths'

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
      databasePath:
        '/Users/test/Library/Application Support/ActionDriver/data/actiondriver.db'
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
        databasePath: '/tmp/actiondriver-user-data/data/actiondriver.db'
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
