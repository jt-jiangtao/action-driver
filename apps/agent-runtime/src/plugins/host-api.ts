import { z } from 'zod'
import { PluginError, type InvocationContext, type Json, type PluginOwner } from '@actiondriver/plugin-contracts'
export interface PluginHostAPIPorts {
  assertInstance(owner: PluginOwner): void
  authority(owner: PluginOwner, callId: string): { context: InvocationContext; signal: AbortSignal }
  storage?: { get(pluginId: string, key: string): Promise<Json>; set(pluginId: string, key: string, value: Json): Promise<void> }
  logging?: { write(entry: PluginOwner & { level: string; message: string; fields: Json }): void }
  sessions?: { getContext(owner: PluginOwner, context: InvocationContext): Promise<Json> }
  artifacts?: { create(owner: PluginOwner, input: Json, context: InvocationContext): Promise<Json>; read(owner: PluginOwner, input: Json, context: InvocationContext): Promise<Json> }
  credentials?: { request(owner: PluginOwner, input: { id: string; purpose: string }, context: InvocationContext): Promise<Json> }
  capabilities?: { invoke(owner: PluginOwner, id: string, input: Json, context: InvocationContext, signal: AbortSignal): Promise<Json> }
  resources?: { request(owner: PluginOwner, method: string, input: Json): Promise<Json> }
}
const keyInput = z.object({ key: z.string().min(1).max(256) }).strict()
const writeInput = keyInput.extend({ value: z.json() })
const invocationInput = z.object({ id: z.string().min(1), input: z.json() }).strict()
const resourceMethods = new Set(['services.start', 'services.stop', 'panels.open', 'panels.close', 'events.subscribe', 'events.unsubscribe'])
function redact(value: Json): Json {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|password|secret|authorization|api.?key/i.test(key) ? '[redacted]' : redact(item)]))
  return value
}
export class PluginHostAPI {
  constructor(private readonly ports: PluginHostAPIPorts) {}
  async request(owner: PluginOwner, method: string, payload: Json, provided?: InvocationContext): Promise<Json> {
    this.ports.assertInstance(owner)
    const authoritative = () => {
      if (!provided?.callId) throw new PluginError('PROTOCOL_ERROR', 'Invocation context is required')
      return this.ports.authority(owner, provided.callId)
    }
    if (method === 'storage.get' && this.ports.storage) return this.ports.storage.get(owner.pluginId, keyInput.parse(payload).key)
    if (method === 'storage.set' && this.ports.storage) {
      const input = writeInput.parse(payload)
      await this.ports.storage.set(owner.pluginId, input.key, input.value); return null
    }
    if (method === 'logging.write' && this.ports.logging) {
      const input = z.object({ level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string().max(8192), fields: z.record(z.string(), z.json()).default({}) }).strict().parse(payload)
      this.ports.logging.write({ ...owner, ...input, fields: redact(input.fields) }); return null
    }
    if (method === 'sessions.getContext' && this.ports.sessions) return this.ports.sessions.getContext(owner, authoritative().context)
    if (method === 'artifacts.create' && this.ports.artifacts) return this.ports.artifacts.create(owner, payload, authoritative().context)
    if (method === 'artifacts.read' && this.ports.artifacts) return this.ports.artifacts.read(owner, payload, authoritative().context)
    if (method === 'credentials.request' && this.ports.credentials) return this.ports.credentials.request(owner, z.object({ id: z.string().min(1), purpose: z.string().min(1) }).strict().parse(payload), authoritative().context)
    if ((method === 'capabilities.invoke' || method === 'commands.execute') && this.ports.capabilities) {
      const input = invocationInput.parse(payload), { context, signal } = authoritative()
      return this.ports.capabilities.invoke(owner, input.id, input.input, context, signal)
    }
    if (resourceMethods.has(method) && this.ports.resources) return this.ports.resources.request(owner, method, payload)
    if (!['storage.get', 'storage.set', 'logging.write', 'sessions.getContext', 'artifacts.create', 'artifacts.read', 'credentials.request', 'capabilities.invoke', 'commands.execute', ...resourceMethods].includes(method)) throw new PluginError('PROTOCOL_ERROR', `Unknown host method ${method}`)
    throw new PluginError('UNAVAILABLE', `Host API ${method} is not configured`)
  }
}
