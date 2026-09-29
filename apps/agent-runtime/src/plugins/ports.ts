import type { Contribution, InvocationContext, Json, PluginManifest, PluginOwner } from '@actiondriver/plugin-contracts'
import type { Disposable, StopReason } from '@actiondriver/plugin-sdk'
export interface PluginRepository {
  publish(manifest: PluginManifest): Promise<void>
  list(): Promise<PluginManifest[]>
  remove(id: string, options: { deleteData: boolean }): Promise<void>
}
export interface ContributionRegistrar {
  register(contribution: Contribution): void
  unregister?(contribution: Contribution): void
  track(resource: Disposable): void
}
export interface HostInstance {
  readonly owner: PluginOwner
  onExit?(handler: () => void): void
  stop(reason: StopReason): Promise<void>
  invoke(id: string, input: Json, context: InvocationContext, signal: AbortSignal, onEvent?: (event: Json) => void): Promise<Json>
}
export interface PluginHostFactory {
  start(owner: PluginOwner, manifest: PluginManifest, registrar: ContributionRegistrar): Promise<HostInstance>
}
export interface PluginManagerPorts {
  repository: PluginRepository; factory: PluginHostFactory
  contextKeys?: { evaluate(source?: string): boolean }
  sdk: string; platform: string; epoch(): string; stopTimeoutMs?: number
  withdraw?(owner: PluginOwner, contribution: Contribution): void
  publish?(owner: PluginOwner, contributions: Contribution[]): Disposable[]
}
