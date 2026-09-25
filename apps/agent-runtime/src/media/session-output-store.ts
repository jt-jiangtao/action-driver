import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import type { SessionWorkspaceStore } from '../execution/session-workspace'

export const MAX_OUTPUT_BYTES = 100 * 1024 * 1024
const MAX_SCAN_DEPTH = 8

type OutputFormat = { mimeType: string; kind: 'pdf' | 'zip' | 'image' }

const FORMATS: Record<string, OutputFormat> = {
  '.pdf': { mimeType: 'application/pdf', kind: 'pdf' },
  '.docx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'zip'
  },
  '.pptx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'zip'
  },
  '.xlsx': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'zip'
  },
  '.png': { mimeType: 'image/png', kind: 'image' },
  '.jpg': { mimeType: 'image/jpeg', kind: 'image' },
  '.jpeg': { mimeType: 'image/jpeg', kind: 'image' },
  '.webp': { mimeType: 'image/webp', kind: 'image' }
}

export type OutputBaseline = {
  sessionId: string
  capturedAt: string
  entries: Record<string, { size: number; modifiedMs: number }>
}

export type RegisteredOutput = {
  fileId: string
  sessionId: string
  taskId: string
  name: string
  mimeType: string
  byteLength: number
  relativePath: string
  checksum: string
  createdAt: string
}

export class OutputStoreError extends Error {
  constructor(
    readonly code: string,
    message: string = code
  ) {
    super(message)
    this.name = 'OutputStoreError'
  }
}

type OutputRow = {
  file_id: string
  session_id: string
  task_id: string
  name: string
  mime_type: string
  byte_length: number
  relative_path: string
  checksum: string
  snapshot_path: string
  created_at: string
}

/**
 * Registers the deliverables a task produced inside its session `output/`
 * directory and keeps an immutable per-task snapshot so later tasks cannot
 * rewrite history.
 */
export class SessionOutputStore {
  private readonly database: Database.Database
  private readonly root: string
  private readonly workspaces: SessionWorkspaceStore
  private readonly now: () => Date

  constructor(options: {
    database: Database.Database
    rootDirectory: string
    workspaces: SessionWorkspaceStore
    now?: () => Date
  }) {
    this.database = options.database
    this.root = join(options.rootDirectory, 'outputs')
    this.workspaces = options.workspaces
    this.now = options.now ?? (() => new Date())
  }

  async baseline(sessionId: string): Promise<OutputBaseline> {
    const output = await this.outputDirectory(sessionId)
    const entries: OutputBaseline['entries'] = {}
    for (const file of await scanRegularFiles(output)) {
      const stats = await lstat(file.absolute).catch(() => null)
      if (!stats?.isFile()) continue
      entries[file.relative] = { size: stats.size, modifiedMs: Math.floor(stats.mtimeMs) }
    }
    return { sessionId, capturedAt: this.now().toISOString(), entries }
  }

  /** Files the task created or updated, restricted to real supported deliverables. */
  async detectChanges(
    sessionId: string,
    baseline: OutputBaseline
  ): Promise<Array<{ relativePath: string; name: string; mimeType: string; bytes: Uint8Array }>> {
    const output = await this.outputDirectory(sessionId)
    const detected: Array<{
      relativePath: string
      name: string
      mimeType: string
      bytes: Uint8Array
    }> = []
    for (const file of await scanRegularFiles(output)) {
      const previous = baseline.entries[file.relative]
      const stats = await lstat(file.absolute).catch(() => null)
      if (!stats?.isFile() || stats.nlink > 1) continue
      if (stats.size === 0 || stats.size > MAX_OUTPUT_BYTES) continue
      if (
        previous &&
        previous.size === stats.size &&
        previous.modifiedMs === Math.floor(stats.mtimeMs)
      ) {
        continue
      }
      const format = FORMATS[extname(file.relative).toLowerCase()]
      if (!format) continue
      const bytes = await readFile(file.absolute)
      if (!(await matchesFormat(bytes, format))) continue
      detected.push({
        relativePath: file.relative,
        name: file.name,
        mimeType: format.mimeType,
        bytes
      })
    }
    return detected
  }

  async register(input: {
    sessionId: string
    taskId: string
    files: ReadonlyArray<{
      relativePath: string
      name: string
      mimeType: string
      bytes: Uint8Array
    }>
  }): Promise<RegisteredOutput[]> {
    const registered: RegisteredOutput[] = []
    for (const file of input.files) {
      const fileId = randomUUID()
      const snapshot = join(
        this.root,
        input.sessionId,
        input.taskId,
        `${fileId}${extname(file.name)}`
      )
      await mkdir(join(this.root, input.sessionId, input.taskId), { recursive: true, mode: 0o700 })
      await writeFile(snapshot, file.bytes, { mode: 0o600 })
      const createdAt = this.now().toISOString()
      try {
        this.database
          .prepare(
            `INSERT INTO task_output_files
              (file_id, session_id, task_id, name, mime_type, byte_length, relative_path,
               checksum, snapshot_path, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            fileId,
            input.sessionId,
            input.taskId,
            file.name,
            file.mimeType,
            file.bytes.byteLength,
            file.relativePath,
            checksum(file.bytes),
            relative(this.root, snapshot),
            createdAt
          )
      } catch (error) {
        await rm(snapshot, { force: true })
        throw error
      }
      registered.push({
        fileId,
        sessionId: input.sessionId,
        taskId: input.taskId,
        name: file.name,
        mimeType: file.mimeType,
        byteLength: file.bytes.byteLength,
        relativePath: file.relativePath,
        checksum: checksum(file.bytes),
        createdAt
      })
    }
    return registered
  }

  async listByTask(taskId: string): Promise<RegisteredOutput[]> {
    return (
      this.database
        .prepare('SELECT * FROM task_output_files WHERE task_id = ? ORDER BY created_at, file_id')
        .all(taskId) as OutputRow[]
    ).map(outputFromRow)
  }

  /** Reads a registered snapshot, re-verifying ownership, location and integrity. */
  async readSnapshot(input: {
    fileId: string
    taskId: string
    sessionId: string
  }): Promise<{ bytes: Uint8Array; name: string; mimeType: string }> {
    const row = this.database
      .prepare('SELECT * FROM task_output_files WHERE file_id = ?')
      .get(input.fileId) as OutputRow | undefined
    if (!row) throw new OutputStoreError('OUTPUT_FILE_NOT_FOUND')
    if (row.task_id !== input.taskId || row.session_id !== input.sessionId) {
      throw new OutputStoreError('OUTPUT_FILE_OWNERSHIP_MISMATCH')
    }
    const path = join(this.root, row.snapshot_path)
    const stats = await lstat(path).catch(() => null)
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink > 1) {
      throw new OutputStoreError('OUTPUT_FILE_UNAVAILABLE')
    }
    const bytes = await readFile(path)
    if (checksum(bytes) !== row.checksum) throw new OutputStoreError('OUTPUT_FILE_TAMPERED')
    return { bytes, name: row.name, mimeType: row.mime_type }
  }

  async copySnapshotTo(input: {
    fileId: string
    taskId: string
    sessionId: string
    destination: string
  }): Promise<{ name: string; mimeType: string; byteLength: number }> {
    const row = this.database
      .prepare('SELECT * FROM task_output_files WHERE file_id = ?')
      .get(input.fileId) as OutputRow | undefined
    if (!row) throw new OutputStoreError('OUTPUT_FILE_NOT_FOUND')
    if (row.task_id !== input.taskId || row.session_id !== input.sessionId) {
      throw new OutputStoreError('OUTPUT_FILE_OWNERSHIP_MISMATCH')
    }
    const path = join(this.root, row.snapshot_path)
    const stats = await lstat(path).catch(() => null)
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink > 1) {
      throw new OutputStoreError('OUTPUT_FILE_UNAVAILABLE')
    }
    await copyFile(path, input.destination)
    return { name: row.name, mimeType: row.mime_type, byteLength: row.byte_length }
  }

  private async outputDirectory(sessionId: string): Promise<string> {
    const workspace = await this.workspaces.forSession(sessionId)
    return workspace.output
  }
}

function outputFromRow(row: OutputRow): RegisteredOutput {
  return {
    fileId: row.file_id,
    sessionId: row.session_id,
    taskId: row.task_id,
    name: row.name,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    relativePath: row.relative_path,
    checksum: row.checksum,
    createdAt: row.created_at
  }
}

async function scanRegularFiles(
  root: string,
  relativeDirectory = '',
  depth = 0
): Promise<Array<{ relative: string; name: string; absolute: string }>> {
  if (depth > MAX_SCAN_DEPTH) return []
  const directory = relativeDirectory ? join(root, relativeDirectory) : root
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files: Array<{ relative: string; name: string; absolute: string }> = []
  for (const entry of entries) {
    const next = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
    const absolute = join(directory, entry.name)
    const stats = await lstat(absolute).catch(() => null)
    if (!stats) continue
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) {
      files.push(...(await scanRegularFiles(root, next, depth + 1)))
      continue
    }
    if (!stats.isFile()) continue
    if (next.split('/').some((segment) => segment.startsWith('.'))) continue
    files.push({ relative: next.split(sep).join('/'), name: entry.name, absolute })
  }
  return files
}

async function matchesFormat(bytes: Uint8Array, format: OutputFormat): Promise<boolean> {
  const normalized = Uint8Array.from(bytes)
  const header = Buffer.from(normalized.subarray(0, 8))
  if (format.kind === 'pdf') return header.subarray(0, 5).toString() === '%PDF-'
  if (format.kind === 'zip') return header.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004'
  const detected = await fileTypeFromBuffer(normalized)
  return detected?.mime === format.mimeType
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
