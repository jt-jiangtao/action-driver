import type { Server } from 'node:http'
import {
  LOCAL_CAPABILITY_PATH, LOCAL_CAPABILITY_PROTOCOL, localCapabilityFrame,
  type LocalCapabilityFrame, type LocalCapabilityProvider
} from '@actiondriver/runtime-contracts'
import { WebSocket, WebSocketServer } from 'ws'
import type { RuntimeSkillRegistry } from '../skill-registry'
import type { SkillProviderResult } from '../ports'
import type { ImageAssetRef } from '@actiondriver/contracts'
import type { VolatileComputerImages } from '../computer-use/volatile-images'

type Pending = { providerId: string; resolve(value: SkillProviderResult): void; reject(error: Error): void; cleanup(): void }

export function attachLocalCapabilityService(
  server: Server,
  options: { tokenMatches(token: string): boolean; registry: RuntimeSkillRegistry; images?: VolatileComputerImages }
): { close(): Promise<void> } {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 })
  let active: WebSocket | null = null
  const pending = new Map<string, Pending>()
  const seen = new Set<string>()
  const completedMedia = new Map<string, ImageAssetRef>()
  let registered: LocalCapabilityProvider[] = []

  const unavailable = () => new Error('CAPABILITY_UNAVAILABLE: local provider disconnected')
  const clearProviders = () => {
    for (const provider of registered) options.registry.unregister(provider.providerId)
    registered = []
  }
  const disconnect = () => {
    active = null
    clearProviders()
    for (const [id, item] of pending) {
      pending.delete(id)
      options.images?.discard(id)
      item.cleanup()
      item.reject(unavailable())
    }
    for (const asset of completedMedia.values()) options.images?.discard(asset.assetId)
    completedMedia.clear()
  }
  const send = (frame: LocalCapabilityFrame) => {
    if (active?.readyState !== WebSocket.OPEN) throw unavailable()
    active.send(JSON.stringify(frame))
  }

  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== LOCAL_CAPABILITY_PATH) return
    const authorization = request.headers.authorization
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (
      request.headers.origin !== undefined ||
      request.headers['sec-websocket-protocol'] !== LOCAL_CAPABILITY_PROTOCOL ||
      !options.tokenMatches(token)
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit('connection', webSocket))
  })

  sockets.on('connection', (webSocket) => {
    active?.close(1001, 'Replaced by a new local host')
    disconnect()
    active = webSocket
    webSocket.on('error', () => undefined)
    webSocket.on('close', () => { if (active === webSocket) disconnect() })
    webSocket.on('message', (data, isBinary) => {
      if (isBinary) { webSocket.close(1002, 'Binary frame'); return }
      let value: unknown
      try { value = JSON.parse(data.toString()) as unknown } catch { webSocket.close(1002, 'Invalid JSON'); return }
      const parsed = localCapabilityFrame.safeParse(value)
      if (!parsed.success || active !== webSocket) { webSocket.close(1002, 'Invalid frame'); return }
      const frame = parsed.data
      if (frame.type === 'register') {
        clearProviders()
        registered = frame.providers
        for (const provider of registered) {
          options.registry.register({
            ...provider,
            execute: ({ invocationId, input }, signal) => invoke(provider, invocationId, input, signal)
          })
        }
        webSocket.send(JSON.stringify({ type: 'registered', providerCount: registered.length }))
      } else if (frame.type === 'media-begin' || frame.type === 'media-chunk' || frame.type === 'media-end') {
        if (!pending.has(frame.invocationId) || !options.images) return
        try {
          if (frame.type === 'media-begin') options.images.begin(frame.invocationId, frame)
          if (frame.type === 'media-chunk') options.images.chunk(frame.invocationId, frame.index, frame.base64)
          if (frame.type === 'media-end') completedMedia.set(frame.invocationId, options.images.finish(frame.invocationId))
        } catch {
          webSocket.close(1002, 'Invalid volatile image frame')
        }
      } else if (frame.type === 'result' || frame.type === 'error') {
        const item = pending.get(frame.invocationId)
        if (!item) return // A late result cannot revive a timed out or cancelled invocation.
        pending.delete(frame.invocationId)
        item.cleanup()
        const asset = completedMedia.get(frame.invocationId)
        completedMedia.delete(frame.invocationId)
        if (frame.type === 'error' && asset) options.images?.discard(asset.assetId)
        if (frame.type === 'error') item.reject(new Error(`${frame.code}: ${frame.message}`))
        else item.resolve({
          ok: true,
          providerId: item.providerId,
          input: asset && typeof frame.output === 'object' && frame.output !== null
            ? { ...frame.output, screenshot: asset } : frame.output,
          ...(typeof frame.output === 'object' && frame.output !== null &&
            'needsUser' in frame.output && frame.output.needsUser === true ? { needsUser: true } : {})
        })
      }
    })
  })

  function invoke(
    provider: LocalCapabilityProvider, invocationId: string, input: unknown, signal?: AbortSignal
  ): Promise<SkillProviderResult> {
    if (!active || seen.has(invocationId)) return Promise.reject(unavailable())
    seen.add(invocationId)
    const deadlineUnixMs = Date.now() + 30_000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => cancel(), deadlineUnixMs - Date.now())
      const cancel = () => {
        if (!pending.has(invocationId)) return
        pending.delete(invocationId)
        options.images?.discard(invocationId)
        const asset = completedMedia.get(invocationId)
        if (asset) options.images?.discard(asset.assetId)
        completedMedia.delete(invocationId)
        cleanup()
        try { send({ type: 'cancel', invocationId }) } catch { /* disconnected */ }
        reject(new Error('SKILL_TIMEOUT: invocation cancelled'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
      }
      signal?.addEventListener('abort', cancel, { once: true })
      pending.set(invocationId, { providerId: provider.providerId, resolve, reject, cleanup })
      if (signal?.aborted) { cancel(); return }
      try {
        send({ type: 'invoke', invocationId, providerId: provider.providerId,
          providerVersion: provider.providerVersion, skillId: provider.skillId,
          deadlineUnixMs, input })
      } catch (error) {
        pending.delete(invocationId)
        cleanup()
        reject(error)
      }
    })
  }

  return { close: async () => {
    active?.close(1001, 'Runtime shutting down')
    disconnect()
    for (const socket of sockets.clients) socket.terminate()
    await new Promise<void>((resolve) => sockets.close(() => resolve()))
  } }
}
