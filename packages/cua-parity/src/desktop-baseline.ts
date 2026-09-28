import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { captureBaseline, verifyBaseline } from './baseline.js'
import type { Drift, FileRecord } from './types.js'

export interface DesktopBaseline {
  version: string
  files: FileRecord[]
}

/** A package-root snapshot, independent of the older codex-cua vendor tree. */
export async function captureDesktopBaseline(root: string): Promise<DesktopBaseline> {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (manifest.name !== '@oai/browser-desktop' ||
      typeof manifest.version !== 'string' || manifest.version.length === 0)
    throw new Error('Expected @oai/browser-desktop package metadata')
  return {
    version: manifest.version,
    files: (await captureBaseline(root)).files
  }
}

/** Reports changed bytes, modes, paths and package version without changing either input. */
export async function verifyDesktopBaseline(
  root: string,
  baseline: DesktopBaseline
): Promise<Drift[]> {
  const current = await captureDesktopBaseline(root)
  const drift = await verifyBaseline(root, {
    schemaVersion: 1,
    packages: {},
    files: baseline.files
  })
  if (current.version !== baseline.version)
    drift.push({ path: '@metadata/version', reason: 'changed' })
  return drift.sort((a, b) => a.path.localeCompare(b.path))
}
