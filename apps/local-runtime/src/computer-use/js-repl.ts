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

export type JsRunOutcome = { kind: 'completed'; output: string }

type CellWaiter = (outcome: JsRunOutcome | Error) => void

type Session = {
  taskId: string
  child: JsReplChild
  buffer: string
  /** Cell id -> waiter for its completion. */
  cells: Map<number, CellWaiter>
  nextId: number
  lastCallId: number
  /** Where the running cell writes text and images. */
  active: { events: JsReplEvents; collected: string[]; cellId: number; controller: AbortController; pauseTimer?: () => void; resumeTimer?: () => void } | null
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
  private readonly spawningControllers = new Map<string, AbortController>()

  constructor(private readonly options: {
    spawn(taskId: string, signal: AbortSignal): Promise<JsReplChild>
    /** Releases whatever `spawn` allocated (sandbox, temporary directory) after the child is gone. */
    close?(taskId: string, child: JsReplChild): Promise<void> | void
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
  ): Promise<JsRunOutcome> {
    const session = await this.ensureSession(taskId)
    return await this.enqueue(session, async () => {
      const id = session.nextId++
      return await this.runCell(session, id, { id, code }, options, { events, collected: [] })
    })
  }

  /** Only trusted host services may suspend the running cell budget. */
  async withSuspendedTimeout<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const active = this.sessions.get(taskId)?.active
    if (!active?.pauseTimer || !active.resumeTimer) throw new Error('COMPUTER_USE_CONTEXT_REQUIRED: no running cell')
    active.pauseTimer()
    try { return await operation() }
    finally { active.resumeTimer() }
  }

  /** Drops every binding of the task and starts a fresh context, keeping the child alive. */
  async reset(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId)
    if (!session) { this.dispose(taskId); return }
    // A running cell (possibly blocked on the user's app approval) cannot finish while it waits,
    // and `js_reset` promises a fresh session — so drop the child and let the next call start anew.
    if (session.active) {
      this.dispose(taskId)
      return
    }
    await this.enqueue(session, async () => {
      const id = session.nextId++
      await this.runCell(session, id, { id, reset: true },
        { signal: undefined, timeoutMs: 5_000 },
        { events: { text: () => {}, image: () => {} }, collected: [] })
    })
  }

  dispose(taskId: string): void {
    const session = this.sessions.get(taskId)
    this.sessions.delete(taskId)
    this.spawning.delete(taskId)
    this.spawningControllers.get(taskId)?.abort(new Error('ENGINE_UNAVAILABLE: js session closed'))
    this.spawningControllers.delete(taskId)
    if (!session) return
    for (const waiter of session.cells.values()) {
      waiter(new Error('ENGINE_UNAVAILABLE: js session closed'))
    }
    session.cells.clear()
    try { session.child.kill() } catch { /* already gone */ }
    void this.options.close?.(taskId, session.child)
  }

  disposeAll(): void {
    for (const taskId of [...this.sessions.keys(), ...this.spawning.keys()]) this.dispose(taskId)
  }

  private async enqueue<T>(session: Session, operation: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      if (this.sessions.get(session.taskId) !== session) throw new Error('ENGINE_UNAVAILABLE: js session closed')
      return await operation()
    }
    const next = session.queue.then(guarded, guarded)
    session.queue = next.then(() => undefined, () => undefined)
    return await next
  }

  private async ensureSession(taskId: string): Promise<Session> {
    const existing = this.sessions.get(taskId)
    if (existing) return existing
    const inFlight = this.spawning.get(taskId)
    if (inFlight) return await inFlight
    const controller = new AbortController()
    this.spawningControllers.set(taskId, controller)
    const spawning = this.createSession(taskId, controller.signal)
    this.spawning.set(taskId, spawning)
    try { return await spawning }
    finally {
      if (this.spawning.get(taskId) === spawning) this.spawning.delete(taskId)
      if (this.spawningControllers.get(taskId) === controller) this.spawningControllers.delete(taskId)
    }
  }

  private async createSession(taskId: string, signal: AbortSignal): Promise<Session> {
    const child = await this.options.spawn(taskId, signal)
    if (signal.aborted) {
      try { child.kill() } catch { /* already gone */ }
      await this.options.close?.(taskId, child)
      throw new Error('ENGINE_UNAVAILABLE: js session closed while starting')
    }
    const session: Session = {
      taskId, child, buffer: '', cells: new Map(), nextId: 1, active: null,
      queue: Promise.resolve(), stderr: [], lastCallId: 0
    }
    this.sessions.set(taskId, session)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.sessions.get(taskId) === session) this.receive(taskId, chunk)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      session.stderr.push(chunk)
      if (session.stderr.length > 40) session.stderr.shift()
    })
    child.on('exit', () => {
      if (this.sessions.get(taskId) !== session) return
      this.sessions.delete(taskId)
      const detail = session.stderr.join('').trim()
      for (const waiter of session.cells.values()) {
        waiter(new Error(
          `ENGINE_UNAVAILABLE: js entry exited${detail ? ` (${detail.slice(0, 400)})` : ''}`))
      }
      session.cells.clear()
      void this.options.close?.(taskId, session.child)
    })
    child.on('error', () => {
      if (this.sessions.get(taskId) === session) this.dispose(taskId)
    })
    return session
  }

  /** Runs one cell to completion within its time budget. */
  private async runCell(
    session: Session,
    cellId: number,
    message: Record<string, unknown>,
    limits: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined },
    run: { events: JsReplEvents; collected: string[] }
  ): Promise<JsRunOutcome> {
    const active = { events: run.events, collected: run.collected, cellId,
      controller: new AbortController() }
    session.active = active
    return await new Promise<JsRunOutcome>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let remaining = limits.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
      let started = performance.now()
      let suspended = 0
      let finished = false
      const finish = (outcome: JsRunOutcome | Error) => {
        if (session.cells.get(cellId) !== finish) return
        finished = true
        session.cells.delete(cellId)
        if (session.active?.cellId === cellId) session.active = null
        active.controller.abort(new Error('CANCELLED: js cell ended'))
        clearTimeout(timer)
        limits.signal?.removeEventListener('abort', onAbort)
        if (outcome instanceof Error) reject(outcome)
        else resolve({ kind: 'completed', output: run.collected.join('') })
      }
      const onAbort = () => {
        finish(new Error('CANCELLED: js call cancelled'))
        this.dispose(session.taskId)
      }
      session.cells.set(cellId, finish)
      limits.signal?.addEventListener('abort', onAbort, { once: true })
      // Waiting for the user's app approval is not part of the cell's budget: trusted host services
      // pause this timer while they wait and re-arm it with what is left.
      const arm = () => {
        started = performance.now()
        timer = setTimeout(() => {
          finish(new Error('TIMED_OUT: js call exceeded its time budget'))
          this.dispose(session.taskId)
        }, Math.max(0, remaining))
      }
      session.active!.pauseTimer = () => {
        if (finished || suspended++ > 0) return
        clearTimeout(timer)
        remaining -= performance.now() - started
      }
      session.active!.resumeTimer = () => {
        if (finished || --suspended > 0) return
        arm()
      }
      arm()
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
      if (typeof message !== 'object' || message === null || Array.isArray(message)) continue
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
        if (!session.active || !session.cells.has(session.active.cellId)) continue
        const callId = message.id
        if (typeof callId !== 'number' || !Number.isSafeInteger(callId) || callId <= session.lastCallId ||
            typeof message.method !== 'string') continue
        session.lastCallId = callId
        const method = message.method
        const active = session.active
        const isCurrent = () => this.sessions.get(taskId) === session && session.active === active &&
          !active.controller.signal.aborted && session.cells.has(active.cellId)
        void this.options.callSky(taskId, method, message.args, active.controller.signal).then(
          (value) => {
            if (!isCurrent()) return
            session.child.stdin.write(`${JSON.stringify({
            type: 'callResult', id: callId, ok: true, value: value ?? null
          })}\n`)
          },
          (error: unknown) => {
            if (!isCurrent()) return
            session.child.stdin.write(`${JSON.stringify({
              type: 'callResult', id: callId, ok: false,
              error: error instanceof Error ? error.message : String(error)
            })}\n`)
          }
        )
        continue
      }
      const waiter = session.cells.get(Number(message.id))
      if (!waiter) continue
      if (message.ok === true) waiter({ kind: 'completed', output: '' })
      else waiter(new Error(
        typeof message.error === 'string' ? message.error : 'js call failed'))
    }
  }
}
