import { spawn } from 'node:child_process'
import { resolve, relative } from 'node:path'
import { satisfies } from 'semver'
import { PluginError, type InvocationContext, type Json, type PluginManifest, type PluginOwner } from '@actiondriver/plugin-contracts'
import type { ContributionRegistrar, HostInstance, PluginHostFactory } from './ports'
export interface NodePluginHostOptions {
  executable: string; hostEntry: string; packageRoot(manifest: PluginManifest): string; token(): string
  request(owner: PluginOwner, method: string, payload: Json, context?: InvocationContext, registrar?: ContributionRegistrar): Promise<Json>
  stream?(owner: PluginOwner, method: string, payload: Json, context: InvocationContext, signal: AbortSignal): AsyncIterable<Json>
  prepare?(owner: PluginOwner, manifest: PluginManifest, registrar: ContributionRegistrar): Promise<void>
  activationTimeoutMs?: number
  cancellationGraceMs?: number
}
export class NodePluginHostFactory implements PluginHostFactory {
  constructor(private readonly options: NodePluginHostOptions) {}
  async start(owner: PluginOwner, manifest: PluginManifest, registrar: ContributionRegistrar): Promise<HostInstance> {
    await this.options.prepare?.(owner, manifest, registrar)
    const root = this.options.packageRoot(manifest), entry = resolve(root, manifest.entry)
    if (relative(root, entry).startsWith('..')) throw new PluginError('INVALID_MANIFEST', 'Entry escapes package')
    const binding = { ...owner, token: this.options.token(), protocol: 1 }
    const child = spawn(this.options.executable, [this.options.hostEntry], { cwd: root, env: {}, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    // stdout/stderr are diagnostic streams, never the control protocol.
    child.stdout?.resume(); child.stderr?.resume()
    let sequence = 0, live = true
    const exitHandlers = new Set<() => void>()
    const pending = new Map<string, { resolve(value: Json): void; reject(error: Error): void; onEvent?: (event: Json) => void }>()
    const hostRequests = new Map<string, AbortController>()
    const send = (message: object): void => {
      if (!live || !child.connected) throw new PluginError('UNAVAILABLE', owner.pluginId)
      child.send({ ...binding, ...message })
    }
    let ready!: () => void, failed!: (error: Error) => void
    const activation = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject })
    const terminate = (error: Error): void => {
      live = false; failed(error)
      for (const call of pending.values()) call.reject(error)
      pending.clear()
      for (const controller of hostRequests.values()) controller.abort(error)
      hostRequests.clear()
    }
    child.on('error', error => terminate(error))
    child.on('exit', () => { terminate(new PluginError('RESULT_UNKNOWN', `${owner.pluginId}: host exited`)); for (const handler of exitHandlers) handler() })
    child.on('message', async (raw: unknown) => {
      const message = raw as Record<string, unknown>
      if (!message || message.token !== binding.token || message.hostEpoch !== owner.hostEpoch || message.pluginId !== owner.pluginId || message.version !== owner.version || message.protocol !== 1) return
      try {
        if (message.type === 'unregister') registrar.unregister?.(message.contribution as PluginManifest['contributions'][number])
        else if (message.type === 'register') registrar.register(message.contribution as PluginManifest['contributions'][number])
        else if (message.type === 'invocation-event') pending.get(String(message.requestId))?.onEvent?.(message.payload as Json)
        else if (message.type === 'cancel-request') hostRequests.get(String(message.requestId))?.abort()
        else if (message.type === 'ready') {
          if (typeof message.sdk !== 'string' || !satisfies(message.sdk, manifest.sdk)) throw new PluginError('INCOMPATIBLE', manifest.sdk)
          ready()
        } else if (message.type === 'activation-error') failed(new PluginError('UNAVAILABLE', String(message.error)))
        else if (message.type === 'response') {
          const requestId = String(message.requestId), target = pending.get(requestId)
          pending.delete(requestId)
          if (message.error) target?.reject(PluginError.fromDTO(message.error)); else target?.resolve(message.result as Json)
        } else if (message.type === 'request') {
          try {
            if (message.stream) {
              if (!this.options.stream) throw new PluginError('UNAVAILABLE', 'Streaming host API is not configured')
              const controller = new AbortController()
              hostRequests.set(String(message.requestId), controller)
              try {
                for await (const payload of this.options.stream(owner, String(message.method), message.payload as Json, message.context as InvocationContext, controller.signal)) send({ type: 'request-event', requestId: message.requestId, payload })
                send({ type: 'response', requestId: message.requestId, result: null })
              } finally { hostRequests.delete(String(message.requestId)) }
              return
            }
            const result = await this.options.request(owner, String(message.method), message.payload as Json, message.context as InvocationContext | undefined, registrar)
            send({ type: 'response', requestId: message.requestId, result })
          } catch (error) { if (live) send({ type: 'response', requestId: message.requestId, error: { code: error instanceof PluginError ? error.code : (error as { code?: string })?.code ?? 'TOOL_EXECUTION_FAILED', message: error instanceof Error ? error.message : String(error) } }) }
        }
      } catch (error) { failed(error instanceof Error ? error : new Error(String(error))); child.kill() }
    })
    registrar.track({ dispose: async () => { live = false; if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); } })
    const timeout = setTimeout(() => { failed(new PluginError('UNAVAILABLE', 'Activation timeout')); child.kill() }, this.options.activationTimeoutMs ?? 5000)
    try { send({ type: 'initialize', binding, entry }); await activation } catch (error) { child.kill(); throw error } finally { clearTimeout(timeout) }
    return {
      owner,
      onExit: handler => { exitHandlers.add(handler) },
      stop: async reason => {
        if (!live) return
        send({ type: 'stop', reason })
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { child.kill(); resolve() }, 1000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
        })
        live = false
      },
      invoke: async (id, input, context, signal, onEvent) => {
        if (!live) throw new PluginError('UNAVAILABLE', owner.pluginId)
        if (signal.aborted) throw new PluginError('CANCELLED', context.callId)
        const requestId = `${owner.hostEpoch}-${++sequence}`
        let cancellationTimer: ReturnType<typeof setTimeout> | undefined
        const abort = () => {
          if (!live || cancellationTimer) return
          send({ type: 'cancel', requestId })
          cancellationTimer = setTimeout(() => {
            if (!pending.has(requestId)) return
            terminate(new PluginError('RESULT_UNKNOWN', `${owner.pluginId}: cancellation was not acknowledged`))
            child.kill('SIGKILL')
          }, this.options.cancellationGraceMs ?? 1000)
        }
        const timer = setTimeout(abort, Math.max(0, context.deadline - Date.now()))
        signal.addEventListener('abort', abort, { once: true })
        try {
          return await new Promise<Json>((resolve, reject) => { pending.set(requestId, { resolve, reject, ...(onEvent ? { onEvent } : {}) }); send({ stream: Boolean(onEvent), type: 'invoke', requestId, id, input, context }); if (signal.aborted) abort() })
        } finally { clearTimeout(timer); if (cancellationTimer) clearTimeout(cancellationTimer); signal.removeEventListener('abort', abort); pending.delete(requestId) }
      }
    }
  }
}
