import { evaluateContextCondition, isContextKey, parseContextCondition, PluginError, type ContextCondition, type ContextSnapshot, type ContextValue, type PluginOwner } from '@actiondriver/plugin-contracts'
import type { Disposable } from '@actiondriver/plugin-sdk'

export interface VersionedContextSnapshot { readonly version: number; readonly values: ContextSnapshot }

function sameOwner(left: PluginOwner | undefined, right: PluginOwner): boolean {
  return left?.pluginId === right.pluginId && left.version === right.version && left.hostEpoch === right.hostEpoch
}

function assertValue(value: ContextValue): void {
  if (!['boolean', 'string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new PluginError('PROTOCOL_ERROR', 'Context value must be a finite scalar')
  }
}

export class PluginContextKeys {
  private version = 0
  private values: Record<string, ContextValue> = {}
  private readonly owners = new Map<string, PluginOwner>()
  private readonly ownedKeys = new Map<string, Set<string>>()
  private readonly listeners = new Set<(snapshot: VersionedContextSnapshot) => void>()
  private readonly conditions = new Map<string, ContextCondition>()

  snapshot(): VersionedContextSnapshot {
    return Object.freeze({ version: this.version, values: Object.freeze({ ...this.values }) })
  }

  evaluate(source?: string): boolean {
    if (source === undefined) return true
    let condition = this.conditions.get(source)
    if (!condition) { condition = parseContextCondition(source); this.conditions.set(source, condition) }
    return evaluateContextCondition(condition, this.snapshot().values)
  }

  subscribe(listener: (snapshot: VersionedContextSnapshot) => void): Disposable {
    this.listeners.add(listener)
    return { dispose: () => { this.listeners.delete(listener) } }
  }

  setHost(key: string, value: ContextValue): void {
    if (!isContextKey(key) || !key.startsWith('host.')) throw new PluginError('PROTOCOL_ERROR', `Invalid host context key ${key}`)
    assertValue(value)
    this.change(key, value)
  }

  begin(owner: PluginOwner): void {
    const previous = this.owners.get(owner.pluginId)
    if (previous && !sameOwner(previous, owner)) this.clearOwned(owner.pluginId)
    this.owners.set(owner.pluginId, { ...owner })
    if (!this.ownedKeys.has(owner.pluginId)) this.ownedKeys.set(owner.pluginId, new Set())
  }

  setPlugin(owner: PluginOwner, key: string, value: ContextValue): void {
    this.assertOwner(owner, key)
    assertValue(value)
    this.ownedKeys.get(owner.pluginId)!.add(key)
    this.change(key, value)
  }

  removePlugin(owner: PluginOwner, key: string): void {
    this.assertOwner(owner, key)
    this.ownedKeys.get(owner.pluginId)!.delete(key)
    if (!Object.hasOwn(this.values, key)) return
    const next = { ...this.values }
    delete next[key]
    this.publish(next)
  }

  end(owner: PluginOwner): void {
    if (!sameOwner(this.owners.get(owner.pluginId), owner)) return
    this.owners.delete(owner.pluginId)
    this.clearOwned(owner.pluginId)
  }

  private assertOwner(owner: PluginOwner, key: string): void {
    if (!sameOwner(this.owners.get(owner.pluginId), owner)) throw new PluginError('STALE_INSTANCE', owner.pluginId)
    const prefix = `plugin.${owner.pluginId}.`
    if (!isContextKey(key) || !key.startsWith(prefix) || !/^[a-z][a-z0-9-]*$/.test(key.slice(prefix.length))) throw new PluginError('PROTOCOL_ERROR', `Invalid plugin context key ${key}`)
  }

  private clearOwned(pluginId: string): void {
    const owned = this.ownedKeys.get(pluginId)
    this.ownedKeys.delete(pluginId)
    if (!owned?.size) return
    const next = { ...this.values }
    for (const key of owned) delete next[key]
    this.publish(next)
  }

  private change(key: string, value: ContextValue): void {
    if (Object.hasOwn(this.values, key) && this.values[key] === value) return
    this.publish({ ...this.values, [key]: value })
  }

  private publish(values: Record<string, ContextValue>): void {
    this.values = values
    this.version++
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
