import { readdir, lstat, readFile, readlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Baseline, Drift, FileRecord } from './types.js'
export async function captureBaseline(root: string): Promise<Baseline> {
  const files: FileRecord[] = []
  async function walk(rel: string) {
    for (const name of (await readdir(join(root, rel))).sort()) {
      const path = rel ? `${rel}/${name}` : name
      const absolute = join(root, path)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink())
        files.push({ path, kind: 'symlink', target: await readlink(absolute) })
      else if (stat.isDirectory()) {
        files.push({ path, kind: 'directory' })
        await walk(path)
      } else if (stat.isFile())
        files.push({
          path,
          kind: 'file',
          sha256: createHash('sha256')
            .update(await readFile(absolute))
            .digest('hex'),
          bytes: stat.size,
          mode: stat.mode & 0o777
        })
      else throw new Error(`Unsupported file kind: ${path}`)
    }
  }
  await walk('')
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const packages: Baseline['packages'] = {}
  for (const name of ['cua', 'sky', 'cua-repl']) {
    const path = `@oai/${name}/package.json`
    if (files.some((f) => f.path === path && f.kind === 'file')) {
      const json = JSON.parse(await readFile(join(root, path), 'utf8'))
      packages[name] = { version: json.version, entry: `@oai/${name}/${json.main}` }
    }
  }
  const browser = '@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.mjs'
  if (files.some((f) => f.path === browser)) packages.browser = { version: null, entry: browser }
  return { schemaVersion: 1, packages, files }
}
export async function verifyBaseline(root: string, baseline: Baseline): Promise<Drift[]> {
  if (baseline.schemaVersion !== 1) throw new Error('Unsupported baseline schema')
  const current = await captureBaseline(root)
  const old = new Map(baseline.files.map((f) => [f.path, f]))
  const now = new Map(current.files.map((f) => [f.path, f]))
  const drift: Drift[] = []
  for (const path of [...new Set([...old.keys(), ...now.keys()])].sort()) {
    if (!old.has(path)) drift.push({ path, reason: 'added' })
    else if (!now.has(path)) drift.push({ path, reason: 'removed' })
    else if (JSON.stringify(old.get(path)) !== JSON.stringify(now.get(path)))
      drift.push({ path, reason: 'changed' })
  }
  if (JSON.stringify(current.packages) !== JSON.stringify(baseline.packages))
    drift.push({ path: '@metadata/packages', reason: 'changed' })
  return drift
}
