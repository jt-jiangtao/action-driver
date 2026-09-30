import { createPluginContext, EventQueue, PluginError } from '@action-driver/plugin-sdk'
import { pathToFileURL } from 'node:url'
let binding, module, context
const events = new Map(), handlers = new Map(), pending = new Map(), controllers = new Map()
let sequence = 0
const errorDTO = error => ({ code: typeof error?.code === 'string' ? error.code : 'TOOL_EXECUTION_FAILED', message: error instanceof Error ? error.message : String(error) })
const send = message => process.send?.({ ...binding, protocol: 1, ...message })
const emit = message => new Promise((resolve, reject) => process.send({ ...binding, protocol: 1, ...message }, error => error ? reject(error) : resolve()))
const request = (method, payload, invocation) => new Promise((resolve, reject) => {
  const requestId = `host-${++sequence}`
  pending.set(requestId, { resolve, reject })
  send({ type: 'request', requestId, method, payload, context: invocation })
})
async function* stream(method, payload, invocation, signal) {
  const requestId = `host-${++sequence}`, queue = new EventQueue()
  pending.set(requestId, { resolve: () => queue.end(), reject: error => queue.fail(error), queue })
  send({ type: 'request', requestId, method, payload, context: invocation, stream: true })
  const abort = () => send({ type: 'cancel-request', requestId })
  if (signal.aborted) abort()
  signal.addEventListener('abort', abort, { once: true })
  try { yield* queue } finally { pending.delete(requestId); signal.removeEventListener('abort', abort) }
}
process.on('message', async message => {
  if (message.type === 'initialize' && !binding) {
    binding = message.binding
    try {
      const register = (contribution, handler) => {
        handlers.set(contribution.id, handler)
        send({ type: 'register', contribution })
        return { dispose() { handlers.delete(contribution.id); send({ type: 'unregister', contribution }) } }
      }
      context = createPluginContext({ pluginId: binding.pluginId, version: binding.version, hostEpoch: binding.hostEpoch }, {
        registrations: { register },
        tools: { register(definition, executor) {
          return register({ kind: 'tool', id: definition.id, modelName: definition.modelName }, async (payload, invocation, signal, progress) => {
            const events = []
            for await (const event of executor.execute(payload.call, signal, payload.executionContext, invocation)) { if (progress) await progress(event); else events.push(event) }
            return events
          })
        } },
        transport: { request, stream, subscribe(resourceId, handler) { events.set(resourceId, handler); return { dispose() { events.delete(resourceId) } } } }
      })
      module = await import(pathToFileURL(message.entry).href)
      if (typeof module.activate !== 'function') throw new Error('Plugin must export activate')
      await module.activate(context)
      send({ type: 'ready', sdk: '1.0.0' })
    } catch (error) { send({ type: 'activation-error', error: String(error) }) }
    return
  }
  if (!binding || message.token !== binding.token || message.hostEpoch !== binding.hostEpoch || message.pluginId !== binding.pluginId || message.version !== binding.version || message.protocol !== 1) return
  if (message.type === 'request-event') { pending.get(message.requestId)?.queue?.push(message.payload) }
  else if (message.type === 'event') { await events.get(message.resourceId)?.(message.payload) }
  else if (message.type === 'response') {
    const target = pending.get(message.requestId)
    pending.delete(message.requestId)
    if (message.error) target?.reject(PluginError.fromDTO(message.error)); else target?.resolve(message.result)
  } else if (message.type === 'cancel') controllers.get(message.requestId)?.abort(new Error('cancelled'))
  else if (message.type === 'invoke') {
    const controller = new AbortController()
    controllers.set(message.requestId, controller)
    try {
      if (!handlers.has(message.id)) throw new Error('UNAVAILABLE')
      if (message.context.deadline <= Date.now()) throw new Error('DEADLINE_EXCEEDED')
      const result = await handlers.get(message.id)(message.input, message.context, controller.signal, message.stream ? event => emit({ type: 'invocation-event', requestId: message.requestId, payload: event }) : undefined)
      send({ type: 'response', requestId: message.requestId, result })
    } catch (error) { send({ type: 'response', requestId: message.requestId, error: errorDTO(error) }) }
    finally { controllers.delete(message.requestId) }
  } else if (message.type === 'stop') {
    try { await module?.deactivate?.(message.reason) } finally {
      try { await context?.subscriptions.dispose() } finally { process.disconnect(); process.exitCode = 0 }
    }
  }
})
process.on('disconnect', () => process.exit(0))
