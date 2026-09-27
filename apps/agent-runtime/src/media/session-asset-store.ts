import type { ImageAssetRef } from '@actiondriver/contracts'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { imageSize } from 'image-size'

import { MAX_IMAGE_BYTES } from '@actiondriver/plugin-contracts'
export { MAX_IMAGE_BYTES } from '@actiondriver/plugin-contracts'
export const MAX_IMAGE_PIXELS = 16_777_216
export type StagedAssetRef = Omit<ImageAssetRef, 'sessionId'>
type ImageMime = ImageAssetRef['mimeType']
type AssetSource = ImageAssetRef['source']

type AssetRow = {
  asset_id: string
  session_id: string | null
  mime_type: ImageMime
  width: number
  height: number
  byte_length: number
  source: AssetSource
  status: 'staged' | 'bound'
  created_at: string
}

const EXTENSION: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}

export class AssetError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'AssetError'
  }
}

export class SessionAssetStore {
  private readonly database: Database.Database
  private readonly root: string
  private readonly now: () => Date

  constructor(options: { database: Database.Database; rootDirectory: string; now?: () => Date }) {
    this.database = options.database
    this.root = options.rootDirectory
    this.now = options.now ?? (() => new Date())
  }

  async stageUpload(bytes: Uint8Array): Promise<StagedAssetRef> {
    const details = await inspectImage(bytes)
    const assetId = randomUUID()
    const path = this.stagingPath(assetId, details.mimeType)
    await atomicWrite(path, bytes)
    try {
      this.database
        .prepare(
          `INSERT INTO session_assets
        (asset_id, session_id, mime_type, width, height, byte_length, source, status, created_at)
        VALUES (?, NULL, ?, ?, ?, ?, 'upload', 'staged', ?)`
        )
        .run(
          assetId,
          details.mimeType,
          details.width,
          details.height,
          bytes.byteLength,
          this.now().toISOString()
        )
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
    return { assetId, ...details, byteLength: bytes.byteLength, source: 'upload' }
  }

  async bindStaged(assetId: string, sessionId: string): Promise<ImageAssetRef> {
    assertSafeId(assetId)
    assertSafeId(sessionId)
    const row = this.find(assetId)
    if (!row) throw new AssetError('ASSET_NOT_FOUND')
    if (row.status === 'bound') {
      if (row.session_id !== sessionId) throw new AssetError('ASSET_SESSION_MISMATCH')
      return asBoundRef(row)
    }
    const from = this.stagingPath(assetId, row.mime_type)
    const to = this.sessionPath(sessionId, assetId, row.mime_type, 'upload')
    await mkdir(join(this.root, 'sessions', sessionId, 'attachments', 'uploads'), {
      recursive: true
    })
    try {
      await rename(from, to)
    } catch (error) {
      if (isMissing(error)) throw new AssetError('ASSET_NOT_FOUND')
      throw error
    }
    try {
      this.database
        .prepare(
          `UPDATE session_assets SET session_id = ?, status = 'bound', bound_at = ?
        WHERE asset_id = ? AND status = 'staged'`
        )
        .run(sessionId, this.now().toISOString(), assetId)
    } catch (error) {
      await rename(to, from)
      throw error
    }
    return { ...toStagedRef(row), sessionId }
  }

  async saveGenerated(sessionId: string, bytes: Uint8Array): Promise<ImageAssetRef> {
    assertSafeId(sessionId)
    const details = await inspectImage(bytes)
    const assetId = randomUUID()
    const path = this.sessionPath(sessionId, assetId, details.mimeType, 'generated')
    await atomicWrite(path, bytes)
    try {
      const timestamp = this.now().toISOString()
      this.database
        .prepare(
          `INSERT INTO session_assets
        (asset_id, session_id, mime_type, width, height, byte_length, source, status, created_at, bound_at)
        VALUES (?, ?, ?, ?, ?, ?, 'generated', 'bound', ?, ?)`
        )
        .run(
          assetId,
          sessionId,
          details.mimeType,
          details.width,
          details.height,
          bytes.byteLength,
          timestamp,
          timestamp
        )
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
    return { assetId, sessionId, ...details, byteLength: bytes.byteLength, source: 'generated' }
  }

  async read(
    assetId: string,
    sessionId: string
  ): Promise<{ bytes: Uint8Array; mimeType: ImageMime }> {
    assertSafeId(assetId)
    assertSafeId(sessionId)
    const row = this.find(assetId)
    if (!row) throw new AssetError('ASSET_NOT_FOUND')
    if (row.status !== 'bound' || row.session_id !== sessionId)
      throw new AssetError('ASSET_SESSION_MISMATCH')
    try {
      const bytes = await readFile(this.sessionPath(sessionId, assetId, row.mime_type, row.source))
      return { bytes, mimeType: row.mime_type }
    } catch (error) {
      if (isMissing(error)) throw new AssetError('ASSET_NOT_FOUND')
      throw error
    }
  }

  async cleanExpiredStaged(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(this.now().getTime() - maxAgeMs).toISOString()
    const rows = this.database
      .prepare(
        `SELECT * FROM session_assets
      WHERE status = 'staged' AND created_at < ?`
      )
      .all(cutoff) as AssetRow[]
    for (const row of rows) {
      await rm(this.stagingPath(row.asset_id, row.mime_type), { force: true })
      this.database
        .prepare(`DELETE FROM session_assets WHERE asset_id = ? AND status = 'staged'`)
        .run(row.asset_id)
    }
    return rows.length
  }

  async cleanOrphanFiles(): Promise<number> {
    const sessionsRoot = join(this.root, 'sessions')
    const sessions = await readdir(sessionsRoot, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissing(error)) return []
        throw error
      }
    )
    let removed = 0
    for (const session of sessions) {
      if (!session.isDirectory() || !/^[a-zA-Z0-9_-]{1,128}$/.test(session.name)) continue
      for (const source of ['uploads', 'generated'] as const) {
        const directory = join(sessionsRoot, session.name, 'attachments', source)
        const files = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
          if (isMissing(error)) return []
          throw error
        })
        for (const file of files) {
          if (!file.isFile()) continue
          const assetId = file.name.split('.')[0] ?? ''
          const row = this.find(assetId)
          const expected =
            row?.status === 'bound' &&
            row.session_id === session.name &&
            row.source === (source === 'uploads' ? 'upload' : 'generated')
              ? `${assetId}.${EXTENSION[row.mime_type]}`
              : null
          if (file.name === expected) continue
          await rm(join(directory, file.name), { force: true })
          removed += 1
        }
      }
    }
    return removed
  }

  private find(assetId: string): AssetRow | undefined {
    return this.database.prepare('SELECT * FROM session_assets WHERE asset_id = ?').get(assetId) as
      | AssetRow
      | undefined
  }

  private stagingPath(assetId: string, mimeType: ImageMime): string {
    return join(this.root, 'staging', `${assetId}.${EXTENSION[mimeType]}`)
  }

  private sessionPath(
    sessionId: string,
    assetId: string,
    mimeType: ImageMime,
    source: AssetSource
  ): string {
    return join(
      this.root,
      'sessions',
      sessionId,
      'attachments',
      source === 'upload' ? 'uploads' : 'generated',
      `${assetId}.${EXTENSION[mimeType]}`
    )
  }
}

export async function inspectImage(
  bytes: Uint8Array
): Promise<{ mimeType: ImageMime; width: number; height: number }> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES)
    throw new AssetError('IMAGE_TOO_LARGE_OR_EMPTY')
  const normalized = Uint8Array.from(bytes)
  const detected = await fileTypeFromBuffer(normalized)
  const mimeType = detected?.mime
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp')
    throw new AssetError('IMAGE_TYPE_UNSUPPORTED')
  let dimensions: { width: number; height: number }
  try {
    dimensions = imageSize(normalized)
  } catch {
    throw new AssetError('IMAGE_DIMENSIONS_INVALID')
  }
  const { width, height } = dimensions
  if (!width || !height || width * height > MAX_IMAGE_PIXELS)
    throw new AssetError('IMAGE_DIMENSIONS_INVALID')
  return { mimeType, width, height }
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const directory = path.slice(0, path.lastIndexOf('/'))
  await mkdir(directory, { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

function assertSafeId(value: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new AssetError('ASSET_ID_INVALID')
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function toStagedRef(row: AssetRow): StagedAssetRef {
  return {
    assetId: row.asset_id,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteLength: row.byte_length,
    source: row.source
  }
}

function asBoundRef(row: AssetRow): ImageAssetRef {
  if (!row.session_id) throw new AssetError('ASSET_NOT_BOUND')
  return { ...toStagedRef(row), sessionId: row.session_id }
}
