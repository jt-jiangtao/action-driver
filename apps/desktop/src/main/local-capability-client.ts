import {
  LOCAL_CAPABILITY_PATH, LOCAL_CAPABILITY_PROTOCOL, localCapabilityFrame,
  type LocalCapabilityFrame
} from '@action-driver/runtime-contracts'
import { WebSocket, type RawData } from 'ws'
import type { SkillProviderHost } from './skill-provider-host'

export async function connectLocalCapabilityHost(options: {
  baseUrl: string
  token: string
  host: SkillProviderHost
  disconnected?(): void
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
  const sendCapture = (invocationId: string, output: unknown): unknown => {
    if (typeof output !== 'object' || output === null || Array.isArray(output))
      throw new Error('INVALID_CAPTURE: helper did not return an image')
    const capture = output as Record<string, unknown>
    if (capture.mimeType !== 'image/jpeg' || typeof capture.base64 !== 'string' ||
        !Number.isInteger(capture.width) || !Number.isInteger(capture.height))
      throw new Error('INVALID_CAPTURE: image metadata is missing')
    const bytes = Buffer.from(capture.base64, 'base64')
    if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024)
      throw new Error('INVALID_CAPTURE: image exceeds the volatile channel limit')
    send({ type: 'media-begin', invocationId, mimeType: 'image/jpeg',
      width: capture.width as number, height: capture.height as number, byteLength: bytes.length })
    for (let offset = 0, index = 0; offset < bytes.length; offset += 256 * 1024, index++) {
      send({ type: 'media-chunk', invocationId, index,
        base64: bytes.subarray(offset, offset + 256 * 1024).toString('base64') })
    }
    send({ type: 'media-end', invocationId })
    const { base64: _base64, ...metadata } = capture
    return { ...metadata, screenshot: true }
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
      (result) => {
        const output = frame.skillId === 'computer-use' &&
          typeof frame.input === 'object' && frame.input !== null &&
          'operation' in frame.input && frame.input.operation === 'capture'
          ? sendCapture(frame.invocationId, result.output) : result.output
        send({ type: 'result', invocationId: frame.invocationId, output })
      }
    ).catch((error: unknown) => send({ type: 'error', invocationId: frame.invocationId,
        code: error instanceof Error && 'code' in error &&
          (error.code === 'CAPABILITY_UNAVAILABLE' || error.code === 'SKILL_TIMEOUT')
          ? error.code : 'SKILL_PROVIDER_FAILED',
        message: error instanceof Error ? error.message : String(error) })
    ).finally(() => running.delete(frame.invocationId))
  })
  socket.on('close', () => {
    options.disconnected?.()
    for (const controller of running.values()) controller.abort()
    running.clear()
  })
  socket.on('error', () => undefined)
  return { close() { socket.close(1000, 'Local host shutting down') } }
}
