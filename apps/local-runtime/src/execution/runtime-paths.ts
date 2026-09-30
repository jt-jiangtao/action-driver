import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { OfficeDependenciesUnavailableError } from '@action-driver/agent-runtime/execution-errors'
export { OfficeDependenciesUnavailableError } from '@action-driver/agent-runtime/execution-errors'

export type ExecutionRuntimePaths = { python: string; node: string; rg: string; path: string }

export type OfficeDependencyPaths = {
  RUNTIME_NODE: string
  RUNTIME_NODE_MODULES: string
  RUNTIME_BIN_DIR: string
  RUNTIME_PYTHON: string
}

export async function resolveOfficeDependencyPaths(runtimeDist: string): Promise<OfficeDependencyPaths> {
  if (!isAbsolute(runtimeDist)) throw new Error('BUNDLED_RUNTIME_ROOT_INVALID')
  const root = join(runtimeDist, 'dependencies')
  let canonicalRoot: string
  try { canonicalRoot = await realpath(root) }
  catch { throw new OfficeDependenciesUnavailableError(root) }
  const paths: OfficeDependencyPaths = {
    RUNTIME_NODE: join(root, 'node', 'bin', 'node'),
    RUNTIME_NODE_MODULES: join(root, 'node', 'node_modules'),
    RUNTIME_BIN_DIR: join(root, 'bin', 'override'),
    RUNTIME_PYTHON: join(root, 'python', 'bin', 'python3')
  }
  for (const path of [
    ...Object.values(paths),
    join(root, 'bin', 'override', 'soffice'),
    join(root, 'bin', 'override', 'pdftoppm')
  ]) {
    try {
      const resolved = await realpath(path)
      const within = relative(canonicalRoot, resolved)
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        throw new Error('outside deployment')
      }
      if ((await stat(path)).isDirectory()) continue
      await access(path, constants.X_OK)
    } catch { throw new OfficeDependenciesUnavailableError(path) }
  }
  return paths
}

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
