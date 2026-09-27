import { cp, mkdir, readFile, readdir, rename, rm, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { PluginError, type Json, type PluginManifest } from '@actiondriver/plugin-contracts'
import type { PluginRepository } from './ports'
export class FilesystemPluginRepository implements PluginRepository {
  constructor(private readonly root: string, private readonly source: (manifest: PluginManifest) => string, private readonly ids: () => string) {}
  packageRoot(manifest: PluginManifest): string { return join(this.root, 'installed', manifest.id, manifest.version) }
  async publish(manifest: PluginManifest): Promise<void> {
    const parent = dirname(this.packageRoot(manifest)), destination = this.packageRoot(manifest)
    await mkdir(parent, { recursive: true })
    const source = this.source(manifest)
    const temporary = join(parent, `.install-${this.ids()}`)
    try {
      const canonicalRoot = await realpath(source)
      const canonicalEntry = await realpath(resolve(source, manifest.entry))
      if (relative(canonicalRoot, canonicalEntry).startsWith('..') || !(await stat(canonicalEntry)).isFile()) throw new PluginError('INVALID_MANIFEST', 'Entry is outside package or not a file')
      try { await stat(destination) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await cp(source, temporary, { recursive: true, filter: path => !path.split('/').some(part => part === 'node_modules' || part === '.git') })
        await writeFile(join(temporary, 'plugin.json'), JSON.stringify(manifest))
        await rename(temporary, destination)
      }
      const pointer = join(parent, `.current-${this.ids()}.json`)
      await writeFile(pointer, JSON.stringify(manifest))
      await rename(pointer, join(parent, 'current.json'))
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
  async list(): Promise<PluginManifest[]> {
    const installed = join(this.root, 'installed')
    let names: string[]
    try { names = await readdir(installed) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const manifests = await Promise.all(names.map(async id => {
      try { return JSON.parse(await readFile(join(installed, id, 'current.json'), 'utf8')) as PluginManifest }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    }))
    return manifests.filter((manifest): manifest is PluginManifest => manifest !== undefined)
  }
  async remove(id: string, options: { deleteData: boolean }): Promise<void> {
    await rm(join(this.root, 'installed', id), { recursive: true, force: true })
    if (options.deleteData) await rm(join(this.root, 'data', id), { recursive: true, force: true })
  }
}
export class PluginPrivateStorage {
  constructor(private readonly root: string, private readonly ids: () => string) {}
  private path(pluginId: string, key: string): string {
    if (!key || key.length > 256) throw new PluginError('PROTOCOL_ERROR', 'Invalid storage key')
    return join(this.root, 'data', pluginId, `${Buffer.from(key).toString('hex')}.json`)
  }
  async get(pluginId: string, key: string): Promise<Json> {
    try { return JSON.parse(await readFile(this.path(pluginId, key), 'utf8')) as Json }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async set(pluginId: string, key: string, value: Json): Promise<void> {
    const target = this.path(pluginId, key), temporary = `${target}.${this.ids()}.tmp`
    await mkdir(dirname(target), { recursive: true })
    try { await writeFile(temporary, JSON.stringify(value)); await rename(temporary, target) }
    finally { await rm(temporary, { force: true }) }
  }
}
