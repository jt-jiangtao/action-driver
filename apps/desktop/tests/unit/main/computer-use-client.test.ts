import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerUseClient, helperLaunchArguments, owningAppBundle } from '../../../src/main/computer-use-client'

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
  it('leaves ownership of the listening socket path to the helper when closing', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const pending = client.execute({version:1,requestId:'before-close',
      deadlineUnixMs:Date.now()+1000,operation:'permissions'})
    await vi.waitFor(()=>expect(helper.requests).toHaveLength(1))
    helper.reply({version:1,requestId:'before-close',ok:true,result:{}})
    await pending
    vi.useFakeTimers()
    try {
      client.close()
      await vi.advanceTimersByTimeAsync(400)
      expect(existsSync(helper.socketPath)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
  it('reads the current token when establishing a connection after token replacement', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    writeFileSync(helper.tokenPath, 'replacement-token', {mode: 0o600})
    const pending = client.execute({version:1,requestId:'rotated-token',
      deadlineUnixMs:Date.now()+1000,operation:'permissions'})
    await vi.waitFor(()=>expect(helper.requests).toHaveLength(1))
    expect(helper.handshakes).toEqual(['replacement-token'])
    helper.reply({version:1,requestId:'rotated-token',ok:true,result:{}})
    await pending
    client.close()
  })
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
      operation: 'app-state', sessionId: 'session-1', app: 'com.apple.Notes',
      maxDepth: 8, maxElements: 100
    })
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    helper.close()
    await expect(pending).rejects.toThrow('ENGINE_UNAVAILABLE')
    client.close()
  })

  it('fails when no helper ever starts listening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actiondriver-nohelper-'))
    const launch = vi.fn()
    const client = new ComputerUseClient({
      helperPath: '/unused/ActionDriver Computer Use.app',
      socketPath: join(directory, 'missing.sock'),
      tokenPath: join(directory, 'missing.token'),
      ownerAppPath: '/Applications/ActionDriver.app',
      launch,
      connectTimeoutMs: 150
    })
    await expect(client.execute({
      version: 1, requestId: 'observe-2', deadlineUnixMs: Date.now() + 5000,
      operation: 'app-state', sessionId: 'session-1', app: 'com.apple.Notes',
      maxDepth: 8, maxElements: 100
    })).rejects.toThrow('ENGINE_UNAVAILABLE')
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledWith('/unused/ActionDriver Computer Use.app',
      join(directory, 'missing.sock'), join(directory, 'missing.token'), '/Applications/ActionDriver.app')
    client.close()
  })

  // The helper refuses to drive ActionDriver itself, which it can only recognize by path (D9).
  it('names ActionDriver itself when launching the helper', () => {
    expect(helperLaunchArguments('/h.app', '/s.sock', '/t.token', '/Applications/ActionDriver.app')).toEqual([
      '-a', '/h.app', '--args', '--socket', '/s.sock', '--token-file', '/t.token',
      '--owner-app', '/Applications/ActionDriver.app'
    ])
    expect(helperLaunchArguments('/h.app', '/s.sock', '/t.token')).not.toContain('--owner-app')
    expect(owningAppBundle('/Applications/ActionDriver.app/Contents/MacOS/ActionDriver'))
      .toBe('/Applications/ActionDriver.app')
    expect(owningAppBundle('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))
      .toBe('/repo/node_modules/electron/dist/Electron.app')
    expect(owningAppBundle('/usr/local/bin/node')).toBeUndefined()
  })

  it('sends cancellation to the helper and rejects the original call', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const abort = new AbortController()
    const pending = client.execute({
      version: 1, requestId: 'observe-3', deadlineUnixMs: Date.now() + 1000,
      operation: 'app-state', sessionId: 'session-1', app: 'com.apple.Notes',
      maxDepth: 8, maxElements: 100
    }, abort.signal)
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    abort.abort()
    await expect(pending).rejects.toThrow('CANCELLED')
    await vi.waitFor(() => expect(helper.requests.some((request) =>
      request.operation === 'cancel')).toBe(true))
    client.close()
  })
})

describe('helper uncertain outcomes', () => {
  it('reports unknown action outcome on timeout and ignores a late success without resending', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const action = client.execute({ version: 1, requestId: 'slow-action', deadlineUnixMs: Date.now() + 200,
      operation: 'act', sessionId: 'session-1', app: 'com.apple.Notes',
      action: { type: 'click', x: 1, y: 2 } })
    const failed = expect(action).rejects.toThrow('动作可能已执行')
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    await failed
    helper.reply({ version: 1, requestId: 'slow-action', ok: true, result: { executed: true } })
    const observe = client.execute({ version: 1, requestId: 'after-timeout', deadlineUnixMs: Date.now() + 1000,
      operation: 'permissions' })
    await vi.waitFor(() => expect(helper.requests.some(r => r.requestId === 'after-timeout')).toBe(true))
    helper.reply({ version: 1, requestId: 'after-timeout', ok: true, result: { accessibility: true } })
    await expect(observe).resolves.toEqual({ accessibility: true })
    expect(helper.requests.filter(r => r.requestId === 'slow-action')).toHaveLength(1)
    client.close()
  })

  it('reports an unknown action outcome when the connection closes after dispatch', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const action = client.execute({ version: 1, requestId: 'lost-action', deadlineUnixMs: Date.now() + 1000,
      operation: 'act', sessionId: 'session-1', app: 'com.apple.Notes',
      action: { type: 'click', x: 1, y: 2 } })
    const failed = expect(action).rejects.toThrow('动作可能已执行')
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    helper.close()
    await failed
    expect(helper.requests.filter(r => r.requestId === 'lost-action')).toHaveLength(1)
    client.close()
  })
})

describe('queued helper cancellation', () => {
  it('cancels before dispatch without waiting for an earlier request to finish', async () => {
    const helper = await startFakeHelper()
    const client = createClient(helper)
    const first = client.execute({ version: 1, requestId: 'blocking', deadlineUnixMs: Date.now() + 2000,
      operation: 'permissions' })
    void first.catch(() => undefined)
    await vi.waitFor(() => expect(helper.requests).toHaveLength(1))
    const abort = new AbortController()
    let cancelled = false
    const queued = client.execute({ version: 1, requestId: 'queued', deadlineUnixMs: Date.now() + 2000,
      operation: 'permissions' }, abort.signal)
    void queued.catch(() => { cancelled = true })
    abort.abort()
    await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 300 })
    await expect(queued).rejects.toThrow('CANCELLED')
    expect(helper.requests).toHaveLength(1)
    helper.reply({ version: 1, requestId: 'blocking', ok: true, result: {} })
    await first
    client.close()
  })
})
