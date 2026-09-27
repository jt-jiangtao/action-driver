import { PluginError, type InvocationContext, type Json, type PluginOwner } from '@actiondriver/plugin-contracts'
export interface CapabilityRoutingPorts {
  now(): number
  resolve(id: string): { id: string; owner: PluginOwner } | undefined
  authority(source: PluginOwner, callId: string): { context: InvocationContext; signal: AbortSignal }
  authorize(context: InvocationContext, id: string, target: PluginOwner): Promise<boolean>
  invoke(id: string, input: Json, context: InvocationContext, signal: AbortSignal): Promise<Json>
  maxDepth?: number
}
export class CapabilityRouter {
  constructor(private readonly ports: CapabilityRoutingPorts) {}
  async invoke(source: PluginOwner, id: string, input: Json, callId: string): Promise<Json> {
    const target = this.ports.resolve(id)
    if (!target) throw new PluginError('UNAVAILABLE', id)
    const { context, signal } = this.ports.authority(source, callId)
    if (context.deadline <= this.ports.now()) throw new PluginError('DEADLINE_EXCEEDED', callId)
    if (context.chain.includes(id) || context.chain.length >= (this.ports.maxDepth ?? 8)) throw new PluginError('DEPENDENCY_CYCLE', [...context.chain, id].join(' -> '))
    if (!await this.ports.authorize({ ...context, source }, id, target.owner)) throw new PluginError('AUTHORIZATION_DENIED', `${source.pluginId} -> ${id}`)
    return this.ports.invoke(id, input, { ...context, source, chain: [...context.chain, id] }, signal)
  }
}
