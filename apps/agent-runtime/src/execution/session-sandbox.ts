import { constants, realpathSync } from 'node:fs'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionWorkspacePaths } from '@actiondriver/runtime-contracts'

export class SandboxUnavailableError extends Error {
  readonly code = 'SANDBOX_UNAVAILABLE'

  constructor(message = 'SANDBOX_UNAVAILABLE: per-session script isolation is unavailable') {
    super(message)
    this.name = 'SandboxUnavailableError'
  }
}

export type SandboxPrepared = {
  profilePath: string
  tempDirectory: string
  environment: NodeJS.ProcessEnv
  wrap(executable: string, args: string[]): { executable: string; args: string[] }
  dispose(): Promise<void>
}

/** Environment keys a script may inherit; everything else is dropped. */
const INHERITED_ENVIRONMENT_KEYS = [
  'PATH',
  'LANG',
  'LC_ALL',
  'PYTHONNOUSERSITE',
  'RUNTIME_NODE',
  'RUNTIME_NODE_MODULES',
  'RUNTIME_BIN_DIR',
  'RUNTIME_PYTHON'
] as const

const PROFILE_IMPORT = 'system.sb'
const SYSTEM_PROFILE_PATH = '/System/Library/Sandbox/Profiles/system.sb'

/**
 * Runs every script of one session inside a macOS `sandbox-exec` profile that
 * only grants the session workspace, the bundled runtimes and one call-scoped
 * temporary directory. Anything else — other sessions, application-private
 * data, credentials and the local Runtime sockets — stays out of reach, and a
 * missing sandbox never degrades into an unsandboxed process.
 */
export class SessionSandbox {
  private readonly platform: NodeJS.Platform
  private readonly sandboxExecPath: string
  private readonly runtimeRoots: string[]
  private readonly temporaryRoot: string

  constructor(options: {
    runtimeRoots: readonly string[]
    platform?: NodeJS.Platform
    sandboxExecPath?: string
    temporaryRoot?: string
  }) {
    this.platform = options.platform ?? process.platform
    this.sandboxExecPath = options.sandboxExecPath ?? '/usr/bin/sandbox-exec'
    this.runtimeRoots = options.runtimeRoots.filter((root) => root.trim().length > 0)
    this.temporaryRoot = options.temporaryRoot ?? tmpdir()
  }

  async prepare(request: {
    workspace: SessionWorkspacePaths
    environment?: NodeJS.ProcessEnv
    /** JS children are fully untrusted; restrict execution to the bootstrap binary and forbid fork. */
    jsExecutable?: string
  }): Promise<SandboxPrepared> {
    await this.assertAvailable()
    // Canonical paths only resolve once the workspace exists; the tree lives
    // under the trusted resolver's session root, so creating it is safe.
    await mkdir(request.workspace.root, { recursive: true })
    await mkdir(request.workspace.input, { recursive: true })
    await mkdir(request.workspace.output, { recursive: true })
    const workspaceRoot = canonicalPath(request.workspace.root)
    const outputDirectory = canonicalPath(request.workspace.output)
    const callDirectory = canonicalPath(
      await mkdtemp(join(this.temporaryRoot, 'actiondriver-script-'))
    )
    const tempDirectory = join(callDirectory, 'tmp')
    try {
      await mkdir(tempDirectory, { recursive: true })
      const profilePath = join(callDirectory, 'sandbox.sb')
      await writeFile(
        profilePath,
        buildSandboxProfile({
          workspaceRoot,
          outputDirectory,
          tempDirectory,
          runtimeRoots: this.runtimeRoots.map(canonicalPath),
          ...(request.jsExecutable === undefined ? {} : { jsExecutable: canonicalPath(request.jsExecutable) })
        }),
        'utf8'
      )
      return {
        profilePath,
        tempDirectory,
        environment: buildSandboxEnvironment(request.environment, {
          homeDirectory: workspaceRoot,
          tempDirectory
        }),
        wrap: (executable, args) => ({
          executable: this.sandboxExecPath,
          args: ['-f', profilePath, executable, ...args]
        }),
        dispose: async () => {
          await rm(callDirectory, { recursive: true, force: true })
        }
      }
    } catch (error) {
      await rm(callDirectory, { recursive: true, force: true })
      throw error
    }
  }

  private async assertAvailable(): Promise<void> {
    if (this.platform !== 'darwin') throw new SandboxUnavailableError()
    try {
      await access(this.sandboxExecPath, constants.X_OK)
      await access(SYSTEM_PROFILE_PATH, constants.R_OK)
    } catch {
      throw new SandboxUnavailableError()
    }
  }
}

export function buildSandboxProfile(options: {
  workspaceRoot: string
  outputDirectory: string
  tempDirectory: string
  runtimeRoots: readonly string[]
  jsExecutable?: string
}): string {
  const readRoots = [options.workspaceRoot, options.tempDirectory, ...options.runtimeRoots]
  const ancestors = readRoots.map((root) => `(path-ancestors ${quote(root)})`)
  return [
    '(version 1)',
    `(import ${quote(PROFILE_IMPORT)})`,
    ...(options.jsExecutable === undefined
      ? ['(allow process-exec*)', '(allow process-fork)']
      : [`(allow process-exec (literal ${quote(options.jsExecutable)}))`, '(deny process-fork)']),
    '(allow signal (target self))',
    // System and application runtime files stay readable; user data is denied below.
    '(allow file-read*)',
    '(deny file-read*',
    '  (subpath "/Users")',
    '  (subpath "/Volumes")',
    '  (subpath "/private/var/db")',
    '  (subpath "/private/var/folders")',
    '  (subpath "/private/var/tmp"))',
    `(allow file-read-metadata ${ancestors.join(' ')})`,
    `(allow file-read* ${readRoots.map((root) => `(subpath ${quote(root)})`).join(' ')})`,
    `(allow file-write* (subpath ${quote(options.outputDirectory)}) (subpath ${quote(
      options.tempDirectory
    )}) (literal "/dev/null"))`,
    // The local Runtime HTTP interface is reachable only through localhost.
    '(deny network-outbound (remote ip "localhost:*"))',
    ''
  ].join('\n')
}

function buildSandboxEnvironment(
  provided: NodeJS.ProcessEnv | undefined,
  paths: { homeDirectory: string; tempDirectory: string }
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: paths.homeDirectory,
    TMPDIR: paths.tempDirectory,
    LANG: 'en_US.UTF-8',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
  }
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = provided?.[key]
    if (typeof value === 'string' && value.length > 0) environment[key] = value
  }
  return environment
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}
