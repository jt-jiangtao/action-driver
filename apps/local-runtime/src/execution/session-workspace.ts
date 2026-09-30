import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { SessionWorkspacePaths } from '@action-driver/runtime-contracts'

export class SessionWorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string = code
  ) {
    super(message)
    this.name = 'SessionWorkspaceError'
  }
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

export function assertSafeSessionId(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new SessionWorkspaceError('SESSION_ID_INVALID')
  }
  return sessionId
}

export function sessionWorkspacePaths(
  workspaceRoot: string,
  sessionId: string
): SessionWorkspacePaths {
  const root = join(workspaceRoot, 'sessions', assertSafeSessionId(sessionId))
  return { root, input: join(root, 'input'), output: join(root, 'output') }
}

export type WorkspaceArea = 'input' | 'output'

export type ResolveFileOptions = {
  createParents?: boolean
  mustBeRegularFile?: boolean
}

/**
 * Only path operations from this store may touch a session workspace: they
 * reject absolute paths, directory traversal and any symlink between the
 * session root and the file, so one session can never reach another session,
 * the agent home or application-private data.
 */
export class SessionWorkspaceStore {
  private readonly workspaceRoot: string

  constructor(options: { workspaceRoot: string }) {
    this.workspaceRoot = resolve(options.workspaceRoot)
  }

  async forSession(sessionId: string): Promise<SessionWorkspacePaths> {
    const paths = sessionWorkspacePaths(this.workspaceRoot, sessionId)
    await ensureRealDirectory(paths.root)
    await ensureRealDirectory(paths.input)
    await ensureRealDirectory(paths.output)
    return paths
  }

  async resolveFile(
    sessionId: string,
    area: WorkspaceArea,
    relativePath: string,
    options: ResolveFileOptions = {}
  ): Promise<string> {
    const workspace = await this.forSession(sessionId)
    const areaRoot = area === 'input' ? workspace.input : workspace.output
    const segments = splitWorkspaceRelativePath(relativePath)
    const target = resolve(areaRoot, ...segments)
    if (target !== areaRoot && !target.startsWith(areaRoot + sep)) {
      throw new SessionWorkspaceError('WORKSPACE_PATH_INVALID')
    }
    await ensureRealDirectory(areaRoot, { skipChainCheck: true })
    await checkExistingAncestors(areaRoot, segments.slice(0, -1), {
      create: options.createParents === true
    })

    const existing = await lstatOrNull(target)
    if (existing?.isSymbolicLink()) {
      throw new SessionWorkspaceError('WORKSPACE_SYMLINK_REJECTED')
    }
    if (options.mustBeRegularFile) {
      if (!existing) throw new SessionWorkspaceError('WORKSPACE_FILE_MISSING')
      if (!existing.isFile()) throw new SessionWorkspaceError('WORKSPACE_NOT_A_FILE')
    }
    return target
  }
}

export async function ensureSessionWorkspace(
  workspaceRoot: string,
  sessionId: string
): Promise<SessionWorkspacePaths> {
  return new SessionWorkspaceStore({ workspaceRoot }).forSession(sessionId)
}

/**
 * Resolves a caller-supplied path (for example a Skill folder to install) and
 * proves it stays inside the current session workspace; symlinks resolving
 * elsewhere are rejected.
 */
export async function resolveWorkspaceSource(
  workspace: SessionWorkspacePaths,
  candidate: string
): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(candidate)
  } catch {
    throw new SessionWorkspaceError('WORKSPACE_FILE_MISSING')
  }
  const root = await realpath(workspace.root)
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new SessionWorkspaceError('WORKSPACE_PATH_OUTSIDE_SESSION')
  }
  return resolved
}

function splitWorkspaceRelativePath(relativePath: string): string[] {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
    throw new SessionWorkspaceError('WORKSPACE_PATH_INVALID')
  }
  const segments = relativePath.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new SessionWorkspaceError('WORKSPACE_PATH_INVALID')
  }
  return segments
}

async function checkExistingAncestors(
  root: string,
  segments: string[],
  options: { create: boolean }
): Promise<void> {
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    const existing = await lstatOrNull(current)
    if (!existing) {
      if (!options.create) throw new SessionWorkspaceError('WORKSPACE_PARENT_MISSING')
      await mkdir(current)
      continue
    }
    if (existing.isSymbolicLink()) {
      throw new SessionWorkspaceError('WORKSPACE_SYMLINK_REJECTED')
    }
    if (!existing.isDirectory()) {
      throw new SessionWorkspaceError('WORKSPACE_NOT_A_DIRECTORY')
    }
  }
}

async function ensureRealDirectory(
  path: string,
  options: { skipChainCheck?: boolean } = {}
): Promise<void> {
  const existing = await lstatOrNull(path)
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new SessionWorkspaceError('WORKSPACE_SYMLINK_REJECTED')
    }
    if (!existing.isDirectory()) {
      throw new SessionWorkspaceError('WORKSPACE_NOT_A_DIRECTORY')
    }
    return
  }
  if (!options.skipChainCheck) {
    const parent = dirname(path)
    if (parent !== path) await ensureRealDirectory(parent)
  }
  await mkdir(path)
  const created = await lstat(path)
  if (!created.isDirectory() || created.isSymbolicLink()) {
    throw new SessionWorkspaceError('WORKSPACE_NOT_A_DIRECTORY')
  }
}

async function lstatOrNull(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
