import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
interface BinOptions {
  relativePath: string[]
  checkExists?: boolean
  envVarOverride?: string
}
export function resolvePackageBin(
  options: BinOptions,
  host: { startDirectory?: string; env?: NodeJS.ProcessEnv } = {}
): string {
  const override = options.envVarOverride
    ? (host.env ?? process.env)[options.envVarOverride]?.trim()
    : undefined
  if (override) return override
  const start = host.startDirectory ?? dirname(fileURLToPath(import.meta.url))
  let root = start
  while (!existsSync(join(root, 'package.json'))) {
    const parent = dirname(root)
    if (parent === root) throw new Error(`find_package_dir start_dir=${start}`)
    root = parent
  }
  const relative = join(...options.relativePath),
    path = join(root, relative)
  if ((options.checkExists ?? true) && !existsSync(path)) throw new Error(`${relative} bin=${path}`)
  return path
}
