import { PluginError, resolveDependencies, validateManifest, type Contribution, type PluginManifest, type PluginOwner, type InvocationContext, type Json } from '@actiondriver/plugin-contracts'
import type { Disposable } from '@actiondriver/plugin-sdk'
import type { HostInstance, PluginManagerPorts } from './ports'

type State = 'disabled' | 'dormant' | 'activating' | 'ready' | 'stopping' | 'failed'
type Record = { manifest: PluginManifest; state: State; owner?: PluginOwner; host?: HostInstance; resources: Disposable[]; activation?: Promise<void>; cleanup?: Promise<void>; stopping?: Promise<void>; calls: Set<Promise<Json>>; cancellations: Set<AbortController>; unknown: Set<(error: Error) => void>; invocations: Map<string, { context: InvocationContext; signal: AbortSignal }> }
export class PluginManager {
  private readonly records = new Map<string, Record>()
  private readonly published = new Map<string, { contribution: Contribution; owner: PluginOwner }>()
  constructor(private readonly ports: PluginManagerPorts) {}
  async install(value: unknown): Promise<void> {
    const manifest = validateManifest(value, this.ports)
    if (this.records.has(manifest.id)) throw new PluginError('CONTRIBUTION_CONFLICT', `Already installed ${manifest.id}; use upgrade`)
    await this.ports.repository.publish(manifest)
    this.records.set(manifest.id, { manifest, state: 'disabled', resources: [], calls: new Set(), cancellations: new Set(), unknown: new Set(), invocations: new Map() })
  }
  status(id: string): State { return this.record(id).state }
  async enable(id: string): Promise<void> {
    const record = this.record(id)
    if (record.cleanup) await record.cleanup
    resolveDependencies([...this.records.values()].map(value => value.manifest))
    if (record.state === 'disabled' || record.state === 'failed') record.state = 'dormant'
  }
  activate(id: string): Promise<void> {
    const record = this.record(id)
    if (record.activation) return record.activation
    if (record.state === 'ready') return Promise.resolve()
    if (record.state !== 'dormant') return Promise.reject(new PluginError('UNAVAILABLE', `${id}: ${record.state}`))
    record.state = 'activating'
    const owner: PluginOwner = { pluginId: id, version: record.manifest.version, hostEpoch: this.ports.epoch() }
    record.owner = owner
    record.activation = this.start(record, owner).finally(() => { delete record.activation })
    return record.activation
  }
  private async start(record: Record, owner: PluginOwner): Promise<void> {
    const staged: Contribution[] = []
    try {
      const host = await this.ports.factory.start(owner, record.manifest, {
        register: contribution => {
          this.assertInstance(owner)
          if (!['activating', 'ready'].includes(record.state)) throw new PluginError('UNAVAILABLE', 'Plugin is stopping')
          if (!record.manifest.contributions.some(item => item.kind === contribution.kind && item.id === contribution.id && item.modelName === contribution.modelName)) throw new PluginError('PROTOCOL_ERROR', `Undeclared contribution ${contribution.id}`)
          if (staged.some(item => this.key(item) === this.key(contribution))) throw new PluginError('CONTRIBUTION_CONFLICT', contribution.id)
          if (record.state === 'ready') {
            const conflict = [...this.published.values()].find(value => this.key(value.contribution) === this.key(contribution) || (contribution.modelName && contribution.modelName === value.contribution.modelName))
            if (conflict) throw new PluginError('CONTRIBUTION_CONFLICT', contribution.id)
            record.resources.push(...(this.ports.publish?.(owner, [contribution]) ?? []))
            this.published.set(this.key(contribution), { contribution, owner })
          } else staged.push(contribution)
        },
        unregister: contribution => {
          if (record.owner?.hostEpoch !== owner.hostEpoch || !['activating', 'ready', 'stopping'].includes(record.state)) return
          const index = staged.findIndex(value => this.key(value) === this.key(contribution))
          if (index >= 0) staged.splice(index, 1)
          const existing = this.published.get(this.key(contribution))
          if (existing?.owner.hostEpoch === owner.hostEpoch) { this.ports.withdraw?.(owner, existing.contribution); this.published.delete(this.key(contribution)) }
        },
        track: resource => { this.assertInstance(owner); if (!['activating', 'ready'].includes(record.state)) throw new PluginError('UNAVAILABLE', 'Plugin is stopping'); record.resources.push(resource) }
      })
      record.host = host
      host.onExit?.(() => {
        if (record.owner?.hostEpoch !== owner.hostEpoch || record.state !== 'ready') return
        record.state = 'failed'
        for (const controller of record.cancellations) controller.abort(new PluginError('RESULT_UNKNOWN', 'Host exited'))
        for (const reject of record.unknown) reject(new PluginError('RESULT_UNKNOWN', `${owner.pluginId}: host exited`))
        void this.cleanup(record, 'crash').catch(() => { record.state = 'failed' })
      })
      this.assertInstance(owner)
      for (const item of staged) {
        const conflict = [...this.published.values()].find(value => this.key(value.contribution) === this.key(item) || (item.modelName && item.modelName === value.contribution.modelName))
        if (conflict) throw new PluginError('CONTRIBUTION_CONFLICT', `${item.id}: ${conflict.owner.pluginId}@${conflict.owner.version} conflicts with ${owner.pluginId}@${owner.version}`)
      }
      record.resources.push(...(this.ports.publish?.(owner, staged) ?? []))
      for (const item of staged) this.published.set(this.key(item), { contribution: item, owner })
      record.state = 'ready'
    } catch (error) {
      record.state = 'failed'
      await this.cleanup(record, 'crash')
      throw error
    }
  }
  contributions(): { contribution: Contribution; owner: PluginOwner }[] { return structuredClone([...this.published.values()]) }
  assertInstance(owner: PluginOwner): void {
    const record = this.records.get(owner.pluginId)
    if (!record?.owner || record.owner.hostEpoch !== owner.hostEpoch || record.owner.version !== owner.version || !['activating', 'ready', 'stopping'].includes(record.state)) throw new PluginError('STALE_INSTANCE', `${owner.pluginId}@${owner.hostEpoch}`)
  }
  disable(id: string): Promise<void> {
    const record = this.record(id)
    if (record.stopping) return record.stopping
    record.stopping = this.stop(record).finally(() => { delete record.stopping })
    return record.stopping
  }
  private async stop(record: Record): Promise<void> {
    const id = record.manifest.id
    if (record.cleanup) await record.cleanup
    if (record.activation) await record.activation.catch(() => {})
    record.state = 'stopping'
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled([...record.calls]),
      new Promise<void>(resolve => { timer = setTimeout(() => {
        for (const controller of record.cancellations) controller.abort(new PluginError('CANCELLED', id))
        for (const reject of record.unknown) reject(new PluginError('RESULT_UNKNOWN', `${id}: stop deadline exceeded`))
        resolve()
      }, this.ports.stopTimeoutMs ?? 5000) })
    ])
    if (timer) clearTimeout(timer)
    await this.cleanup(record, 'disabled')
    record.state = 'disabled'
  }
  async invoke(id: string, input: Json, context: InvocationContext, signal: AbortSignal, onEvent?: (event: Json) => void): Promise<Json> {
    context = { ...context, chain: context.chain.at(-1) === id ? context.chain : [...context.chain, id] }
    const contribution = [...this.published.values()].find(value => value.contribution.id === id)
    if (!contribution) throw new PluginError('UNAVAILABLE', id)
    const record = this.record(contribution.owner.pluginId)
    if (!record.host) throw new PluginError('UNAVAILABLE', id)
    const host = record.host
    return this.runPinned(contribution.owner, context, signal, activeSignal => host.invoke(id, input, context, activeSignal, onEvent))
  }
  async runPinned(owner: PluginOwner, context: InvocationContext, signal: AbortSignal, execute: (signal: AbortSignal) => Promise<Json>): Promise<Json> {
    const record = this.record(owner.pluginId)
    if (record.state !== 'ready') throw new PluginError('UNAVAILABLE', owner.pluginId)
    this.assertInstance(owner)
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    if (signal.aborted) abort()
    signal.addEventListener('abort', abort, { once: true })
    if (record.invocations.has(context.callId)) throw new PluginError('PROTOCOL_ERROR', 'Duplicate active callId')
    record.invocations.set(context.callId, { context: structuredClone(context), signal: controller.signal })
    record.cancellations.add(controller)
    let rejectUnknown!: (error: Error) => void
    const unknown = new Promise<Json>((_resolve, reject) => { rejectUnknown = reject })
    record.unknown.add(rejectUnknown)
    let execution: Promise<Json>
    try { execution = execute(controller.signal) } catch (error) { execution = Promise.reject(error) }
    const call = Promise.race([execution, unknown])
    record.calls.add(call)
    try { return await call } finally {
      record.calls.delete(call); record.cancellations.delete(controller); record.unknown.delete(rejectUnknown); record.invocations.delete(context.callId)
      signal.removeEventListener('abort', abort)
    }
  }
  authority(owner: PluginOwner, callId: string): { context: InvocationContext; signal: AbortSignal } {
    this.assertInstance(owner)
    const invocation = this.record(owner.pluginId).invocations.get(callId)
    if (!invocation) throw new PluginError('PROTOCOL_ERROR', `No active invocation ${callId}`)
    return { context: structuredClone(invocation.context), signal: invocation.signal }
  }
  track(owner: PluginOwner, resource: Disposable): void {
    this.assertInstance(owner); const record = this.record(owner.pluginId)
    if (!['activating', 'ready'].includes(record.state)) throw new PluginError('UNAVAILABLE', 'Plugin is stopping')
    record.resources.push(resource)
  }
  async fail(owner: PluginOwner): Promise<void> {
    this.assertInstance(owner)
    const record = this.record(owner.pluginId)
    record.state = 'failed'
    for (const controller of record.cancellations) controller.abort(new PluginError('RESULT_UNKNOWN', 'Service failed'))
    for (const reject of record.unknown) reject(new PluginError('RESULT_UNKNOWN', `${owner.pluginId}: service failed`))
    await this.cleanup(record, 'crash')
  }
  async upgrade(id: string, value: unknown, migration?: { irreversible: boolean; backup?: () => Promise<void>; migrate?: () => Promise<void>; restore?: () => Promise<void> }): Promise<void> {
    const next = validateManifest(value, this.ports), record = this.record(id)
    if (next.id !== id) throw new PluginError('INVALID_MANIFEST', 'Upgrade identity mismatch')
    if (migration?.irreversible && (!migration.backup || !migration.restore)) throw new PluginError('MIGRATION_UNSAFE', id)
    const previous = record.manifest
    await this.disable(id)
    try {
      await migration?.backup?.(); await migration?.migrate?.()
      await this.ports.repository.publish(next)
      record.manifest = next
      await this.enable(id); await this.activate(id)
    } catch (error) {
      await migration?.restore?.()
      record.manifest = previous
      await this.ports.repository.publish(previous)
      record.state = 'disabled'
      throw error
    }
  }
  async uninstall(id: string, options: { deleteData: boolean }): Promise<void> {
    await this.disable(id)
    await this.ports.repository.remove(id, options)
    this.records.delete(id)
  }
  private cleanup(record: Record, reason: 'disabled' | 'crash'): Promise<void> {
    if (record.cleanup) return record.cleanup
    const owner = record.owner, host = record.host
    const resources = record.resources.splice(0).reverse()
    for (const [key, value] of this.published) if (value.owner.pluginId === owner?.pluginId && value.owner.hostEpoch === owner.hostEpoch) this.published.delete(key)
    record.cleanup = (async () => {
      const failures: unknown[] = []
      // Give deactivate and the SDK ledger a bounded graceful stop before the process fallback.
      try { await host?.stop(reason) } catch (error) { failures.push(error) }
      const results = await Promise.allSettled(resources.map(resource => Promise.resolve().then(() => resource.dispose())))
      failures.push(...results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason))
      if (record.owner?.hostEpoch === owner?.hostEpoch) { delete record.host; delete record.owner }
      if (failures.length) throw new AggregateError(failures, `Cleanup failed for ${record.manifest.id}`)
    })().finally(() => { delete record.cleanup })
    return record.cleanup
  }
  private record(id: string): Record {
    const record = this.records.get(id)
    if (!record) throw new PluginError('UNAVAILABLE', id)
    return record
  }
  private key(item: Contribution): string { return `${item.kind}:${item.id}` }
}
