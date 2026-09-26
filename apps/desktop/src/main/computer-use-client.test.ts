import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerUseClient } from './computer-use-client'

let server: Server | undefined
let liveSocket: Socket | undefined
afterEach(async () => {
  liveSocket?.destroy()
  liveSocket = undefined
  await new Promise<void>((resolve) => {
    if (!server) { resolve(); return }
    server.close(() => resolve())
    server = undefined
  })
})

type FakeHelper = {
  socketPath: string
  tokenPath: string
  requests: Array<Record<string, unknown>>
  handshakes: string[]
  reply(value: unknown): void
  close(): void
}

async function startFakeHelper(): Promise<FakeHelper> {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-helper-'))
  const socketPath = join(directory, 'computer-use.sock')
  const tokenPath = join(directory, 'computer-use.token')
  const requests: Array<Record<string, unknown>> = []
  const handshakes: string[] = []
  let socket: Socket | undefined
  server = createServer((connection) => {
    socket = connection
    liveSocket = connection
    connection.setEncoding('utf8')
    let buffer = ''
    let authenticated = false
    connection.on('data', (chunk: string) => {
      buffer += chunk
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (!authenticated) {
          authenticated = true
          handshakes.push(String(parsed.token ?? ''))
          continue
        }
        requests.push(parsed)
      }
    })
    connection.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server!.listen(socketPath, resolve))
  return {
    socketPath,
    tokenPath,
    requests,
    handshakes,
    reply(value) { socket?.write(`${JSON.stringify(value)}\n`) },
    close() { socket?.destroy() }
  }
}

function createClient(helper: FakeHelper, overrides: Partial<{ connectTimeoutMs: number }> = {}) {
  return new ComputerUseClient({
    helperPath: '/unused/ActionDriver Computer Use.app',
    socketPath: helper.socketPath,
    tokenPath: helper.tokenPath,
    launch: () => undefined,
    ...overrides
  })
}

describe('ComputerUseClient', () => {
  it('handshakes with a token and correlates a fragmented reply', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const pending = client.execute({
      version: 1, requestId: 'permission-1', deadlineUnixMs: Date.now() + 1000,
      operation: 'permissions'
    })
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    expect(helper.handshakes).toHaveLength(1)
    expect(helper.handshakes[0]).not.toBe('')
    helper.reply({ version: 1, requestId: 'permission-1', ok: true,
      result: { accessibility: false, screenRecording: false } })
    await expect(pending).resolves.toEqual({ accessibility: false, screenRecording: false })
    client.close()
  })

  it('serializes overlapping calls into one request at a time', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const first = client.execute({
      version: 1, requestId: 'first', deadlineUnixMs: Date.now() + 1000, operation: 'permissions'
    })
    const second = client.execute({
      version: 1, requestId: 'second', deadlineUnixMs: Date.now() + 1000, operation: 'permissions'
    })
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    expect(helper.requests.map((request) => request.requestId)).toEqual(['first'])
    helper.reply({ version: 1, requestId: 'first', ok: true, result: { accessibility: true } })
    await expect(first).resolves.toEqual({ accessibility: true })
    await vi.waitFor(() => expect(helper.requests).toHaveLength(2))
    expect(helper.requests.map((request) => request.requestId)).toEqual(['first', 'second'])
    helper.reply({ version: 1, requestId: 'second', ok: true, result: { accessibility: true } })
    await expect(second).resolves.toEqual({ accessibility: true })
    client.close()
  })

  it('fails pending calls when the helper socket closes', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const pending = client.execute({
      version: 1, requestId: 'observe-1', deadlineUnixMs: Date.now() + 1000,
      operation: 'observe', maxDepth: 8, maxElements: 100
    })
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    helper.close()
    await expect(pending).rejects.toThrow('ENGINE_UNAVAILABLE')
    client.close()
  })

  it('fails when no helper ever starts listening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actiondriver-nohelper-'))
    const client = new ComputerUseClient({
      helperPath: '/unused/ActionDriver Computer Use.app',
      socketPath: join(directory, 'missing.sock'),
      tokenPath: join(directory, 'missing.token'),
      launch: () => undefined,
      connectTimeoutMs: 150
    })
    await expect(client.execute({
      version: 1, requestId: 'observe-2', deadlineUnixMs: Date.now() + 5000,
      operation: 'observe', maxDepth: 8, maxElements: 100
    })).rejects.toThrow('ENGINE_UNAVAILABLE')
    client.close()
  })

  it('sends cancellation to the helper and rejects the original call', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const abort = new AbortController()
    const pending = client.execute({
      version: 1, requestId: 'observe-3', deadlineUnixMs: Date.now() + 1000,
      operation: 'observe', maxDepth: 8, maxElements: 100
    }, abort.signal)
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    abort.abort()
    await expect(pending).rejects.toThrow('CANCELLED')
    await vi.waitFor(() => expect(helper.requests.some((request) =>
      request.operation === 'cancel')).toBe(true))
    client.close()
  })
})
