import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises'
import { resolve, relative, dirname, join, isAbsolute, sep } from 'node:path'
import { format, version } from 'prettier'
import { verifyBaseline } from './baseline.js'
import type { Baseline } from './types.js'
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    const parent = dirname(path)
    if (parent === path) throw e
    return join(await canonical(parent), path.slice(parent.length + 1))
  }
}
export async function generateReadable(
  root: string,
  output: string,
  baseline: Baseline
): Promise<void> {
  const source = await realpath(root)
  const target = await canonical(resolve(output))
  const rel = relative(source, target)
  if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)))
    throw new Error('Output must be outside source')
  for (const f of baseline.files)
    if (isAbsolute(f.path) || f.path.split(/[\\/]/).includes('..'))
      throw new Error('Unsafe source path')
  if ((await verifyBaseline(root, baseline)).length) throw new Error('Baseline drift')
  try {
    await lstat(output)
    throw new Error('Output already exists; refusing overwrite')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  await mkdir(target, { recursive: true })
  const index: unknown[] = []
  for (const f of baseline.files) {
    if (f.kind !== 'file' || !/\.(?:js|mjs|d\.ts)$/.test(f.path)) continue
    // Third-party sources stay as locked dependencies, not reconstruction inputs.
    if (f.path.includes('/node_modules/')) continue
    const actual = await realpath(join(source, f.path))
    if (!actual.startsWith(source + sep)) throw new Error('Source link escapes root')
    const destination = join(target, f.path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(
      destination,
      await format(await readFile(actual, 'utf8'), {
        filepath: f.path,
        semi: false,
        singleQuote: true
      })
    )
    index.push({ source: f.path, sha256: f.sha256, output: f.path })
  }
  await writeFile(
    join(target, 'source-index.json'),
    JSON.stringify({ prettier: version, files: index }, null, 2) + '\n'
  )
}
