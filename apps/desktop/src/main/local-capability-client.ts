import {
  LOCAL_CAPABILITY_PATH, LOCAL_CAPABILITY_PROTOCOL, localCapabilityFrame,
  type LocalCapabilityFrame
} from '@actiondriver/runtime-contracts'
import { WebSocket, type RawData } from 'ws'
import type { SkillProviderHost } from './skill-provider-host'

export async function connectLocalCapabilityHost(options: {
  baseUrl: string
  token: string
  host: SkillProviderHost
  authorize?: (skillId: string) => Promise<void>
}): Promise<{ close(): void }> {
  const url = new URL(LOCAL_CAPABILITY_PATH, options.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url, LOCAL_CAPABILITY_PROTOCOL, {
    headers: { Authorization: `Bearer ${options.token}` }
  })
  const running = new Map<string, AbortController>()
  const seen = new Set<string>()
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
    socket.once('unexpected-response', (_request, response) =>
      reject(new Error(`Local capability connection refused: ${response.statusCode}`)))
  })
  const send = (frame: LocalCapabilityFrame) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
  }
  const providers = options.host.listProviders()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Local capability registration timed out')), 5_000)
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      socket.off('message', handleMessage)
      socket.off('close', handleClose)
      if (error) reject(error)
      else resolve()
    }
    const handleMessage = (data: RawData) => {
      let value: unknown
      try { value = JSON.parse(data.toString()) as unknown }
      catch { finish(new Error('Invalid local capability registration response')); return }
      const parsed = localCapabilityFrame.safeParse(value)
      if (!parsed.success || parsed.data.type !== 'registered' ||
        parsed.data.providerCount !== providers.length) {
        finish(new Error('Local capability registration was rejected'))
        return
      }
      finish()
    }
    const handleClose = () => finish(new Error('Local capability connection closed during registration'))
    socket.on('message', handleMessage)
    socket.once('close', handleClose)
    send({ type: 'register', providers })
  })
  socket.on('message', (data, isBinary) => {
    if (isBinary) { socket.close(1002, 'Binary frame'); return }
    let value: unknown
    try { value = JSON.parse(data.toString()) as unknown } catch { socket.close(1002, 'Invalid JSON'); return }
    const parsed = localCapabilityFrame.safeParse(value)
    if (!parsed.success) { socket.close(1002, 'Invalid frame'); return }
    const frame = parsed.data
    if (frame.type === 'cancel') {
      running.get(frame.invocationId)?.abort()
      return
    }
    if (frame.type !== 'invoke') return
    if (seen.has(frame.invocationId)) {
      send({ type: 'error', invocationId: frame.invocationId,
        code: 'SKILL_PROVIDER_FAILED', message: 'Duplicate invocation ID' })
      return
    }
    seen.add(frame.invocationId)
    const controller = new AbortController()
    running.set(frame.invocationId, controller)
    void options.host.execute({
      invocationId: frame.invocationId,
      requestedSkillId: frame.skillId,
      resolvedProviderId: frame.providerId,
      providerVersion: frame.providerVersion,
      input: frame.input
    }, frame.deadlineUnixMs, options.authorize, controller.signal).then(
      (result) => send({ type: 'result', invocationId: frame.invocationId, output: result.output }),
      (error: unknown) => send({ type: 'error', invocationId: frame.invocationId,
        code: error instanceof Error && 'code' in error &&
          (error.code === 'CAPABILITY_UNAVAILABLE' || error.code === 'SKILL_TIMEOUT')
          ? error.code : 'SKILL_PROVIDER_FAILED',
        message: error instanceof Error ? error.message : String(error) })
    ).finally(() => running.delete(frame.invocationId))
  })
  socket.on('close', () => {
    for (const controller of running.values()) controller.abort()
    running.clear()
  })
  socket.on('error', () => undefined)
  return { close() { socket.close(1000, 'Local host shutting down') } }
}
