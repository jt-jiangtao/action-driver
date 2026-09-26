import { describe, expect, it, vi } from 'vitest'
import { JsReplHost, type JsReplChild } from './js-repl'

type Message = Record<string, unknown>

/**
 * Stands in for the real child: it answers each cell with the messages the test scripted for that
 * code (an empty answer when it wrote no script), and records what the host wrote back.
 */
class FakeChild {
  private emit: ((chunk: string) => void) | null = null
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  readonly written: string[] = []
  resume: Message[] = [{ ok: true }]
  killed = false
  private lastCellId: number | undefined

  constructor(readonly replies: Map<string, Message[]> = new Map()) {}

  readonly stdin = {
    write: (line: string) => {
      this.written.push(line)
      const message = JSON.parse(line) as Message
      if (message.type === 'callResult') {
        for (const reply of this.resume) {
          this.send({ ...reply, id: reply.id ?? this.lastCellId })
        }
        return
      }
      if (message.reset === true) { this.send({ id: message.id, ok: true }); return }
      this.lastCellId = Number(message.id)
      for (const reply of this.replies.get(String(message.code)) ?? [{ ok: true }]) {
        this.send({ ...reply, id: reply.id ?? message.id })
      }
    }
  }

  readonly stdout = {
    setEncoding: () => undefined,
    on: (_event: string, listener: (chunk: string) => void) => { this.emit = listener }
  }

  readonly stderr = {
    setEncoding: () => undefined,
    on: (_event: string, _listener: (chunk: string) => void) => undefined
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  kill(): boolean { this.killed = true; return true }
  exit(code = 0): void { for (const listener of this.listeners.get('exit') ?? []) listener(code) }
  error(): void { for (const listener of this.listeners.get('error') ?? []) listener(new Error('late')) }
  send(message: Message): void { this.emit?.(`${JSON.stringify(message)}\n`) }
}

function harness(overrides: {
  callSky?: (taskId: string, method: string, args: unknown, signal?: AbortSignal) => Promise<unknown>
  replies?: Map<string, Message[]>
} = {}) {
  const children: FakeChild[] = []
  const closed: string[] = []
  const callSky = vi.fn(overrides.callSky ?? (async () => ({ ok: true })))
  const host = new JsReplHost({
    spawn: async () => {
      const child = new FakeChild(overrides.replies)
      children.push(child)
      return child as unknown as JsReplChild
    },
    close: (taskId) => { closed.push(taskId) },
    callSky,
    defaultTimeoutMs: 1_000
  })
  return { host, children, callSky, closed }
}

const events = () => ({ text: vi.fn(), image: vi.fn() })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('REPL lifetime while spawning', () => {
  it('kills a late child after disposal instead of resurrecting the session', async () => {
    let resolve!: (child: JsReplChild) => void
    const child = new FakeChild()
    const closed = vi.fn()
    const host = new JsReplHost({ spawn: () => new Promise(r => { resolve = r }), close: closed, callSky: async () => ({}) })
    const pending = host.run('session', 'late', {}, { text: () => {}, image: () => {} }).catch(error => error.message)
    host.dispose('session')
    resolve(child as unknown as JsReplChild)
    expect(await pending).toContain('closed')
    expect(child.killed).toBe(true)
    expect(child.written).toHaveLength(0)
    expect(closed).toHaveBeenCalled()
  })
  it('ignores old child errors and output after a replacement starts', async () => {
    const { host, children } = harness({ replies: new Map([['waiting', []]]) })
    await host.run('session', 'first', {}, events())
    const old = children[0]!
    host.dispose('session')
    const output = events()
    const pending = host.run('session', 'waiting', {}, output)
    await settle()
    old.error()
    old.send({ type: 'text', text: 'stale' })
    old.send({ id: 1, ok: true })
    expect(children[1]!.killed).toBe(false)
    expect(output.text).not.toHaveBeenCalled()
    children[1]!.send({ id: 1, ok: true })
    expect(await pending).toEqual({ kind: 'completed', output: '' })
    host.disposeAll()
  })
  it('does not let a cancelled spawn replace a newer child', async () => {
    let resolve!: (child: JsReplChild) => void
    const old = new FakeChild()
    const current = new FakeChild()
    let count = 0
    const host = new JsReplHost({
      spawn: () => ++count === 1 ? new Promise(r => { resolve = r }) : Promise.resolve(current as unknown as JsReplChild),
      callSky: async () => ({})
    })
    const cancelled = host.run('session', 'old', {}, events()).catch(error => error.message)
    host.dispose('session')
    await host.run('session', 'new', {}, events())
    resolve(old as unknown as JsReplChild)
    expect(await cancelled).toContain('closed')
    await host.run('session', 'still new', {}, events())
    expect(count).toBe(2)
    expect(current.killed).toBe(false)
    expect(old.killed).toBe(true)
    host.disposeAll()
  })
  it('rejects queued cells after disposal without writing them to the child', async () => {
    const { host, children } = harness({ replies: new Map([['waiting', []]]) })
    const active = host.run('session', 'waiting', {}, events()).catch(error => error.message)
    await settle()
    const queued = host.run('session', 'queued', {}, events()).catch(error => error.message)
    await settle()
    host.dispose('session')
    expect(await active).toContain('closed')
    expect(await queued).toContain('closed')
    expect(children[0]!.written).toHaveLength(1)
  })
  it('reset cancels a spawn and tells the factory to stop allocating resources', async () => {
    let resolve!: (child: JsReplChild) => void
    let signal: AbortSignal | undefined
    const child = new FakeChild()
    const host = new JsReplHost({ spawn: (_id, abort) => { signal = abort; return new Promise(r => { resolve = r }) }, callSky: async () => ({}) })
    const pending = host.run('session', 'late', {}, { text: () => {}, image: () => {} }).catch(error => error.message)
    await host.reset('session')
    expect(signal?.aborted).toBe(true)
    resolve(child as unknown as JsReplChild)
    expect(await pending).toContain('closed')
  })
})

describe('JsReplHost', () => {
  it('keeps one child per task and returns the text the cell wrote', async () => {
    const replies = new Map([
      ['nodeRepl.write("one")', [{ type: 'text', text: 'one' }, { ok: true }]],
      ['nodeRepl.write("two")', [{ type: 'text', text: 'two' }, { ok: true }]]
    ])
    const { host, children } = harness({ replies })
    const reported = events()
    expect(await host.run('task-1', 'nodeRepl.write("one")', {}, reported))
      .toEqual({ kind: 'completed', output: 'one' })
    expect(await host.run('task-1', 'nodeRepl.write("two")', {}, reported))
      .toEqual({ kind: 'completed', output: 'two' })
    expect(children).toHaveLength(1)
    expect(reported.text).toHaveBeenCalledWith('one')
    host.dispose('task-1')
    expect(children[0]!.killed).toBe(true)
  })

  it('answers a sky call through the host bridge', async () => {
    const { host, children, callSky } = harness({
      callSky: async () => [{ id: 'com.apple.TextEdit' }],
      replies: new Map([['await sky.list_apps()', []]])
    })
    const running = host.run('task-2', 'await sky.list_apps()', {}, events())
    await settle()
    children[0]!.send({ type: 'call', id: 7, method: 'list_apps', args: { app: 'TextEdit' } })
    expect(await running).toEqual({ kind: 'completed', output: '' })
    expect(callSky).toHaveBeenCalledWith('task-2', 'list_apps', { app: 'TextEdit' }, expect.any(AbortSignal))
    expect(children[0]!.written.at(-1)).toContain('"type":"callResult"')
    host.dispose('task-2')
  })

  it('reports a sky failure back to the cell', async () => {
    const { host, children } = harness({
      callSky: async () => { throw new Error('ACCESSIBILITY_DENIED: nope') },
      replies: new Map([['await sky.list_apps()', []]])
    })
    const running = host.run('task-3', 'await sky.list_apps()', {}, events())
    await settle()
    children[0]!.send({ type: 'call', id: 3, method: 'list_apps', args: {} })
    await running
    expect(children[0]!.written.at(-1)).toContain('ACCESSIBILITY_DENIED')
    host.dispose('task-3')
  })

  it('streams images emitted by the session', async () => {
    const replies = new Map([['emit', [
      { type: 'image', mimeType: 'image/png', base64: Buffer.from('png').toString('base64') },
      { ok: true }
    ]]])
    const { host } = harness({ replies })
    const reported = events()
    expect(await host.run('task-4', 'emit', {}, reported)).toEqual({ kind: 'completed', output: '' })
    expect(reported.image).toHaveBeenCalledWith(Buffer.from('png'), 'image/png')
    host.dispose('task-4')
  })

  it('fails the call with the message the cell threw', async () => {
    const replies = new Map([['boom', [{ ok: false, error: 'Error: boom' }]]])
    const { host } = harness({ replies })
    await expect(host.run('task-5', 'boom', {}, events())).rejects.toThrow('Error: boom')
    host.dispose('task-5')
  })

  it('ends the session when a call runs out of time', async () => {
    const { host, children, closed } = harness({ replies: new Map([['hang', []]]) })
    await expect(host.run('task-6', 'hang', { timeoutMs: 20 }, events())).rejects.toThrow('TIMED_OUT')
    expect(children[0]!.killed).toBe(true)
    expect(closed).toContain('task-6')
  })

  it('fails pending work when the child exits', async () => {
    const { host, children } = harness({ replies: new Map([['slow', []]]) })
    const running = host.run('task-7', 'slow', {}, events())
    await settle()
    children[0]!.exit(1)
    await expect(running).rejects.toThrow('ENGINE_UNAVAILABLE')
  })

  it('resets bindings without replacing the child', async () => {
    const { host, children } = harness()
    await host.run('task-8', 'const x = 1', {}, events())
    await host.reset('task-8')
    expect(children).toHaveLength(1)
    expect(children[0]!.written.at(-1)).toContain('"reset":true')
    host.dispose('task-8')
  })
})

describe('untrusted child IPC', () => {
  it('aborts capability calls on reset and ignores their late errors', async () => {
    let rejectCall!: (error: Error) => void
    let callSignal: AbortSignal | undefined
    const h = harness({ replies: new Map([['waiting', []]]),
      callSky: async (_, __, ___, signal) => {
        callSignal = signal
        return await new Promise((_, reject) => { rejectCall = reject })
      } })
    const running = h.host.run('reset-active', 'waiting', {}, events())
    const rejected = expect(running).rejects.toThrow('ENGINE_UNAVAILABLE')
    await settle()
    const oldChild = h.children[0]!
    oldChild.send({ type: 'call', id: 1, method: 'click', args: {} })
    await settle()
    await h.host.reset('reset-active')
    await rejected
    expect(callSignal?.aborted).toBe(true)
    await h.host.run('reset-active', 'done', {}, events())
    rejectCall(new Error('late failure'))
    await settle()
    expect(oldChild.written.some(line => JSON.parse(line).type === 'callResult')).toBe(false)
    h.host.disposeAll()
  })
  it('ignores privileged requests when no cell is running', async () => {
    const { host, children, callSky } = harness()
    await host.run('idle', 'done', {}, events())
    children[0]!.send({ type: 'call', id: 99, method: 'list_apps', args: {} })
    await settle()
    expect(callSky).not.toHaveBeenCalled()
    host.dispose('idle')
  })

  it('does not execute duplicate request IDs twice', async () => {
    const { host, children, callSky } = harness({ replies: new Map([['waiting', []]]) })
    const running = host.run('duplicate', 'waiting', {}, events())
    await settle()
    children[0]!.resume = []
    const message = { type: 'call', id: 4, method: 'list_apps', args: {} }
    children[0]!.send(message)
    children[0]!.send(message)
    await settle()
    expect(callSky).toHaveBeenCalledTimes(1)
    children[0]!.send({ id: 1, ok: true })
    await running
    host.dispose('duplicate')
  })
})

describe('trusted timeout suspension', () => {
  it('does not count host approval waiting against the cell budget', async () => {
    let release!: () => void
    const approval = new Promise<void>(resolve => { release = resolve })
    const entered = vi.fn()
    const h = harness({
      replies: new Map([['await approval', []]]),
      callSky: async () => await h.host.withSuspendedTimeout('timeout-wait', async () => {
        entered()
        await approval
        return { approved: true }
      })
    })
    const running = h.host.run('timeout-wait', 'await approval', { timeoutMs: 30 }, events())
    await settle()
    h.children[0]!.send({ type: 'call', id: 1, method: 'list_apps', args: {} })
    await settle()
    expect(entered).toHaveBeenCalledTimes(1)
    await new Promise(resolve => setTimeout(resolve, 70))
    expect(h.children[0]!.killed).toBe(false)
    release()
    expect(await running).toEqual({ kind: 'completed', output: '' })
    h.host.dispose('timeout-wait')
  })
})
