import type { Readable, Writable } from 'node:stream'

export type JsReplChild = {
  stdin: Writable
  stdout: Readable
  stderr?: Readable
  kill(): boolean
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type JsReplEvents = {
  text(chunk: string): void
  image(bytes: Buffer, mimeType: string): void
}

type Pending = {
  settle(error?: Error): void
  timeout: ReturnType<typeof setTimeout>
}

type Active = { id: number; events: JsReplEvents; collected: string[] }

type Session = {
  taskId: string
  child: JsReplChild
  buffer: string
  pending: Map<number, Pending>
  nextId: number
  active: Active | null
  queue: Promise<unknown>
  stderr: string[]
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Host side of the stateful JavaScript entry.
 *
 * One child process serves one task for the whole session, so bindings survive between calls. Every
 * `sky.*` call comes back here, where the runtime applies the Skill gate and talks to the native
 * helper; images travel back the same way and are turned into assets by the caller. Cells of one
 * task run one at a time, and a call that times out or is cancelled ends the session rather than
 * leaving a half-evaluated cell behind.
 */
export class JsReplHost {
  private readonly sessions = new Map<string, Session>()
  private readonly spawning = new Map<string, Promise<Session>>()

  constructor(private readonly options: {
    spawn(taskId: string): Promise<JsReplChild>
    /** Releases whatever `spawn` allocated (sandbox, temporary directory) after the child is gone. */
    close?(taskId: string): Promise<void> | void
    callSky(taskId: string, method: string, args: unknown, signal?: AbortSignal): Promise<unknown>
    /** Rejects a cell when the caller gave no explicit budget. */
    defaultTimeoutMs?: number
  }) {}

  /** Runs one cell and returns the text the cell wrote through `nodeRepl`. */
  async run(
    taskId: string,
    code: string,
    options: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined },
    events: JsReplEvents
  ): Promise<string> {
    const session = await this.ensureSession(taskId)
    const limits = { signal: options.signal, timeoutMs: options.timeoutMs }
    return await this.enqueue(session, async () => {
      const id = session.nextId++
      const active: Active = { id, events, collected: [] }
      session.active = active
      try {
        await this.awaitCell(session, id, code, limits)
        return active.collected.join('')
      } finally {
        if (session.active === active) session.active = null
      }
    })
  }

  /** Drops every binding of the task and starts a fresh context, keeping the child alive. */
  async reset(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId)
    if (!session) return
    await this.enqueue(session, async () => {
      const id = session.nextId++
      await this.awaitCell(session, id, undefined, { signal: undefined, timeoutMs: 5_000 })
    })
  }

  dispose(taskId: string): void {
    const session = this.sessions.get(taskId)
    this.sessions.delete(taskId)
    this.spawning.delete(taskId)
    if (!session) return
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timeout)
      pending.settle(new Error('ENGINE_UNAVAILABLE: js session closed'))
    }
    session.pending.clear()
    try { session.child.kill() } catch { /* already gone */ }
    void this.options.close?.(taskId)
  }

  disposeAll(): void {
    for (const taskId of [...this.sessions.keys(), ...this.spawning.keys()]) this.dispose(taskId)
  }

  private async enqueue<T>(session: Session, operation: () => Promise<T>): Promise<T> {
    const next = session.queue.then(operation, operation)
    session.queue = next.then(() => undefined, () => undefined)
    return await next
  }

  private async advance(spawn: Promise<Session>): Promise<Session> {
    try { return await spawn }
    finally { this.spawning.delete([...this.spawning.entries()]
      .find(([, value]) => value === spawn)?.[0] ?? '') }
  }

  private async ensureSession(taskId: string): Promise<Session> {
    const existing = this.sessions.get(taskId)
    if (existing) return existing
    const inFlight = this.spawning.get(taskId)
    if (inFlight) return await inFlight
    const spawning = this.createSession(taskId)
    this.spawning.set(taskId, spawning)
    try { return await spawning }
    finally { if (this.spawning.get(taskId) === spawning) this.spawning.delete(taskId) }
  }

  private async createSession(taskId: string): Promise<Session> {
    const child = await this.options.spawn(taskId)
    const session: Session = {
      taskId, child, buffer: '', pending: new Map(), nextId: 1, active: null,
      queue: Promise.resolve(), stderr: []
    }
    this.sessions.set(taskId, session)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(taskId, chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      session.stderr.push(chunk)
      if (session.stderr.length > 40) session.stderr.shift()
    })
    child.on('exit', () => {
      if (this.sessions.get(taskId) !== session) return
      this.sessions.delete(taskId)
      const detail = session.stderr.join('').trim()
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timeout)
        pending.settle(new Error(
          `ENGINE_UNAVAILABLE: js entry exited${detail ? ` (${detail.slice(0, 400)})` : ''}`))
      }
      session.pending.clear()
      void this.options.close?.(taskId)
    })
    child.on('error', () => this.dispose(taskId))
    return session
  }

  private async awaitCell(
    session: Session,
    id: number,
    code: string | undefined,
    limits: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined }
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        const pending = session.pending.get(id)
        if (!pending) return
        session.pending.delete(id)
        clearTimeout(pending.timeout)
        limits.signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () => {
        finish(new Error('CANCELLED: js call cancelled'))
        this.dispose(session.taskId)
      }
      limits.signal?.addEventListener('abort', onAbort, { once: true })
      session.pending.set(id, {
        settle: (error) => finish(error),
        timeout: setTimeout(() => {
          finish(new Error('TIMED_OUT: js call exceeded its time budget'))
          this.dispose(session.taskId)
        }, limits.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS)
      })
      const message = code === undefined ? { id, reset: true } : { id, code }
      session.child.stdin.write(`${JSON.stringify(message)}\n`)
      if (limits.signal?.aborted) onAbort()
    })
  }

  private receive(taskId: string, chunk: string): void {
    const session = this.sessions.get(taskId)
    if (!session) return
    session.buffer += chunk
    for (let newline = session.buffer.indexOf('\n'); newline >= 0;
         newline = session.buffer.indexOf('\n')) {
      const line = session.buffer.slice(0, newline)
      session.buffer = session.buffer.slice(newline + 1)
      if (!line) continue
      let message: Record<string, unknown>
      try { message = JSON.parse(line) as Record<string, unknown> } catch { continue }
      if (message.type === 'text' && typeof message.text === 'string') {
        session.active?.collected.push(message.text)
        session.active?.events.text(message.text)
        continue
      }
      if (message.type === 'image' && typeof message.base64 === 'string') {
        session.active?.events.image(Buffer.from(message.base64, 'base64'),
          typeof message.mimeType === 'string' ? message.mimeType : 'image/png')
        continue
      }
      if (message.type === 'call') {
        const callId = Number(message.id)
        const method = String(message.method)
        void this.options.callSky(taskId, method, message.args).then(
          (value) => session.child.stdin.write(`${JSON.stringify({
            type: 'callResult', id: callId, ok: true, value: value ?? null
          })}\n`),
          (error: unknown) => session.child.stdin.write(`${JSON.stringify({
            type: 'callResult', id: callId, ok: false,
            error: error instanceof Error ? error.message : String(error)
          })}\n`)
        )
        continue
      }
      const pending = session.pending.get(Number(message.id))
      if (!pending) continue
      if (message.ok === true) pending.settle()
      else pending.settle(new Error(
        typeof message.error === 'string' ? message.error : 'js call failed'))
    }
  }
}
