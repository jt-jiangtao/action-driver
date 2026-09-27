import { build } from 'esbuild'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = join(runtimeRoot, '../..')
const output = join(runtimeRoot, 'dist')
await mkdir(output, { recursive: true })
await build({ entryPoints: [join(runtimeRoot, 'src/plugins/host-entry.mjs')], outfile: join(output, 'plugin-host.mjs'), bundle: true, platform: 'node', format: 'esm' })
for (const name of await readdir(join(repositoryRoot, 'plugins'))) {
  const root = join(repositoryRoot, 'plugins', name)
  const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'))
  const destination = join(output, 'plugins', name)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(destination, 'dist'), { recursive: true })
  const entries = [join(root, 'src/extension.ts')]
  if (manifest.catalog) entries.push(join(root, 'src/catalog.ts'))
  await build({ entryPoints: entries, outdir: join(destination, 'dist'), bundle: true, platform: 'node', format: 'esm' })
  await cp(join(root, 'plugin.json'), join(destination, 'plugin.json'))
  await writeFile(join(destination, 'package.json'), JSON.stringify({ name: `@actiondriver/${name}-plugin`, version: manifest.version, type: 'module' }))
  try { await cp(join(root, 'SOURCE.md'), join(destination, 'SOURCE.md')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const directory of ['skills', 'ui', 'services', 'native', 'bin']) {
    try { await cp(join(root, directory), join(destination, directory), { recursive: true, filter: path => !path.split('/').includes('.build') }) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
