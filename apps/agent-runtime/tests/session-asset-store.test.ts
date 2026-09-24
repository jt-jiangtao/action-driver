import { readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openRuntimeDatabase } from '../src/database'
import { SessionAssetStore } from '../src/media/session-asset-store'

const roots: string[] = []
const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'apps/agent-runtime/tests/fixtures', name))

function setup(now = () => new Date('2026-09-25T00:00:00.000Z')) {
  const root = mkdtempSync(join(tmpdir(), 'actiondriver-images-'))
  roots.push(root)
  const database = openRuntimeDatabase(join(root, 'actiondriver.db'))
  return { root, database, store: new SessionAssetStore({ database, rootDirectory: root, now }) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('session image assets', () => {
  it.each([
    ['tiny.png', 'image/png'],
    ['tiny.jpg', 'image/jpeg'],
    ['tiny.webp', 'image/webp']
  ])('accepts real %s bytes and reads them from their bound session', async (name, mimeType) => {
    const { database, store } = setup()
    const staged = await store.stageUpload(fixture(name))
    expect(staged).toMatchObject({ mimeType, width: 2, height: 2, source: 'upload' })
    const bound = await store.bindStaged(staged.assetId, 'session-a')
    expect(bound).toMatchObject({ assetId: staged.assetId, sessionId: 'session-a' })
    expect(await store.read(staged.assetId, 'session-a')).toMatchObject({
      mimeType,
      bytes: fixture(name)
    })
    expect(await store.bindStaged(staged.assetId, 'session-a')).toEqual(bound)
    database.close()
  })

  it('rejects disguised, corrupt, oversized and over-dimensioned input before recording an asset', async () => {
    const { database, store } = setup()
    await expect(store.stageUpload(Buffer.from('not an image'))).rejects.toThrow()
    await expect(store.stageUpload(fixture('tiny.png').subarray(0, 8))).rejects.toThrow()
    await expect(store.stageUpload(Buffer.alloc(20 * 1024 * 1024 + 1))).rejects.toThrow()
    expect(database.prepare('SELECT COUNT(*) AS count FROM session_assets').get()).toEqual({
      count: 0
    })
    database.close()
  })

  it('keeps generated and uploaded images isolated by session and source', async () => {
    const { database, root, store } = setup()
    const staged = await store.stageUpload(fixture('tiny.png'))
    await store.bindStaged(staged.assetId, 'session-a')
    const generated = await store.saveGenerated('session-b', fixture('tiny.jpg'))
    expect(readdirSync(join(root, 'sessions', 'session-a', 'attachments', 'uploads'))).toHaveLength(
      1
    )
    expect(
      readdirSync(join(root, 'sessions', 'session-b', 'attachments', 'generated'))
    ).toHaveLength(1)
    await expect(store.read(staged.assetId, 'session-b')).rejects.toThrow('ASSET_SESSION_MISMATCH')
    await expect(store.bindStaged(staged.assetId, 'session-b')).rejects.toThrow(
      'ASSET_SESSION_MISMATCH'
    )
    await expect(store.read('missing', 'session-a')).rejects.toThrow('ASSET_NOT_FOUND')
    expect(generated.source).toBe('generated')
    database.close()
  })

  it('cleans expired staging records and files', async () => {
    let time = new Date('2026-09-25T00:00:00.000Z')
    const { database, store } = setup(() => time)
    const staged = await store.stageUpload(fixture('tiny.png'))
    time = new Date('2026-09-26T00:00:00.000Z')
    expect(await store.cleanExpiredStaged(60_000)).toBe(1)
    await expect(store.bindStaged(staged.assetId, 'session-a')).rejects.toThrow('ASSET_NOT_FOUND')
    database.close()
  })

  it('removes an orphaned file while retaining a referenced image', async () => {
    const { database, root, store } = setup()
    const saved = await store.saveGenerated('session-a', fixture('tiny.png'))
    const directory = join(root, 'sessions', 'session-a', 'attachments', 'generated')
    writeFileSync(join(directory, 'orphan.png'), fixture('tiny.png'))
    expect(await store.cleanOrphanFiles()).toBe(1)
    expect(readdirSync(directory)).toEqual([`${saved.assetId}.png`])
    database.close()
  })
})
