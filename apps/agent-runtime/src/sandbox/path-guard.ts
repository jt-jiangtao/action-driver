import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export class SandboxPathError extends Error {
  readonly code = 'SANDBOX_PATH_DENIED'

  constructor(message: string) {
    super(`SANDBOX_PATH_DENIED: ${message}`)
    this.name = 'SandboxPathError'
  }
}

export class SandboxPathGuard {
  private constructor(readonly workspaceRoot: string) {}

  static async create(workspaceRoot: string): Promise<SandboxPathGuard> {
    if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
      throw new Error('SANDBOX_ROOT_INVALID: an absolute workspace path is required')
    }
    try {
      const root = await realpath(workspaceRoot)
      if (!(await stat(root)).isDirectory()) throw new Error('not a directory')
      return new SandboxPathGuard(root)
    } catch {
      throw new Error('SANDBOX_ROOT_INVALID: workspace root does not exist or is not a directory')
    }
  }

  async resolveExisting(path: string): Promise<{ absolutePath: string; relativePath: string }> {
    if (
      !path ||
      path.includes('\0') ||
      isAbsolute(path) ||
      path.split(/[\\/]/).includes('..')
    ) {
      throw new SandboxPathError('Only relative workspace paths are allowed')
    }
    const candidate = resolve(this.workspaceRoot, path)
    let absolutePath: string
    try {
      absolutePath = await realpath(candidate)
    } catch {
      throw new SandboxPathError('Path does not exist')
    }
    const relativePath = relative(this.workspaceRoot, absolutePath)
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new SandboxPathError('Path escapes the workspace')
    }
    return { absolutePath, relativePath: relativePath || '.' }
  }
}
