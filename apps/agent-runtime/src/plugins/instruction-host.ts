import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, realpath, rm, stat, writeFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { PluginError, type PluginOwner, type SkillContribution } from '@actiondriver/plugin-contracts'
import type { Disposable } from '@actiondriver/plugin-sdk'
import type { AgentFileNodeDto, AgentSkillSummaryDto, AgentTextFileDto } from '@actiondriver/runtime-contracts'
type Entry = { owner: PluginOwner; skill: SkillContribution; root: string; path: string; modifiedAt: string }
export class PluginInstructionHost {
  private readonly staged = new Map<string, Entry>()
  private readonly live = new Map<string, Entry>()
  private readonly names: Set<string>
  constructor(private readonly home: string, managed: string[] = []) { this.names = new Set(managed) }
  owns(id: string): boolean { return this.names.has(id) }
  private key(owner: PluginOwner, id: string) { return `${owner.pluginId}@${owner.version}@${owner.hostEpoch}:${id}` }
  async stage(owner: PluginOwner, skill: SkillContribution, packageRoot: string): Promise<Disposable> {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(skill.id)) throw new PluginError('INVALID_MANIFEST', 'Invalid Skill identity')
    if (!this.names.has(skill.id)) {
      for (const existing of [join(this.home, '.action-driver/skills', skill.id), join(this.home, '.action-driver/skills/.system', skill.id)]) {
        try { await stat(existing) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
        throw new PluginError('CONTRIBUTION_CONFLICT', `Skill already exists: ${skill.id}`)
      }
    }
    const path = `.action-driver/skills/.plugins/${owner.pluginId}/${Buffer.from(owner.hostEpoch).toString('hex')}/${skill.id}`
    const root = join(this.home, path), packageCanonical = await realpath(packageRoot)
    await mkdir(root, { recursive: true })
    const canonical = await realpath(root), home = await realpath(join(this.home, '.action-driver/skills'))
    if (!within(home, canonical)) throw new PluginError('INVALID_MANIFEST', 'Skill cache escapes managed directory')
    const key = this.key(owner, skill.id)
    try {
      const entryResource = skill.resources.find(path => path.endsWith('/SKILL.md') || path === 'SKILL.md')
      const prefix = entryResource ? dirname(entryResource) : ''
      for (const resource of skill.resources) {
        const source = await realpath(join(packageRoot, resource))
        if (!within(packageCanonical, source) || !(await stat(source)).isFile()) throw new PluginError('INVALID_MANIFEST', 'Skill resource is outside package or not a file')
        const local = prefix && resource.startsWith(prefix + '/') ? resource.slice(prefix.length + 1) : resource
        const target = join(root, local)
        if (!within(root, target)) throw new PluginError('INVALID_MANIFEST', 'Skill resource escapes cache')
        await mkdir(dirname(target), { recursive: true }); await cp(source, target)
      }
      await writeFile(join(root, 'SKILL.md'), skill.content)
      const modifiedAt = (await stat(join(root, 'SKILL.md'))).mtime.toISOString()
      const record = { owner: { ...owner }, skill: structuredClone(skill), root: canonical, path, modifiedAt }
      this.staged.set(key, record); this.names.add(skill.id)
      return { dispose: async () => { if (this.live.get(skill.id) === record) this.live.delete(skill.id); this.staged.delete(key); await rm(root, { recursive: true, force: true }) } }
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error }
  }
  publish(owner: PluginOwner, id: string): Disposable {
    const entry = this.staged.get(this.key(owner, id))
    if (!entry) throw new PluginError('INVALID_MANIFEST', `Skill content missing: ${id}`)
    if (this.live.has(id)) throw new PluginError('CONTRIBUTION_CONFLICT', id)
    this.live.set(id, entry)
    return { dispose: () => { if (this.live.get(id) === entry) this.live.delete(id) } }
  }
  list(): AgentSkillSummaryDto[] {
    return [...this.live.values()].map(({ skill, modifiedAt }) => ({ id: skill.id, name: skill.name, description: skill.description, source: 'plugin', enabled: true, available: true, executorId: null, unavailableReason: null, protected: true, modifiedAt }))
  }
  async read(id: string, path: string): Promise<AgentTextFileDto> {
    const record = this.live.get(id)
    if (!record) throw new PluginError('UNAVAILABLE', id)
    const file = await realpath(join(record.root, path))
    if (!within(record.root, file) || !(await stat(file)).isFile()) throw new PluginError('INVALID_MANIFEST', 'Skill file escapes contribution')
    const content = await readFile(file, 'utf8')
    if (Buffer.byteLength(content) > 1_048_576) throw new PluginError('PROTOCOL_ERROR', 'Skill file exceeds read limit')
    return { path: `${record.path}/${path}`, content, digest: createHash('sha256').update(content).digest('hex'), modifiedAt: (await stat(file)).mtime.toISOString() }
  }
  async tree(id: string): Promise<AgentFileNodeDto[]> {
    const record = this.live.get(id)
    if (!record) throw new PluginError('UNAVAILABLE', id)
    const read = async (root: string, path: string): Promise<AgentFileNodeDto[]> => Promise.all((await readdir(root, { withFileTypes: true })).map(async entry => ({ name: entry.name, path: `${path}/${entry.name}`, kind: entry.isDirectory() ? 'directory' as const : 'file' as const, ...(entry.isDirectory() ? { children: await read(join(root, entry.name), `${path}/${entry.name}`) } : {}) })))
    return read(record.root, record.path)
  }
}
function within(root: string, path: string): boolean { const value = relative(root, path); return value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value) }
