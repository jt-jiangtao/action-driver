import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateCatalog, type PluginCatalog, type PluginManifest } from '@actiondriver/plugin-contracts'
export async function readPluginCatalog(node: string, root: string, manifest: PluginManifest): Promise<PluginCatalog> {
  if (!manifest.catalog) return { tools: [], skills: [] }
  const path = resolve(root, manifest.catalog)
  const value = path.endsWith('.json') ? await readFile(path, 'utf8') : (await promisify(execFile)(node, ['--input-type=module', '-e', "import { pathToFileURL } from 'node:url'; const {catalog} = await import(pathToFileURL(process.argv[1]).href); process.stdout.write(JSON.stringify(catalog));", path], { cwd: root, env: {}, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout
  return validateCatalog(JSON.parse(value), manifest)
}
