import { z } from 'zod'
import { PluginError, panelDefinitionSchema, viewDefinitionSchema, type PanelDefinition, type PluginOwner, type Json, type ViewDefinition } from '@actiondriver/plugin-contracts'
import type { Disposable } from '@actiondriver/plugin-sdk'
export const PANEL_PREFERENCES = { sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } as const
type SurfaceDefinition = PanelDefinition | ViewDefinition
export interface PanelHostPorts {
  assertInstance(owner: PluginOwner): void
  ids(): string
  declarations(owner: PluginOwner): PanelDefinition[]
  /** Containers this host can actually render; a declared but unsupported one fails diagnosably. */
  viewDeclarations?(owner: PluginOwner): ViewDefinition[]
  supportedViewContainers?(): readonly string[]
  create(input: { owner: PluginOwner; resourceId: string; definition: SurfaceDefinition; preferences: typeof PANEL_PREFERENCES }): Promise<Disposable>
  message(owner: PluginOwner, panelId: string, type: string, payload: Json): Promise<Json>
}
export class PluginPanelHost implements Disposable {
  private readonly panels = new Map<string, { owner: PluginOwner; definition: SurfaceDefinition; surface?: Disposable }>()
  constructor(private readonly ports: PanelHostPorts) {}
  async open(owner: PluginOwner, id: string): Promise<{ resourceId: string }> {
    this.ports.assertInstance(owner)
    const declaration = this.ports.declarations(owner).find(value => value.id === id)
    if (!declaration) throw new PluginError('PROTOCOL_ERROR', `Undeclared panel ${id}`)
    const definition = panelDefinitionSchema.parse(declaration), resourceId = this.ports.ids()
    for (const schema of Object.values(definition.messages)) z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
    if (this.panels.has(resourceId)) throw new PluginError('CONTRIBUTION_CONFLICT', resourceId)
    const record: { owner: PluginOwner; definition: SurfaceDefinition; surface?: Disposable } = { owner: { ...owner }, definition }
    this.panels.set(resourceId, record)
    try {
      const surface = await this.ports.create({ owner, resourceId, definition, preferences: PANEL_PREFERENCES })
      if (this.panels.get(resourceId) !== record) { await surface.dispose(); throw new PluginError('STALE_INSTANCE', resourceId) }
      record.surface = surface
      this.ports.assertInstance(owner)
      return { resourceId }
    } catch (error) { this.panels.delete(resourceId); await record.surface?.dispose(); throw error }
  }
  /**
   * A view is declared by the manifest and placed by the host. Content still runs in the
   * controlled surface, never in the app renderer, so the typed bridge above stays the only
   * channel between the page and its plugin.
   */
  async openView(owner: PluginOwner, id: string): Promise<{ resourceId: string }> {
    this.ports.assertInstance(owner)
    const declaration = (this.ports.viewDeclarations?.(owner) ?? []).find(value => value.id === id)
    if (!declaration) throw new PluginError('PROTOCOL_ERROR', `Undeclared view ${id}`)
    const definition = viewDefinitionSchema.parse(declaration)
    if (!(this.ports.supportedViewContainers?.() ?? []).includes(definition.container)) throw new PluginError('UNAVAILABLE', `View container ${definition.container} is not supported by this host`)
    const resourceId = this.ports.ids()
    for (const schema of Object.values(definition.messages)) z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
    if (this.panels.has(resourceId)) throw new PluginError('CONTRIBUTION_CONFLICT', resourceId)
    const record: { owner: PluginOwner; definition: SurfaceDefinition; surface?: Disposable } = { owner: { ...owner }, definition }
    this.panels.set(resourceId, record)
    try {
      const surface = await this.ports.create({ owner, resourceId, definition, preferences: PANEL_PREFERENCES })
      if (this.panels.get(resourceId) !== record) { await surface.dispose(); throw new PluginError('STALE_INSTANCE', resourceId) }
      record.surface = surface
      this.ports.assertInstance(owner)
      return { resourceId }
    } catch (error) { this.panels.delete(resourceId); await record.surface?.dispose(); throw error }
  }
  async receive(resourceId: string, owner: PluginOwner, type: string, payload: Json): Promise<Json> {
    this.ports.assertInstance(owner)
    const panel = this.owned(resourceId, owner), schema = panel.definition.messages[type]
    if (!schema || !z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(payload).success || JSON.stringify(payload).length > 1_048_576) throw new PluginError('PROTOCOL_ERROR', `Undeclared or invalid panel message ${type}`)
    return z.json().parse(await this.ports.message(owner, panel.definition.id, type, payload))
  }
  async close(owner: PluginOwner, resourceId: string): Promise<void> {
    if (!this.panels.has(resourceId)) return
    const panel = this.owned(resourceId, owner)
    this.panels.delete(resourceId)
    await panel.surface?.dispose()
  }
  async disposeOwner(owner: PluginOwner): Promise<void> {
    const results = await Promise.allSettled([...this.panels].filter(([, panel]) => panel.owner.pluginId === owner.pluginId && panel.owner.hostEpoch === owner.hostEpoch && panel.owner.version === owner.version).map(([id]) => this.close(owner, id)))
    const failed = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected')
    if (failed.length) throw new AggregateError(failed.map(value => value.reason), 'Panel cleanup failed')
  }
  async dispose(): Promise<void> { await Promise.all([...this.panels].map(([id, panel]) => this.close(panel.owner, id))) }
  private owned(resourceId: string, owner: PluginOwner) {
    const panel = this.panels.get(resourceId)
    if (!panel) throw new PluginError('UNAVAILABLE', resourceId)
    if (panel.owner.pluginId !== owner.pluginId || panel.owner.version !== owner.version || panel.owner.hostEpoch !== owner.hostEpoch) throw new PluginError('STALE_INSTANCE', resourceId)
    return panel
  }
}
