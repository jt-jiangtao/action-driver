import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ComputerUseClient, type ComputerUseChild } from './computer-use-client'

function fakeChild(): ComputerUseChild & { stdin: PassThrough; stdout: PassThrough; sent: string[]; reply(value: unknown): void; exit(): void; fail(): void } {
  const events = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const sent: string[] = []
  stdin.on('data', (chunk: Buffer) => sent.push(chunk.toString()))
  return {
    stdin,
    stdout,
    sent,
    on: events.on.bind(events),
    once: events.once.bind(events),
    kill: () => true,
    reply(value) { stdout.write(`${JSON.stringify(value)}\n`) },
    exit() { events.emit('exit', 1, null) },
    fail() { events.emit('error', new Error('spawn failed')) }
  }
}

describe('ComputerUseClient', () => {
  it('serializes overlapping calls so the single-instance helper never reports busy', async () => {
    const child = fakeChild()
    const client = new ComputerUseClient(() => child)
    const first = client.execute({
      version: 1, requestId: 'permissions-first', deadlineUnixMs: Date.now() + 1000,
      operation: 'permissions'
    })
    const second = client.execute({
      version: 1, requestId: 'permissions-second', deadlineUnixMs: Date.now() + 1000,
      operation: 'permissions'
    })
    await Promise.resolve()
    expect(child.sent.join('')).not.toContain('permissions-second')

    child.reply({ version: 1, requestId: 'permissions-first', ok: true,
      result: { accessibility: false } })
    await expect(first).resolves.toEqual({ accessibility: false })
    await vi.waitFor(() => expect(child.sent.join('')).toContain('permissions-second'))

    child.reply({ version: 1, requestId: 'permissions-second', ok: true,
      result: { accessibility: true } })
    await expect(second).resolves.toEqual({ accessibility: true })
    client.close()
  })

  it('correlates a fragmented helper reply with the pending request', async () => {
    const child = fakeChild()
    const client = new ComputerUseClient(() => child)
    const pending = client.execute({
      version: 1, requestId: 'permission-1', deadlineUnixMs: Date.now() + 1000,
      operation: 'permissions'
    })
    expect(JSON.parse(child.sent.join(''))).toMatchObject({ requestId: 'permission-1', operation: 'permissions' })
    child.stdout.write('{"version":1,"requestId":"permission-1","ok":true,')
    child.stdout.write('"result":{"accessibility":false,"screenRecording":false}}\n')
    await expect(pending).resolves.toEqual({ accessibility: false, screenRecording: false })
    client.close()
  })

  it('fails pending calls when the helper exits', async () => {
    const child = fakeChild()
    const client = new ComputerUseClient(() => child)
    const pending = client.execute({
      version: 1, requestId: 'observe-1', deadlineUnixMs: Date.now() + 1000,
      operation: 'observe', maxDepth: 8, maxElements: 100
    })
    child.exit()
    await expect(pending).rejects.toThrow('ENGINE_UNAVAILABLE')
    client.close()
  })

  it('fails pending calls when the helper cannot start', async () => {
    const child = fakeChild()
    const client = new ComputerUseClient(() => child)
    const pending = client.execute({
      version: 1, requestId: 'observe-error', deadlineUnixMs: Date.now() + 1000,
      operation: 'observe', maxDepth: 8, maxElements: 100
    })
    child.fail()
    await expect(pending).rejects.toThrow('ENGINE_UNAVAILABLE: spawn failed')
    client.close()
  })

  it('sends cancellation to the helper and rejects the original call', async () => {
    const child = fakeChild()
    const client = new ComputerUseClient(() => child)
    const abort = new AbortController()
    const pending = client.execute({
      version: 1, requestId: 'observe-2', deadlineUnixMs: Date.now() + 1000,
      operation: 'observe', maxDepth: 8, maxElements: 100
    }, abort.signal)
    abort.abort()
    await expect(pending).rejects.toThrow('CANCELLED')
    expect(child.sent.join('')).toContain('"operation":"cancel"')
    client.close()
  })
})
