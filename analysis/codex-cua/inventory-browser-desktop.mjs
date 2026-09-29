import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const analysisRoot = dirname(fileURLToPath(import.meta.url))
const repo = resolve(analysisRoot, '../..')
const backupRoot = join(repo, 'packages/back/browser-desktop/@oai/browser-desktop')
// The original `apps/agent-runtime/vendor` tree was removed after the owned-host cutover; the
// immutable copy of that tree lives in `packages/back` (see packages/back/backup-manifest.json).
const embeddedRoot = join(repo, 'packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill')
const manifest = JSON.parse(await readFile(join(repo, 'packages/back/browser-desktop/manifest.json'), 'utf8'))

function owner(path) {
  if (path === 'package.json') return 'package-metadata'
  if (path === 'scripts/browser-client.mjs') return 'browser-client-bundle'
  if (path === 'scripts/browser-service.mjs') return 'browser-service-bundle'
  if (path.endsWith('.wasm') || path.endsWith('.wasm.br')) return 'third-party-or-generated-wasm'
  if (path.startsWith('environment-docs/')) return 'environment-resource'
  return 'unclassified'
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const files = []
for (const item of manifest.files) {
  if (item.kind !== 'file') continue
  const bytes = await readFile(join(backupRoot, item.path))
  if (sha256(bytes) !== item.sha256) throw new Error(`Backup drift: ${item.path}`)
  const mapped = { path: item.path, owner: owner(item.path), sha256: item.sha256, bytes: item.bytes }
  if (item.path.startsWith('scripts/')) {
    try {
      const embedded = await readFile(join(embeddedRoot, item.path))
      mapped.embedded = { sha256: sha256(embedded), identical: bytes.equals(embedded) }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      mapped.embedded = null
    }
  }
  files.push(mapped)
}

const inventory = {
  sourcePackage: manifest.package,
  sourceVersion: manifest.version,
  source: manifest.source,
  dependencyEvidence: { 'classic-level': '3.0.0' },
  files
}
await writeFile(join(analysisRoot, 'desktop-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`)
