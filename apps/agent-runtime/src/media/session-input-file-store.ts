import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import type { SessionWorkspaceStore } from '../execution/session-workspace'

export const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024
const MAX_NAME_LENGTH = 200

type DocumentMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'

type Format = { extension: string; kind: 'pdf' | 'zip' | 'image' }

const FORMATS: Record<DocumentMimeType, Format> = {
  'application/pdf': { extension: '.pdf', kind: 'pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: '.docx',
    kind: 'zip'
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extension: '.pptx',
    kind: 'zip'
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extension: '.xlsx',
    kind: 'zip'
  },
  'image/png': { extension: '.png', kind: 'image' },
  'image/jpeg': { extension: '.jpg', kind: 'image' },
  'image/webp': { extension: '.webp', kind: 'image' }
}

export class InputFileError extends Error {
  constructor(
    readonly code: string,
    message: string = code
  ) {
    super(message)
    this.name = 'InputFileError'
  }
}

export type StagedInputFile = {
  fileId: string
  name: string
  mimeType: string
  byteLength: number
}

export type BoundInputFile = StagedInputFile & {
  sessionId: string
  taskId: string
  relativePath: string
  absolutePath: string
}

type InputFileRow = {
  file_id: string
  status: 'staged' | 'bound'
  session_id: string | null
  task_id: string | null
  name: string
  mime_type: string
  byte_length: number
  relative_path: string | null
  checksum: string
  created_at: string
  bound_at: string | null
}

/**
 * Uploaded documents live as ordinary files inside the session `input/`
 * directory. Bytes never travel through messages or events: the message only
 * carries the identifier, name, format and size recorded here.
 */
export class SessionInputFileStore {
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
    this.root = join(options.rootDirectory, 'input-files')
    this.workspaces = options.workspaces
    this.now = options.now ?? (() => new Date())
  }

  async stageUpload(input: {
    bytes: Uint8Array
    name: string
    mimeType: string
  }): Promise<StagedInputFile> {
    const name = validateName(input.name)
    const format = FORMATS[input.mimeType as DocumentMimeType]
    if (!format) throw new InputFileError('INPUT_FILE_TYPE_UNSUPPORTED')
    if (extname(name).toLowerCase() !== format.extension) {
      throw new InputFileError('INPUT_FILE_NAME_INVALID')
    }
    if (input.bytes.byteLength === 0) throw new InputFileError('INPUT_FILE_EMPTY')
    if (input.bytes.byteLength > MAX_INPUT_FILE_BYTES) {
      throw new InputFileError('INPUT_FILE_TOO_LARGE')
    }
    await assertContentMatches(input.bytes, format, input.mimeType)

    const fileId = randomUUID()
    const path = this.stagingPath(fileId)
    await mkdir(join(this.root, 'staging'), { recursive: true, mode: 0o700 })
    await writeFile(path, input.bytes, { mode: 0o600 })
    try {
      this.database
        .prepare(
          `INSERT INTO session_input_files
            (file_id, status, session_id, task_id, name, mime_type, byte_length, relative_path,
             checksum, created_at, bound_at)
           VALUES (?, 'staged', NULL, NULL, ?, ?, ?, NULL, ?, ?, NULL)`
        )
        .run(
          fileId,
          name,
          input.mimeType,
          input.bytes.byteLength,
          checksum(input.bytes),
          this.now().toISOString()
        )
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
    return {
      fileId,
      name,
      mimeType: input.mimeType,
      byteLength: input.bytes.byteLength
    }
  }

  async bind(
    fileId: string,
    binding: { sessionId: string; taskId: string }
  ): Promise<BoundInputFile> {
    const row = this.find(fileId)
    if (!row) throw new InputFileError('INPUT_FILE_NOT_FOUND')
    if (row.status !== 'staged') throw new InputFileError('INPUT_FILE_NOT_STAGED')
    let bytes: Uint8Array
    try {
      bytes = await readFile(this.stagingPath(fileId))
    } catch {
      throw new InputFileError('INPUT_FILE_NOT_FOUND')
    }
    if (checksum(bytes) !== row.checksum) {
      throw new InputFileError('INPUT_FILE_CHECKSUM_MISMATCH')
    }
    const relativePath = await this.materialize(binding.sessionId, row.name, bytes)
    const boundAt = this.now().toISOString()
    this.database
      .prepare(
        `UPDATE session_input_files
         SET status = 'bound', session_id = ?, task_id = ?, relative_path = ?, bound_at = ?
         WHERE file_id = ? AND status = 'staged'`
      )
      .run(binding.sessionId, binding.taskId, relativePath, boundAt, fileId)
    await rm(this.stagingPath(fileId), { force: true })
    return {
      fileId,
      sessionId: binding.sessionId,
      taskId: binding.taskId,
      name: row.name,
      mimeType: row.mime_type,
      byteLength: row.byte_length,
      relativePath,
      absolutePath: await this.workspaces.resolveFile(
        binding.sessionId,
        'input',
        relativePath.replace(/^input\//, ''),
        { mustBeRegularFile: true }
      )
    }
  }

  async read(
    fileId: string,
    sessionId: string
  ): Promise<{ bytes: Uint8Array; name: string; mimeType: string }> {
    const row = this.find(fileId)
    if (!row) throw new InputFileError('INPUT_FILE_NOT_FOUND')
    if (row.status !== 'bound' || row.session_id !== sessionId || !row.relative_path) {
      throw new InputFileError('INPUT_FILE_SESSION_MISMATCH')
    }
    try {
      const path = await this.workspaces.resolveFile(
        sessionId,
        'input',
        row.relative_path.replace(/^input\//, ''),
        { mustBeRegularFile: true }
      )
      return { bytes: await readFile(path), name: row.name, mimeType: row.mime_type }
    } catch (error) {
      if (error instanceof InputFileError) throw error
      throw new InputFileError('INPUT_FILE_NOT_FOUND')
    }
  }

  async discard(fileId: string): Promise<void> {
    this.database
      .prepare(`DELETE FROM session_input_files WHERE file_id = ? AND status = 'staged'`)
      .run(fileId)
    await rm(this.stagingPath(fileId), { force: true })
  }

  private async materialize(
    sessionId: string,
    name: string,
    bytes: Uint8Array
  ): Promise<string> {
    const extension = extname(name)
    const stem = name.slice(0, name.length - extension.length)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = attempt === 0 ? name : `${stem}-${attempt + 1}${extension}`
      const path = await this.workspaces.resolveFile(sessionId, 'input', candidate, {
        createParents: true
      })
      const existing = await lstat(path).catch(() => null)
      if (existing) continue
      await writeFile(path, bytes, { flag: 'wx', mode: 0o644 })
      return `input/${candidate}`
    }
    throw new InputFileError('INPUT_FILE_NAME_CONFLICT')
  }

  private find(fileId: string): InputFileRow | null {
    const row = this.database
      .prepare('SELECT * FROM session_input_files WHERE file_id = ?')
      .get(fileId) as InputFileRow | undefined
    return row ?? null
  }

  private stagingPath(fileId: string): string {
    return join(this.root, 'staging', fileId)
  }
}

function validateName(name: string): string {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_NAME_LENGTH ||
    name.includes('\0') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.startsWith('.') ||
    basename(name) !== name ||
    name.trim() !== name
  ) {
    throw new InputFileError('INPUT_FILE_NAME_INVALID')
  }
  return name
}

async function assertContentMatches(
  bytes: Uint8Array,
  format: Format,
  mimeType: string
): Promise<void> {
  // Buffer instances can come from another realm (the renderer bundle), so
  // normalize before sniffing content.
  const normalized = Uint8Array.from(bytes)
  const header = Buffer.from(normalized.subarray(0, 8))
  if (format.kind === 'pdf' && header.subarray(0, 5).toString() !== '%PDF-') {
    throw new InputFileError('INPUT_FILE_CONTENT_INVALID')
  }
  if (format.kind === 'zip' && header.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') {
    throw new InputFileError('INPUT_FILE_CONTENT_INVALID')
  }
  if (format.kind === 'image') {
    const detected = await fileTypeFromBuffer(normalized)
    if (!detected || detected.mime !== mimeType) {
      throw new InputFileError('INPUT_FILE_CONTENT_INVALID')
    }
  }
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
