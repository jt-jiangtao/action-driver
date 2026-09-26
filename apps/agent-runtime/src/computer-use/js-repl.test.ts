import { describe, expect, it, vi } from 'vitest'
import { ApprovalRequiredError, JsReplHost, type JsReplChild } from './js-repl'

type Message = Record<string, unknown>

/**
 * Stands in for the real child: it answers each cell with the messages the test scripted for that
 * code (an empty answer when it wrote no script), and records what the host wrote back.
 */
class FakeChild {
  private emit: ((chunk: string) => void) | null = null
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  readonly written: string[] = []
  /** Calls the host suspended, and what the fake child sends once the decision arrives. */
  readonly suspended: number[] = []
  resume: Message[] = [{ ok: true }]
  killed = false
  private lastCellId: number | undefined

  constructor(readonly replies: Map<string, Message[]> = new Map()) {}

  readonly stdin = {
    write: (line: string) => {
      this.written.push(line)
      const message = JSON.parse(line) as Message
      if (message.type === 'approvalRequired') { this.suspended.push(Number(message.id)); return }
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
  send(message: Message): void { this.emit?.(`${JSON.stringify(message)}\n`) }
}

function harness(overrides: {
  callSky?: (taskId: string, method: string, args: unknown) => Promise<unknown>
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
      callSky: async () => [{ id: 'com.apple.TextEdit' }]
    })
    const running = host.run('task-2', 'await sky.list_apps()', {}, events())
    await settle()
    children[0]!.send({ type: 'call', id: 7, method: 'list_apps', args: { app: 'TextEdit' } })
    expect(await running).toEqual({ kind: 'completed', output: '' })
    expect(callSky).toHaveBeenCalledWith('task-2', 'list_apps', { app: 'TextEdit' })
    expect(children[0]!.written.at(-1)).toContain('"type":"callResult"')
    host.dispose('task-2')
  })

  it('reports a sky failure back to the cell', async () => {
    const { host, children } = harness({
      callSky: async () => { throw new Error('ACCESSIBILITY_DENIED: nope') }
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

  it('stops a cell on an action and resumes it with the decision', async () => {
    let allow = false
    const { host, children } = harness({
      // The cell stays open until the test sends a sky call; only the suspension can end it.
      replies: new Map([['click the button', []]]),
      callSky: async (_taskId, method, args) => {
        if (!allow) throw new ApprovalRequiredError({ method, args })
        return { clicked: method }
      }
    })
    const reported = events()
    const running = host.run('task-9', 'click the button', {}, reported)
    await settle()
    const child = children[0]!
    // The cell asks for an action; the host stops it instead of acting.
    child.send({ type: 'call', id: 11, method: 'click', args: { app: 'TextEdit', element_index: 2 } })
    const stopped = await running
    expect(stopped).toEqual({ kind: 'approval', action: {
      index: 0, method: 'click', args: { app: 'TextEdit', element_index: 2 }
    } })
    expect(child.suspended).toEqual([11])
    // Waiting for the user is not part of the cell's budget: nothing times out while suspended.

    child.resume = [{ type: 'text', text: 'clicked' }, { ok: true }]
    allow = true
    const perform = vi.fn(async () => ({ clicked: 'click' }))
    const finished = await host.continueRun('task-9', { action: stopped.kind === 'approval'
      ? stopped.action : { index: 0, method: 'click', args: {} }, approved: true, perform },
    {})
    expect(perform).toHaveBeenCalledOnce()
    expect(finished).toEqual({ kind: 'completed', output: 'clicked' })
    expect(child.written.at(-1)).toContain('"type":"callResult"')
    expect(child.written.join('\n')).toContain('"clicked":"click"')
    host.dispose('task-9')
  })

  it('answers a denied action inside the cell and keeps going', async () => {
    const { host, children } = harness({
      replies: new Map([['type text', []]]),
      callSky: async () => { throw new ApprovalRequiredError({ method: 'type_text', args: {} }) }
    })
    const running = host.run('task-10', 'type text', {}, events())
    await settle()
    const child = children[0]!
    child.send({ type: 'call', id: 3, method: 'type_text', args: { text: 'hi' } })
    expect((await running).kind).toBe('approval')
    child.resume = [{ type: 'text', text: 'handled' }, { ok: true }]
    const finished = await host.continueRun('task-10',
      { action: { index: 0, method: 'type_text', args: { text: 'hi' } }, approved: false }, {})
    expect(finished).toEqual({ kind: 'completed', output: 'handled' })
    expect(child.written.join('\n')).toContain('USER_DENIED')
    host.dispose('task-10')
  })

  it('numbers each action of one cell and rejects a mismatched decision', async () => {
    const { host, children } = harness({
      replies: new Map([['act twice', []]]),
      callSky: async () => { throw new ApprovalRequiredError({ method: 'click', args: {} }) }
    })
    const running = host.run('task-11', 'act twice', {}, events())
    await settle()
    const child = children[0]!
    child.send({ type: 'call', id: 1, method: 'click', args: {} })
    const first = await running
    expect(first.kind === 'approval' && first.action.index).toBe(0)
    child.resume = []
    const second = host.continueRun('task-11',
      { action: { index: 0, method: 'click', args: {} }, approved: true,
        perform: async () => null }, {})
    await settle()
    child.send({ type: 'call', id: 2, method: 'click', args: {} })
    const next = await second
    expect(next.kind === 'approval' && next.action.index).toBe(1)
    await expect(host.continueRun('task-11',
      { action: { index: 0, method: 'click', args: {} }, approved: true }, {}))
      .rejects.toThrow('APPROVAL_STALE')
    await expect(host.run('task-11', 'other cell', {}, events()))
      .rejects.toThrow('waiting for an approval')
    host.dispose('task-11')
  })

  it('drops a suspended session on reset', async () => {
    const { host, children } = harness({
      callSky: async () => { throw new ApprovalRequiredError({ method: 'click', args: {} }) }
    })
    const running = host.run('task-12', 'act', {}, events())
    await settle()
    children[0]!.send({ type: 'call', id: 5, method: 'click', args: {} })
    await running
    await host.reset('task-12')
    expect(children[0]!.killed).toBe(true)
    host.dispose('task-12')
  })
})
