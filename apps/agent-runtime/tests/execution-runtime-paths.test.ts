import { describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveExecutionRuntimePaths, resolveOfficeDependencyPaths } from '../src/execution/runtime-paths'

describe('execution runtime paths', () => {
  it('uses only executable files inside the selected deployment tree', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'actiondriver-paths-'))
    await expect(resolveExecutionRuntimePaths(dist, 'arm64')).rejects.toThrow('BUNDLED_PYTHON_UNAVAILABLE')
    for (const file of [
      'runtimes/darwin-arm64/python/bin/python3',
      'runtimes/darwin-arm64/node/bin/node',
      'bin/rg'
    ]) {
      const path = join(dist, file)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, '#!/bin/sh\n')
      await chmod(path, 0o755)
    }
    const paths = await resolveExecutionRuntimePaths(dist, 'arm64')
    expect(paths.python).toBe(join(dist, 'runtimes/darwin-arm64/python/bin/python3'))
    expect(paths.node).toBe(join(dist, 'runtimes/darwin-arm64/node/bin/node'))
    expect(paths.path.startsWith(join(dist, 'runtimes/darwin-arm64/python/bin'))).toBe(true)
    await expect(resolveExecutionRuntimePaths(dist, 'x64')).rejects.toThrow('BUNDLED_PYTHON_UNAVAILABLE')
  })
})

describe('office dependency paths', () => {
  it('returns only complete executable paths in the deployment tree', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'actiondriver-office-paths-'))
    await expect(resolveOfficeDependencyPaths(dist)).rejects.toThrow('TOOL_UNAVAILABLE')
    for (const file of [
      'dependencies/node/bin/node', 'dependencies/python/bin/python3',
      'dependencies/bin/override/soffice', 'dependencies/bin/override/pdftoppm'
    ]) {
      const path = join(dist, file)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, '#!/bin/sh\n')
      await chmod(path, 0o755)
    }
    await mkdir(join(dist, 'dependencies/node/node_modules'))
    const paths = await resolveOfficeDependencyPaths(dist)
    expect(paths).toEqual({
      RUNTIME_NODE: join(dist, 'dependencies/node/bin/node'),
      RUNTIME_NODE_MODULES: join(dist, 'dependencies/node/node_modules'),
      RUNTIME_BIN_DIR: join(dist, 'dependencies/bin/override'),
      RUNTIME_PYTHON: join(dist, 'dependencies/python/bin/python3')
    })
  })
})
