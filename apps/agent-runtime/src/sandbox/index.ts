import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SandboxPathGuard } from './path-guard'
import { createSandboxFileTools } from './file-tools'
import { createSandboxShellTool } from './shell-tool'

export { SandboxPathGuard } from './path-guard'
export { createSandboxFileTools } from './file-tools'
export { createSandboxShellTool } from './shell-tool'

export async function createSandboxTools(options: { workspaceRoot: string }) {
  const guard = await SandboxPathGuard.create(options.workspaceRoot)
  const files = createSandboxFileTools(guard, { maxReadBytes: 1024 * 1024 - 4096 })
  const bundledRg = join(dirname(fileURLToPath(import.meta.url)), 'bin', 'rg')
  const rg = (await firstExecutable([bundledRg])) ?? (await dependencyRgPath())
  const shell = createSandboxShellTool(guard, {
    executables: {
      rg: rg ?? '/usr/bin/rg',
      head: '/usr/bin/head',
      tail: '/usr/bin/tail',
      wc: '/usr/bin/wc'
    }
  })
  return [files.list, files.read, shell]
}

async function dependencyRgPath(): Promise<string | null> {
  try {
    const { rgPath } = await import('@vscode/ripgrep')
    return (await firstExecutable([rgPath])) ?? null
  } catch {
    return null
  }
}

async function firstExecutable(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path, constants.X_OK)
      return path
    } catch {
      // Continue to the next fixed trusted location.
    }
  }
  return null
}
