import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ELECTRON_NATIVE_BINDING_ENV = 'ACTIONDRIVER_RUNTIME_NATIVE_BINDING'
export const NATIVE_BINDING_METADATA_FILE = 'binding.json'
export const NATIVE_BINDING_FILE = 'better_sqlite3.node'

export type NativeBindingMetadata = {
  electron: string
  arch: string
  builtAt: string
}

export type ElectronNativeBindingRequest = {
  environment?: NodeJS.ProcessEnv
  electronVersion?: string | undefined
  arch?: string
  runtimeDirectory?: string
  exists?: (path: string) => boolean
  readText?: (path: string) => string
}

export type NativeBindingErrorCode =
  | 'NATIVE_BINDING_MISSING'
  | 'NATIVE_BINDING_METADATA_MISSING'
  | 'NATIVE_BINDING_METADATA_INVALID'
  | 'NATIVE_BINDING_TARGET_MISMATCH'

export class NativeBindingError extends Error {
  constructor(
    readonly code: NativeBindingErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'NativeBindingError'
  }
}

export function requiresElectronNativeBinding(
  versions: { [key: string]: string | undefined } = process.versions
): boolean {
  return typeof versions.electron === 'string' && versions.electron.length > 0
}

/**
 * Resolves the `better-sqlite3` binding built for the Electron utility process ABI.
 *
 * pnpm builds the default binding for local Node, which the Electron utility process cannot load.
 * The Electron specific artifact lives next to the Runtime bundle and is produced by
 * `pnpm build:native:electron`. Missing or mismatched artifacts must fail loudly instead of
 * silently falling back to the Node binding or Mock storage.
 */
export function resolveElectronNativeBinding(request: ElectronNativeBindingRequest = {}): string {
  const environment = request.environment ?? process.env
  const arch = request.arch ?? process.arch
  const electronVersion = request.electronVersion ?? process.versions.electron
  const exists = request.exists ?? existsSync
  const readText = request.readText ?? ((path: string) => readFileSync(path, 'utf8'))

  const override = environment[ELECTRON_NATIVE_BINDING_ENV]?.trim()
  const bindingPath =
    override && override.length > 0
      ? resolve(override)
      : resolve(
          request.runtimeDirectory ?? dirname(fileURLToPath(import.meta.url)),
          '..',
          'native',
          'electron',
          arch,
          NATIVE_BINDING_FILE
        )

  if (!exists(bindingPath)) {
    throw new NativeBindingError(
      'NATIVE_BINDING_MISSING',
      `Electron SQLite binding is missing at ${bindingPath}. Run "pnpm build:native:electron" before starting the local Agent Runtime.`
    )
  }

  const metadataPath = resolve(dirname(bindingPath), NATIVE_BINDING_METADATA_FILE)
  if (!exists(metadataPath)) {
    throw new NativeBindingError(
      'NATIVE_BINDING_METADATA_MISSING',
      `Electron SQLite binding at ${bindingPath} has no ${NATIVE_BINDING_METADATA_FILE} metadata. Rebuild it with "pnpm build:native:electron".`
    )
  }

  let metadata: NativeBindingMetadata
  try {
    metadata = JSON.parse(readText(metadataPath)) as NativeBindingMetadata
  } catch (error) {
    throw new NativeBindingError(
      'NATIVE_BINDING_METADATA_INVALID',
      `Electron SQLite binding metadata at ${metadataPath} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  if (
    typeof metadata.electron !== 'string' ||
    typeof metadata.arch !== 'string' ||
    metadata.arch.length === 0
  ) {
    throw new NativeBindingError(
      'NATIVE_BINDING_METADATA_INVALID',
      `Electron SQLite binding metadata at ${metadataPath} must declare electron and arch.`
    )
  }

  if (metadata.arch !== arch || metadata.electron !== electronVersion) {
    throw new NativeBindingError(
      'NATIVE_BINDING_TARGET_MISMATCH',
      `Electron SQLite binding at ${bindingPath} was built for Electron ${metadata.electron} (${metadata.arch}) but this Runtime runs Electron ${electronVersion ?? 'unknown'} (${arch}). Run "pnpm build:native:electron".`
    )
  }

  return bindingPath
}
