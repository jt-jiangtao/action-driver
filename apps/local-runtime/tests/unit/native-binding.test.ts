import { describe, expect, it } from 'vitest'
import {
  NATIVE_BINDING_METADATA_FILE,
  requiresElectronNativeBinding,
  resolveElectronNativeBinding
} from '../../src/index'
import type { NativeBindingError } from '../../src/index'

const runtimeDirectory = '/opt/action-driver/apps/local-runtime/dist'
const bindingPath = '/opt/action-driver/apps/local-runtime/native/electron/arm64/better_sqlite3.node'
const metadataPath = `/opt/action-driver/apps/local-runtime/native/electron/arm64/${NATIVE_BINDING_METADATA_FILE}`

function filesystem(entries: Record<string, string>) {
  return {
    exists: (path: string) => path in entries,
    readText: (path: string) => {
      const value = entries[path]
      if (value === undefined) throw new Error(`ENOENT: ${path}`)
      return value
    }
  }
}

const validMetadata = JSON.stringify({
  electron: '38.8.6',
  arch: 'arm64',
  builtAt: '2026-09-22T00:00:00.000Z'
})

describe('Electron native binding resolution', () => {
  it('only requires the Electron binding inside an Electron process', () => {
    expect(requiresElectronNativeBinding({ electron: '38.8.6' })).toBe(true)
    expect(requiresElectronNativeBinding({})).toBe(false)
  })

  it('resolves the packaged artifact next to the Runtime bundle', () => {
    const { exists, readText } = filesystem({ [bindingPath]: '', [metadataPath]: validMetadata })

    expect(
      resolveElectronNativeBinding({
        environment: {},
        electronVersion: '38.8.6',
        arch: 'arm64',
        runtimeDirectory,
        exists,
        readText
      })
    ).toBe(bindingPath)
  })

  it('honours an explicit binding override', () => {
    const override = '/tmp/custom/better_sqlite3.node'
    const overrideMetadata = '/tmp/custom/binding.json'
    const { exists, readText } = filesystem({
      [override]: '',
      [overrideMetadata]: validMetadata
    })

    expect(
      resolveElectronNativeBinding({
        environment: { ACTION_DRIVER_RUNTIME_NATIVE_BINDING: override },
        electronVersion: '38.8.6',
        arch: 'arm64',
        runtimeDirectory,
        exists,
        readText
      })
    ).toBe(override)
  })

  it('fails loudly when the Electron artifact is missing', () => {
    const { exists, readText } = filesystem({})

    expect(() =>
      resolveElectronNativeBinding({
        environment: {},
        electronVersion: '38.8.6',
        arch: 'arm64',
        runtimeDirectory,
        exists,
        readText
      })
    ).toThrowError(
      expect.objectContaining<Partial<NativeBindingError>>({ code: 'NATIVE_BINDING_MISSING' })
    )
  })

  it('rejects artifacts built for another Electron version or architecture', () => {
    const stale = JSON.stringify({ electron: '37.0.0', arch: 'x64', builtAt: '2026-01-01' })
    const { exists, readText } = filesystem({ [bindingPath]: '', [metadataPath]: stale })

    expect(() =>
      resolveElectronNativeBinding({
        environment: {},
        electronVersion: '38.8.6',
        arch: 'arm64',
        runtimeDirectory,
        exists,
        readText
      })
    ).toThrowError(
      expect.objectContaining<Partial<NativeBindingError>>({
        code: 'NATIVE_BINDING_TARGET_MISMATCH'
      })
    )
  })

  it('rejects artifacts without usable metadata', () => {
    const noMetadata = filesystem({ [bindingPath]: '' })
    expect(() =>
      resolveElectronNativeBinding({
        environment: {},
        electronVersion: '38.8.6',
        arch: 'arm64',
        runtimeDirectory,
        exists: noMetadata.exists,
        readText: noMetadata.readText
      })
    ).toThrowError(
      expect.objectContaining<Partial<NativeBindingError>>({
        code: 'NATIVE_BINDING_METADATA_MISSING'
      })
    )

    const brokenMetadata = filesystem({ [bindingPath]: '', [metadataPath]: '{not json' })
    expect(() =>
      resolveElectronNativeBinding({
        environment: {},
        electronVersion: '38.8.6',
        arch: 'arm64',
        runtimeDirectory,
        exists: brokenMetadata.exists,
        readText: brokenMetadata.readText
      })
    ).toThrowError(
      expect.objectContaining<Partial<NativeBindingError>>({
        code: 'NATIVE_BINDING_METADATA_INVALID'
      })
    )
  })
})
