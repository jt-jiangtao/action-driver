import { z } from 'zod'
import { PluginError, type PluginManifest, type PluginOwner, type Json } from '@action-driver/plugin-contracts'
import type { HostedSkillProvider } from '../skill-provider-host'
import type { PluginPanelHost } from './panel-host'
const ownerSchema = z.object({ pluginId: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/), version: z.string().min(1), hostEpoch: z.string().min(1).max(200) }).strict()
export function createPluginPanelProvider(options: {
  loadManifest(owner: PluginOwner): Promise<PluginManifest>
  createHost(ports: {
    assertInstance(owner: PluginOwner): void
    declarations(owner: PluginOwner): NonNullable<PluginManifest['panels']>
    viewDeclarations(owner: PluginOwner): NonNullable<PluginManifest['views']>
  }): { host: PluginPanelHost; dispose(): Promise<void> }
}) {
  const bindings = new Map<string, { owner: PluginOwner; manifest: PluginManifest }>()
  const binding = (owner: PluginOwner) => {
    const current = bindings.get(owner.pluginId)
    if (!current || current.owner.hostEpoch !== owner.hostEpoch || current.owner.version !== owner.version) throw new PluginError('STALE_INSTANCE', owner.pluginId)
    return current
  }
  // Only containers the desktop actually renders are announced; anything else fails per view.
  const panels = options.createHost({ assertInstance: owner => { binding(owner) }, declarations: owner => binding(owner).manifest.panels ?? [], viewDeclarations: owner => binding(owner).manifest.views ?? [] })
  const provider: HostedSkillProvider = {
    providerId: 'desktop.plugin-panels', providerVersion: '1.0.0', skillId: 'plugin-panels',
    async execute(raw: unknown, signal): Promise<Json> {
      const input = z.object({ operation: z.enum(['bind', 'request', 'release']), owner: ownerSchema, method: z.string().optional(), payload: z.json().optional() }).strict().parse(raw)
      signal?.throwIfAborted()
      if (input.operation === 'bind') {
        const manifest = await options.loadManifest(input.owner)
        if (manifest.id !== input.owner.pluginId || manifest.version !== input.owner.version || manifest.panels?.some(panel => !manifest.contributions.some(contribution => contribution.kind === 'panel' && contribution.id === panel.id))) throw new PluginError('INVALID_MANIFEST', 'Panel identity or contribution mismatch')
        const previous = bindings.get(input.owner.pluginId)
        if (previous) await panels.host.disposeOwner(previous.owner)
        signal?.throwIfAborted()
        bindings.set(input.owner.pluginId, { owner: input.owner, manifest })
        return null
      }
      binding(input.owner)
      if (input.operation === 'release') {
        bindings.delete(input.owner.pluginId)
        await panels.host.disposeOwner(input.owner)
        return null
      }
      if (input.method === 'panels.open') {
        const { id } = z.object({ id: z.string() }).strict().parse(input.payload)
        return panels.host.open(input.owner, id)
      }
      if (input.method === 'panels.close') {
        const { resourceId } = z.object({ resourceId: z.string() }).strict().parse(input.payload)
        await panels.host.close(input.owner, resourceId); return null
      }
      if (input.method === 'views.open') {
        const { id } = z.object({ id: z.string() }).strict().parse(input.payload)
        return panels.host.openView(input.owner, id)
      }
      if (input.method === 'views.close') {
        const { resourceId } = z.object({ resourceId: z.string() }).strict().parse(input.payload)
        await panels.host.close(input.owner, resourceId); return null
      }
      throw new PluginError('PROTOCOL_ERROR', `Unsupported Desktop resource method ${input.method}`)
    }
  }
  return {
    provider,
    disconnected: async () => { bindings.clear(); await panels.host.dispose() },
    dispose: async () => { bindings.clear(); await panels.dispose() }
  }
}
