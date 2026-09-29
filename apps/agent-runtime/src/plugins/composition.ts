import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLUGIN_UI_PROTOCOL_VERSION, PluginError, validateManifest, type Json, type PluginManifest, type PluginUiContributions, type PluginUiMenu, type PluginUiView, type InvocationContext, type PluginOwner, type SkillContribution, type ValidatedPluginCatalog } from '@actiondriver/plugin-contracts'
import { EventQueue, type Disposable, type ToolExecutorEvent } from '@actiondriver/plugin-sdk'
import type { RuntimeToolRegistry } from '../tool-registry'
import { FilesystemPluginRepository, PluginPrivateStorage } from './filesystem-repository'
import { readPluginCatalog } from './catalog-reader'
import { PluginManager } from './manager'
import { NodePluginHostFactory } from './process-host'
import { PluginHostAPI, type PluginHostAPIPorts } from './host-api'
import { CapabilityRouter } from './capability-router'
import { PluginResourceHost } from './resource-host'
import { NodeServiceSupervisor } from './service-supervisor'
import { PluginContextKeys } from './context-keys'
export interface RuntimePluginCompositionOptions {
  retiredPluginIds?: string[]
  node: string; hostEntry: string; packageRoots: string[]; dataRoot: string
  registry: RuntimeToolRegistry; configuration: Record<string, Json>
  toolTimeouts?: Record<string, number>
  now(): number; ids(): string
  apiPorts?: Omit<PluginHostAPIPorts, 'assertInstance' | 'authority' | 'storage' | 'logging' | 'context'>
  contextKeys?: PluginContextKeys
  skills?: { stage(owner: PluginOwner, skill: SkillContribution, packageRoot: string): Promise<Disposable>; publish(owner: PluginOwner, id: string): Disposable }
  desktopResources?: { begin(owner: PluginOwner): Promise<void>; request(owner: PluginOwner, method: string, input: Json): Promise<Json>; end(owner: PluginOwner): Promise<void> }
  /**
   * Resolves the authoritative task context for a Desktop-initiated command. Grants are always
   * recomputed here; caller-supplied grants are never trusted.
   */
  commandAuthority?(request: { taskId?: string }): Promise<{ grants: string[]; taskId: string; sessionId: string }>
  authorizeCapability?(context: InvocationContext, id: string, target: PluginOwner): Promise<boolean>
  hostCapabilities?: Record<string, { plugins: string[]; grants: string[]; start?(owner: PluginOwner): Promise<Disposable>; invoke?(input: Json, context: InvocationContext, signal: AbortSignal): Promise<Json>; stream?(input: Json, context: InvocationContext, signal: AbortSignal): AsyncIterable<Json> }>
  log?(entry: { pluginId: string; version: string; hostEpoch: string; payload: Json }): void
}
export async function createRuntimePluginPlatform(options: RuntimePluginCompositionOptions) {
  const contextKeys = options.contextKeys ?? new PluginContextKeys()
  const roots = new Map<string, string>(), descriptors = new Map<string, { manifest: PluginManifest; catalog: ValidatedPluginCatalog }>()
  const versions = new Map<string, { manifest: PluginManifest; catalog: ValidatedPluginCatalog }>()
  const key = (owner: { pluginId: string; version: string }) => `${owner.pluginId}@${owner.version}`
  const descriptor = (owner: PluginOwner) => {
    const value = versions.get(key(owner))
    if (!value) throw new PluginError('UNAVAILABLE', key(owner))
    return value
  }
  // Advertise the UI protocol so manifests declaring views or menus are accepted here and
  // explicitly rejected by any older host that only speaks protocol 1.
  const host = { sdk: '1.0.0', platform: `${process.platform}-${process.arch}`, uiProtocol: PLUGIN_UI_PROTOCOL_VERSION }
  const persisted = new FilesystemPluginRepository(options.dataRoot, () => { throw new Error('Read-only repository') }, options.ids)
  const suppliedIds = new Set(await Promise.all(options.packageRoots.map(async root => (JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')) as PluginManifest).id)))
  const persistedRoots = (await persisted.list()).filter(manifest => !suppliedIds.has(manifest.id) && !options.retiredPluginIds?.includes(manifest.id)).map(manifest => persisted.packageRoot(validateManifest(manifest, host)))
  const catalogs = await Promise.all([...options.packageRoots, ...persistedRoots].map(async root => {
    const manifest = validateManifest(JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')), host)
    const catalog = await readPluginCatalog(options.node, root, manifest)
    for (const tool of catalog.tools) {
      const timeout = options.toolTimeouts?.[tool.id]
      if (timeout !== undefined) {
        if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600_000) throw new PluginError('INVALID_MANIFEST', 'Invalid host tool timeout')
        tool.timeoutMs = timeout
      }
    }
    return { root, manifest, catalog }
  }))
  for (const { root, manifest, catalog } of catalogs) {
    if (descriptors.has(manifest.id)) throw new PluginError('CONTRIBUTION_CONFLICT', manifest.id)
    roots.set(`${manifest.id}@${manifest.version}`, root)
    descriptors.set(manifest.id, { manifest, catalog })
    versions.set(`${manifest.id}@${manifest.version}`, { manifest, catalog })
  }
  const repository = new FilesystemPluginRepository(options.dataRoot, manifest => {
    const root = roots.get(`${manifest.id}@${manifest.version}`)
    if (!root) throw new PluginError('UNAVAILABLE', manifest.id)
    return root
  }, options.ids)
  const storage = new PluginPrivateStorage(options.dataRoot, options.ids)
  const factory: NodePluginHostFactory = new NodePluginHostFactory({
    executable: options.node, hostEntry: options.hostEntry, packageRoot: manifest => repository.packageRoot(manifest), token: randomUUID,
    prepare: async (owner, manifest, registrar) => {
      contextKeys.begin(owner)
      registrar.track({ dispose: () => contextKeys.end(owner) })
      if (options.skills) for (const skill of descriptor(owner).catalog.skills) registrar.track(await options.skills.stage(owner, skill, repository.packageRoot(manifest)))
      if (manifest.panels?.length) {
        if (!options.desktopResources) throw new PluginError('UNAVAILABLE', 'Desktop panels host is not configured')
        await options.desktopResources.begin(owner)
        registrar.track({ dispose: () => options.desktopResources!.end(owner) })
      }
      for (const id of manifest.requires ?? []) {
        const target = options.hostCapabilities?.[id]
        if (target?.start && target.plugins.includes(owner.pluginId)) registrar.track(await target.start(owner))
      }
    },
    stream: async function* (owner, method, payload, provided, requestSignal) {
      if (method !== 'capabilities.stream') throw new PluginError('PROTOCOL_ERROR', method)
      const input = payload as { id: string; input: Json }
      const { context, signal } = manager.authority(owner, provided.callId)
      const target = options.hostCapabilities?.[input.id]
      if (!target?.stream || !target.plugins.includes(owner.pluginId) || !descriptor(owner).manifest.requires?.includes(input.id)) throw new PluginError('UNAVAILABLE', input.id)
      if (!target.grants.some(grant => context.grants?.includes(grant))) throw new PluginError('AUTHORIZATION_DENIED', input.id)
      yield* target.stream(input.input, context, AbortSignal.any([signal, requestSignal]))
    },
    request: (owner, method, payload, context, registrar) => {
      manager.assertInstance(owner)
      if (manager.status(owner.pluginId) === 'stopping' && ['services.start', 'panels.open', 'events.subscribe'].includes(method)) throw new PluginError('UNAVAILABLE', 'Plugin is stopping')
      if (method === 'services.start' && registrar) return resourceHost.start(owner, payload, registrar)
      if (method === 'services.stop') return resourceHost.stop(owner, payload)
      return api.request(owner, method, payload, context)
    }
  })
  const registered = new Map<string, Disposable>()
  // Installed packages are listed as dormant interface contributions until the user disables them.
  const withdrawn = new Set<string>()
  // Desktop bindings opened lazily for the first view of an instance.
  const viewBindings = new Set<string>()
  const registrationKey = (owner: PluginOwner, id: string) => `${key(owner)}@${owner.hostEpoch}:${id}`
  const manager: PluginManager = new PluginManager({ repository, factory, ...host, epoch: options.ids, contextKeys,
    withdraw: (owner, contribution) => {
      const key = registrationKey(owner, contribution.id)
      void registered.get(key)?.dispose(); registered.delete(key)
    },
    publish: (owner, contributions) => {
      const registrations: Disposable[] = []
      try {
        for (const contribution of contributions) {
          if (contribution.kind === 'skill') {
            if (!options.skills) throw new PluginError('UNAVAILABLE', 'Skill instruction host is not configured')
            const registration = options.skills.publish(owner, contribution.id), key = registrationKey(owner, contribution.id)
            registered.set(key, registration)
            registrations.push({ dispose() { if (registered.get(key) === registration) registered.delete(key); return registration.dispose() } })
            continue
          }
          if (contribution.kind !== 'tool') continue
          const definition = descriptor(owner).catalog.tools.find(value => value.id === contribution.id)
          if (!definition) throw new PluginError('INVALID_MANIFEST', `Tool schema missing for ${contribution.id}`)
          const registration = options.registry.register(definition, {
            async *execute(call, signal, executionContext) {
              if (!manager.isContributionAvailable('tool', definition.id, owner)) throw new PluginError('UNAVAILABLE', `${definition.id}: context condition is false`)
              const remote = resourceHost.resolveTool(owner, definition.id)
              if (remote) {
                yield { kind: 'result', output: await manager.runPinned(owner, { callId: call.callId, requestId: options.ids(), deadline: options.now() + definition.timeoutMs, source: { kind: 'runtime' }, chain: [], ...(executionContext ? { taskId: executionContext.taskId, sessionId: executionContext.sessionId } : {}) }, signal ?? new AbortController().signal, activeSignal => remote.service.call(remote.name, call.arguments, activeSignal)) }
                return
              }
              const progress = new EventQueue<Json>()
              const completed = manager.invoke(definition.id, { call: { ...call, modelName: definition.modelName }, ...(executionContext ? { executionContext } : {}) } as unknown as Json, {
                callId: call.callId, requestId: options.ids(), deadline: options.now() + definition.timeoutMs,
                source: { kind: 'runtime' }, chain: [],
                ...(executionContext ? { taskId: executionContext.taskId, sessionId: executionContext.sessionId, workspaceHandle: executionContext.sessionId, ...(executionContext.grants ? { grants: executionContext.grants } : {}) } : {})
              }, signal ?? new AbortController().signal, event => progress.push(event)).then(() => progress.end(), error => progress.fail(error instanceof Error ? error : new Error(String(error))))
              try { for await (const event of progress) yield event as ToolExecutorEvent } finally { await completed }
            }
          }, owner, () => manager.isContributionAvailable('tool', definition.id, owner))
          const key = registrationKey(owner, definition.id)
          registered.set(key, registration)
          registrations.push({ dispose() { if (registered.get(key) === registration) registered.delete(key); return registration.dispose() } })
        }
        return registrations
      } catch (error) { for (const registration of registrations) void registration.dispose(); throw error }
    }
  })
  const resourceHost: PluginResourceHost = new PluginResourceHost({
    supervisor: new NodeServiceSupervisor({ node: options.node, platform: host.platform, log: (owner, stream, text) => options.log?.({ ...owner, payload: { stream, message: text } }) }),
    ids: options.ids,
    manifest: owner => descriptor(owner).manifest,
    catalog: owner => descriptor(owner).catalog,
    packageRoot: owner => repository.packageRoot(descriptor(owner).manifest),
    track: (owner, resource) => manager.track(owner, resource), failed: owner => manager.fail(owner)
  })
  const router = new CapabilityRouter({
    now: options.now,
    resolve: id => {
      const target = manager.contributions().find(value => ['capability', 'command'].includes(value.contribution.kind) && value.contribution.id === id)
      return target ? { id, owner: target.owner } : undefined
    },
    authority: (owner, callId) => manager.authority(owner, callId),
    authorize: async (context, id, target) => {
      if (!('pluginId' in context.source)) return false
      const source = versions.get(`${context.source.pluginId}@${context.source.version}`)?.manifest
      if (!source?.requires?.includes(id) || !source.dependencies.some(dependency => dependency.id === target.pluginId)) return false
      return await options.authorizeCapability?.(context, id, target) ?? false
    },
    invoke: (id, input, context, signal) => manager.invoke(id, input, context, signal)
  })
  const api: PluginHostAPI = new PluginHostAPI({ ...options.apiPorts,
    context: contextKeys,
    ...(options.desktopResources ? { resources: { request: options.desktopResources.request } } : {}),
    capabilities: { invoke: async (owner, id, input, context, signal) => {
      const target = options.hostCapabilities?.[id]
      if (!target) return router.invoke(owner, id, input, context.callId)
      if (!target?.invoke || !target.plugins.includes(owner.pluginId) || !descriptor(owner).manifest.requires?.includes(id)) throw new PluginError('UNAVAILABLE', id)
      if (!target.grants.some(grant => context.grants?.includes(grant))) throw new PluginError('AUTHORIZATION_DENIED', id)
      return target.invoke(input, context, signal)
    } },
    assertInstance: owner => manager.assertInstance(owner), authority: (owner, callId) => manager.authority(owner, callId), storage,
    ...(options.log ? { logging: { write: entry => options.log!({ pluginId: entry.pluginId, version: entry.version, hostEpoch: entry.hostEpoch, payload: { level: entry.level, message: entry.message, fields: entry.fields } }) } } : {})
  })
  await Promise.all([...descriptors.values()].map(async ({ manifest }) => {
    await manager.install(manifest)
    if (options.configuration[manifest.id] !== undefined) await storage.set(manifest.id, 'configuration', options.configuration[manifest.id]!)
  }))
  return {
    manager,
    contextKeys,
    install: async (root: string) => {
      const manifest = validateManifest(JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')), host)
      if (descriptors.has(manifest.id)) throw new PluginError('CONTRIBUTION_CONFLICT', manifest.id)
      const catalog = await readPluginCatalog(options.node, root, manifest)
      roots.set(`${manifest.id}@${manifest.version}`, root)
      versions.set(`${manifest.id}@${manifest.version}`, { manifest, catalog })
      await manager.install(manifest)
      descriptors.set(manifest.id, { manifest, catalog })
    },
    upgrade: async (root: string, migration?: Parameters<PluginManager['upgrade']>[2]) => {
      const manifest = validateManifest(JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')), host)
      if (descriptors.get(manifest.id)?.manifest.version === manifest.version) throw new PluginError('CONTRIBUTION_CONFLICT', 'Upgrade requires a new package version')
      const catalog = await readPluginCatalog(options.node, root, manifest)
      roots.set(`${manifest.id}@${manifest.version}`, root)
      versions.set(`${manifest.id}@${manifest.version}`, { manifest, catalog })
      await manager.upgrade(manifest.id, manifest, migration)
      descriptors.set(manifest.id, { manifest, catalog })
    },
    uninstall: async (id: string, remove: { deleteData: boolean }) => {
      await manager.uninstall(id, remove)
      descriptors.delete(id)
      for (const version of [...versions.keys()]) if (version.startsWith(`${id}@`)) { versions.delete(version); roots.delete(version) }
    },
    panelMessage: async (owner: PluginOwner, panelId: string, type: string, payload: Json): Promise<Json> => {
      manager.assertInstance(owner)
      const panel = descriptor(owner).manifest.panels?.find(value => value.id === panelId)
      const contribution = manager.contributions().find(value => value.contribution.kind === 'panel' && value.contribution.id === panelId && value.owner.pluginId === owner.pluginId && value.owner.hostEpoch === owner.hostEpoch && value.owner.version === owner.version)
      const schema = panel?.messages[type]
      if (!contribution || !schema || !z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(payload).success) throw new PluginError('PROTOCOL_ERROR', 'Panel message is not declared')
      // A view event has no task or input-control grants. Capability APIs must authorize separately.
      return manager.invoke(panelId, { type, payload }, { requestId: options.ids(), callId: options.ids(), deadline: options.now() + 5000, source: owner, chain: [], grants: [] }, new AbortController().signal)
    },
    catalogs: () => structuredClone([...descriptors.values()]),
    /**
     * Interface contributions of every installed package that is not disabled, with the same
     * authoritative availability the direct call path uses. Declared-but-dormant entries stay
     * visible so the desktop can activate their owner on demand.
     */
    uiContributions: (): PluginUiContributions => {
      const views: PluginUiView[] = []
      const menus: PluginUiMenu[] = []
      const published = manager.contributions()
      for (const { manifest, catalog } of descriptors.values()) {
        if (withdrawn.has(manifest.id) || manager.status(manifest.id) === 'stopping') continue
        const owner = published.find(value => value.owner.pluginId === manifest.id)?.owner
        for (const definition of catalog.views) views.push({ pluginId: manifest.id, version: manifest.version, definition: structuredClone(definition), available: manager.isContributionAvailable('view', definition.id, owner) })
        for (const definition of catalog.menus) menus.push({ pluginId: manifest.id, version: manifest.version, definition: structuredClone(definition), available: manager.isContributionAvailable('menu', definition.id, owner) })
      }
      return { views, menus }
    },
    /** Activates the owner of a declarative surface, then hands the container to the desktop host. */
    openView: async (pluginId: string, viewId: string): Promise<{ resourceId: string }> => {
      const descriptor = [...descriptors.values()].find(value => value.manifest.id === pluginId)
      if (!descriptor?.catalog.views.some(value => value.id === viewId)) throw new PluginError('INVALID_MANIFEST', `Undeclared view ${viewId}`)
      if (manager.status(pluginId) !== 'ready') { withdrawn.delete(pluginId); await manager.enable(pluginId); await manager.activate(pluginId) }
      const owner = manager.contributions().find(value => value.contribution.kind === 'view' && value.contribution.id === viewId && value.owner.pluginId === pluginId)?.owner
      if (!owner) throw new PluginError('UNAVAILABLE', `${viewId}: view is not published`)
      if (!manager.isContributionAvailable('view', viewId, owner)) throw new PluginError('UNAVAILABLE', `${viewId}: context condition is false`)
      if (!options.desktopResources) throw new PluginError('UNAVAILABLE', 'Desktop view host is not configured')
      // The desktop binding is established lazily, so a host without a container for this view
      // keeps the plugin active until someone actually opens it.
      const binding = `${owner.pluginId}@${owner.hostEpoch}`
      if (!viewBindings.has(binding)) {
        await options.desktopResources.begin(owner)
        viewBindings.add(binding)
        manager.track(owner, { dispose: () => { viewBindings.delete(binding); return options.desktopResources!.end(owner) } })
      }
      return await options.desktopResources.request(owner, 'views.open', { id: viewId }) as { resourceId: string }
    },
    /**
     * Executes a declared command for a user-initiated entry point. The owner must be published,
     * the shared condition is re-evaluated here, and grants come from the authoritative task.
     */
    executeCommand: async (pluginId: string, commandId: string, input: Json, request: { taskId?: string }): Promise<Json> => {
      const descriptor = [...descriptors.values()].find(value => value.manifest.id === pluginId)
      if (!descriptor?.manifest.contributions.some(item => item.kind === 'command' && item.id === commandId)) throw new PluginError('INVALID_MANIFEST', `Undeclared command ${commandId}`)
      const owner = manager.contributions().find(value => value.contribution.kind === 'command' && value.contribution.id === commandId && value.owner.pluginId === pluginId)?.owner
      if (!owner) throw new PluginError('UNAVAILABLE', `${commandId}: command is not published`)
      if (!manager.isContributionAvailable('command', commandId, owner)) throw new PluginError('UNAVAILABLE', `${commandId}: context condition is false`)
      const authority = options.commandAuthority ? await options.commandAuthority(request) : { grants: [], taskId: request.taskId ?? '', sessionId: '' }
      return manager.invoke(commandId, input, {
        requestId: options.ids(), callId: options.ids(), deadline: options.now() + 30_000, source: { kind: 'runtime' }, chain: [], grants: authority.grants,
        ...(authority.taskId ? { taskId: authority.taskId } : {}), ...(authority.sessionId ? { sessionId: authority.sessionId } : {})
      }, new AbortController().signal)
    },
    enable: async (id: string) => { withdrawn.delete(id); await manager.enable(id); await manager.activate(id) },
    disable: async (id: string) => { withdrawn.add(id); await manager.disable(id) },
    dispose: async () => { await Promise.all([...descriptors.keys()].map(id => manager.disable(id))) }
  }
}
