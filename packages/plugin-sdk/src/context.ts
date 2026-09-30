import type { InvocationContext, Json, PluginOwner } from '@action-driver/plugin-contracts'
import type { Disposable, DisposableStore, HostTransport, PluginContext, RegistrationPort, ToolRegistrationPort, ResourceHandle } from './index.js'
export class ResourceLedger implements DisposableStore, Disposable {
  private readonly resources: Disposable[] = []
  private closed = false
  add<T extends Disposable>(resource: T): T {
    if (this.closed) throw new Error('Resource ledger is closed')
    this.resources.push(resource); return resource
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const results = await Promise.allSettled(this.resources.splice(0).reverse().map(resource => Promise.resolve().then(() => resource.dispose())))
    const errors = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected')
    if (errors.length) throw new AggregateError(errors.map(value => value.reason), 'Resource cleanup failed')
  }
}
export function createPluginContext(owner: PluginOwner, ports: { transport: HostTransport; registrations: RegistrationPort; tools: ToolRegistrationPort }): PluginContext & { subscriptions: ResourceLedger } {
  const subscriptions = new ResourceLedger()
  const request = (method: string, payload: Json, context?: InvocationContext, signal?: AbortSignal) => ports.transport.request(method, payload, context, signal)
  const handle = (value: Json): ResourceHandle => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.resourceId !== 'string') throw new Error('Invalid resource handle')
    return { resourceId: value.resourceId }
  }
  const lease = async (method: string, release: string, id: string): Promise<ResourceHandle> => {
    const result = handle(await request(method, { id }))
    subscriptions.add({ async dispose() { await request(release, { resourceId: result.resourceId }) } })
    return result
  }
  return {
    plugin: Object.freeze({ ...owner }), subscriptions,
    api: {
      context: {
        set: async (key, value) => { await request('context.set', { key, value }) },
        remove: async key => { await request('context.remove', { key }) }
      },
      tools: { register: (definition, executor) => subscriptions.add(ports.tools.register(definition, executor)) },
      contributions: { register: (contribution, handler) => subscriptions.add(ports.registrations.register(contribution, handler)) },
      commands: {
        register: (id, handler) => subscriptions.add(ports.registrations.register({ kind: 'command', id }, handler)),
        execute: (id, input, context, signal) => request('commands.execute', { id, input }, context, signal)
      },
      skills: { register: skill => subscriptions.add(ports.registrations.register({ kind: 'skill', id: skill.id })) },
      services: { start: id => lease('services.start', 'services.stop', id), stop: async value => { await request('services.stop', { resourceId: value.resourceId }) } },
      panels: { register: (id, handler) => subscriptions.add(ports.registrations.register({ kind: 'panel', id }, handler)), open: id => lease('panels.open', 'panels.close', id), close: async value => { await request('panels.close', { resourceId: value.resourceId }) } },
      views: { register: (id, handler) => subscriptions.add(ports.registrations.register({ kind: 'view', id }, handler)) },
      menus: { register: id => subscriptions.add(ports.registrations.register({ kind: 'menu', id })) },
      sessions: { getContext: context => request('sessions.getContext', {}, context) },
      artifacts: { create: (input, context) => request('artifacts.create', input, context), read: (id, context) => request('artifacts.read', { id }, context) },
      credentials: { request: (input, context) => request('credentials.request', input, context) },
      events: { subscribe: async (type, handler) => {
        if (!ports.transport.subscribe) throw new Error('Event transport is unavailable')
        const resource = handle(await request('events.subscribe', { type }))
        const subscription = ports.transport.subscribe(resource.resourceId, handler)
        return subscriptions.add({ async dispose() { await subscription?.dispose(); await request('events.unsubscribe', { resourceId: resource.resourceId }) } })
      } },
      capabilities: { async *stream(id, input, context, signal) {
        if (!ports.transport.stream) throw new Error('Streaming transport is unavailable')
        yield* ports.transport.stream('capabilities.stream', { id, input }, context, signal)
      }, register: (id, handler) => subscriptions.add(ports.registrations.register({ kind: 'capability', id }, handler)), invoke: (id, input, context, signal) => request('capabilities.invoke', { id, input }, context, signal) },
      storage: { get: key => request('storage.get', { key }), set: async (key, value) => { await request('storage.set', { key, value }) } },
      logging: { write: async (level, message, fields = {}) => { await request('logging.write', { level, message, fields }) } }
    }
  }
}
