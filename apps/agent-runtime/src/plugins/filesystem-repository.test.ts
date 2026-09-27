import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilesystemPluginRepository, PluginPrivateStorage } from './filesystem-repository'
import { validateManifest } from '@actiondriver/plugin-contracts'
it('keeps version packages and plugin-private data separate and preserves data on uninstall by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actiondriver-plugin-store-')), source = join(root, 'source')
  await mkdir(source); await writeFile(join(source, 'entry.mjs'), 'export function activate() {}')
  const manifest = validateManifest({ id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'entry.mjs', platforms: ['darwin-arm64'] }, { sdk: '1.0.0', platform: 'darwin-arm64' })
  let sequence = 0
  const repository = new FilesystemPluginRepository(join(root, 'plugins'), () => source, () => String(++sequence))
  const storage = new PluginPrivateStorage(join(root, 'plugins'), () => String(++sequence))
  try {
    await repository.publish(manifest)
    expect((await repository.list())[0]?.version).toBe('1.0.0')
    await repository.publish({ ...manifest, version: '1.1.0' })
    expect(await readFile(join(repository.packageRoot(manifest), 'entry.mjs'), 'utf8')).toContain('activate')
    await storage.set('fixture', '../settings', { configured: true })
    expect(await storage.get('other', '../settings')).toBeNull()
    await repository.remove('fixture', { deleteData: false })
    expect(await repository.list()).toEqual([])
    expect(await storage.get('fixture', '../settings')).toEqual({ configured: true })
    await repository.remove('fixture', { deleteData: true })
    expect(await storage.get('fixture', '../settings')).toBeNull()
  } finally { await rm(root, { recursive: true, force: true }) }
})
