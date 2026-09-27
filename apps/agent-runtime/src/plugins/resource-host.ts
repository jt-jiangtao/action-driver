import { z } from 'zod'
import { PluginError, pluginToolDefinitionSchema, type Json, type PluginManifest, type PluginOwner, type PluginCatalog } from '@actiondriver/plugin-contracts'
import type { Disposable } from '@actiondriver/plugin-sdk'
import type { ContributionRegistrar } from './ports'
import type { NodeServiceSupervisor, SupervisedService } from './service-supervisor'
export interface PluginResourceHostPorts {
  supervisor: Pick<NodeServiceSupervisor, 'start'>
  ids(): string
  manifest(owner: PluginOwner): PluginManifest
  packageRoot(owner: PluginOwner): string
  catalog(owner: PluginOwner): PluginCatalog
  track(owner: PluginOwner, resource: Disposable): void
  failed(owner: PluginOwner): Promise<void>
}
export class PluginResourceHost {
  private readonly resources = new Map<string, { owner: PluginOwner; service: SupervisedService; registrar: ContributionRegistrar }>()
  private readonly tools = new Map<string, { owner: PluginOwner; service: SupervisedService; name: string }>()
  constructor(private readonly ports: PluginResourceHostPorts) {}
  async start(owner: PluginOwner, input: Json, registrar: ContributionRegistrar): Promise<Json> {
    const { id } = z.object({ id: z.string() }).strict().parse(input)
    const manifest = this.ports.manifest(owner)
    const definition = manifest.services?.find(service => service.id === id)
    if (!definition || !manifest.contributions.some(value => value.kind === 'service' && value.id === id)) throw new PluginError('PROTOCOL_ERROR', `Undeclared service ${id}`)
    const service = await this.ports.supervisor.start(definition, owner, this.ports.packageRoot(owner))
    const resourceId = this.ports.ids()
    this.resources.set(resourceId, { owner, service, registrar })
    const disposer = { dispose: async () => {
      if (!this.resources.delete(resourceId)) return
      try {
        for (const [toolId, value] of this.tools) if (value.service === service) { this.tools.delete(toolId); registrar.unregister?.(manifest.contributions.find(item => item.kind === 'tool' && item.id === toolId)!) }
      } finally { await service.dispose() }
    } }
    try {
      this.ports.track(owner, disposer)
      service.onExit(() => { void this.ports.failed(owner).catch(() => {}) })
      for (const remote of service.tools()) {
        const id = `${owner.pluginId}.${remote.name.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase()}`
        const declaration = manifest.contributions.find(item => item.kind === 'tool' && item.id === id)
        if (!declaration?.modelName) throw new PluginError('PROTOCOL_ERROR', `Undeclared MCP tool ${remote.name}`)
        const catalog = this.ports.catalog(owner)
        const existing = catalog.tools.find(item => item.id === id)
        const tool = pluginToolDefinitionSchema.parse({ ...(existing ?? { id, version: 1, modelName: declaration.modelName, description: remote.description || remote.name, risk: 'high', sideEffects: { filesystem: 'write', network: true }, timeoutMs: 30000 }), inputSchema: remote.inputSchema })
        if (existing) catalog.tools.splice(catalog.tools.indexOf(existing), 1, tool); else catalog.tools.push(tool)
        if (this.tools.has(id)) throw new PluginError('CONTRIBUTION_CONFLICT', id)
        this.tools.set(id, { owner, service, name: remote.name })
        registrar.register(declaration)
      }
      return { resourceId }
    } catch (error) { await disposer.dispose(); throw error }
  }
  async stop(owner: PluginOwner, payload: Json): Promise<Json> {
    const { resourceId } = z.object({ resourceId: z.string() }).strict().parse(payload)
    const resource = this.resources.get(resourceId)
    if (!resource) return null
    if (resource.owner.pluginId !== owner.pluginId || resource.owner.hostEpoch !== owner.hostEpoch) throw new PluginError('STALE_INSTANCE', resourceId)
    this.resources.delete(resourceId)
    for (const [id, value] of this.tools) if (value.service === resource.service) { resource.registrar.unregister?.(this.ports.manifest(owner).contributions.find(item => item.kind === 'tool' && item.id === id)!); this.tools.delete(id) }
    await resource.service.dispose(); return null
  }
  resolveTool(owner: PluginOwner, id: string) {
    const result = this.tools.get(id)
    return result?.owner.hostEpoch === owner.hostEpoch && result.owner.pluginId === owner.pluginId ? result : undefined
  }
}
