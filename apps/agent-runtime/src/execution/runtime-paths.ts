import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export type ExecutionRuntimePaths = { python: string; node: string; rg: string; path: string }

export async function resolveExecutionRuntimePaths(
  runtimeDist: string,
  arch: NodeJS.Architecture = process.arch,
  required: readonly ('python' | 'node' | 'rg')[] = ['python', 'node', 'rg']
): Promise<ExecutionRuntimePaths> {
  if (!isAbsolute(runtimeDist)) throw new Error('BUNDLED_RUNTIME_ROOT_INVALID')
  if (process.platform !== 'darwin' || (arch !== 'arm64' && arch !== 'x64')) {
    throw new Error(`RUNTIME_ARCH_UNSUPPORTED: darwin-${arch}`)
  }
  const root = join(runtimeDist, 'runtimes', `darwin-${arch}`)
  const python = join(root, 'python', 'bin', 'python3')
  const node = join(root, 'node', 'bin', 'node')
  const rg = join(runtimeDist, 'bin', 'rg')
  for (const [name, file] of [['PYTHON', python], ['NODE', node], ['RG', rg]] as const) {
    if (!required.includes(name.toLowerCase() as 'python' | 'node' | 'rg')) continue
    try { await access(file, constants.X_OK) }
    catch { throw new Error(`BUNDLED_${name}_UNAVAILABLE: ${file}`) }
  }
  return {
    python, node, rg,
    path: [join(root, 'python', 'bin'), join(root, 'node', 'bin'), join(runtimeDist, 'bin'), '/usr/bin', '/bin'].join(':')
  }
}
