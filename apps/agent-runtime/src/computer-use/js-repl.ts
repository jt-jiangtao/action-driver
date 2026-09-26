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

/** One desktop action a cell is waiting for, with the position it appeared in. */
export type JsApprovalAction = { index: number; method: string; args: unknown }

export type JsRunOutcome =
  | { kind: 'completed'; output: string }
  | { kind: 'approval'; action: JsApprovalAction }

/**
 * Raised by the `callSky` implementation when an action may not run without the user's consent.
 * The host turns it into a suspended cell instead of an error inside the cell.
 */
export class ApprovalRequiredError extends Error {
  readonly code = 'APPROVAL_REQUIRED'

  constructor(readonly action: { method: string; args: unknown }) {
    super(`APPROVAL_REQUIRED: ${action.method} needs the user's confirmation`)
    this.name = 'ApprovalRequiredError'
  }
}

type CellWaiter = (outcome: JsRunOutcome | Error) => void

/** A cell that stopped on an action: the child keeps running, the promise inside it stays pending. */
type Suspended = {
  cellId: number
  callId: number
  action: JsApprovalAction
  events: JsReplEvents
  collected: string[]
  actions: number
}

type Session = {
  taskId: string
  child: JsReplChild
  buffer: string
  /** Cell id -> waiter for its completion or its next approval request. */
  cells: Map<number, CellWaiter>
  nextId: number
  /** Where the running cell writes text and images. */
  active: { events: JsReplEvents; collected: string[]; cellId: number; actions: number } | null
  suspended: Suspended | null
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
  ): Promise<JsRunOutcome> {
    const session = await this.ensureSession(taskId)
    return await this.enqueue(session, async () => {
      if (session.suspended) throw new Error(
        'ENGINE_UNAVAILABLE: the cell is waiting for an approval; answer it before running another')
      const id = session.nextId++
      return await this.runCell(session, id, { id, code }, options,
        { events, collected: [], actions: 0 })
    })
  }

  /** Answers the action a cell stopped on and lets the same cell continue where it left off. */
  async continueRun(
    taskId: string,
    decision: {
      action: JsApprovalAction
      approved: boolean
      /** Performs the approved action; its result becomes the value the suspended call resolves to. */
      perform?: () => Promise<unknown>
    },
    options: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined }
  ): Promise<JsRunOutcome> {
    const session = await this.ensureSession(taskId)
    return await this.enqueue(session, async () => {
      const suspended = session.suspended
      if (!suspended) throw new Error(
        'ENGINE_UNAVAILABLE: no cell is waiting for an approval')
      if (suspended.action.index !== decision.action.index ||
          suspended.action.method !== decision.action.method) {
        throw new Error('APPROVAL_STALE: the cell is waiting for a different action')
      }
      session.suspended = null
      if (decision.approved) {
        let value: unknown = null
        if (decision.perform) value = await decision.perform()
        return await this.runCell(session, suspended.cellId, {
          type: 'callResult', id: suspended.callId, ok: true, value: value ?? null
        }, options, suspended)
      }
      return await this.runCell(session, suspended.cellId, {
        type: 'callResult', id: suspended.callId, ok: false,
        error: `USER_DENIED: the user declined ${suspended.action.method}`
      }, options, suspended)
    })
  }

  /** Drops every binding of the task and starts a fresh context, keeping the child alive. */
  async reset(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId)
    if (!session) return
    // A cell that is waiting for approval cannot finish while it waits, and `js_reset` promises a
    // fresh session — so drop the child and let the next call start a new one.
    if (session.suspended) {
      this.dispose(taskId)
      return
    }
    await this.enqueue(session, async () => {
      const id = session.nextId++
      session.suspended = null
      await this.runCell(session, id, { id, reset: true },
        { signal: undefined, timeoutMs: 5_000 },
        { events: { text: () => {}, image: () => {} }, collected: [], actions: 0 })
    })
  }

  dispose(taskId: string): void {
    const session = this.sessions.get(taskId)
    this.sessions.delete(taskId)
    this.spawning.delete(taskId)
    if (!session) return
    for (const waiter of session.cells.values()) {
      waiter(new Error('ENGINE_UNAVAILABLE: js session closed'))
    }
    session.cells.clear()
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
      taskId, child, buffer: '', cells: new Map(), nextId: 1, active: null, suspended: null,
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
      for (const waiter of session.cells.values()) {
        waiter(new Error(
          `ENGINE_UNAVAILABLE: js entry exited${detail ? ` (${detail.slice(0, 400)})` : ''}`))
      }
      session.cells.clear()
      void this.options.close?.(taskId)
    })
    child.on('error', () => this.dispose(taskId))
    return session
  }

  /**
   * Waits for one turn of a cell: either it finishes, or it stops on an action that needs approval.
   *
   * A stop does not end the cell — the child keeps the suspended promise alive — so the answer can
   * be delivered later without replaying anything the cell already did.
   */
  private async runCell(
    session: Session,
    cellId: number,
    message: Record<string, unknown>,
    limits: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined },
    run: { events: JsReplEvents; collected: string[]; actions: number }
  ): Promise<JsRunOutcome> {
    session.active = { events: run.events, collected: run.collected, cellId, actions: run.actions }
    return await new Promise<JsRunOutcome>((resolve, reject) => {
      const finish = (outcome: JsRunOutcome | Error) => {
        if (session.cells.get(cellId) !== finish) return
        session.cells.delete(cellId)
        clearTimeout(timer)
        limits.signal?.removeEventListener('abort', onAbort)
        if (outcome instanceof Error) reject(outcome)
        else resolve(outcome.kind === 'completed'
          ? { kind: 'completed', output: run.collected.join('') }
          : outcome)
      }
      const onAbort = () => {
        finish(new Error('CANCELLED: js call cancelled'))
        this.dispose(session.taskId)
      }
      session.cells.set(cellId, finish)
      limits.signal?.addEventListener('abort', onAbort, { once: true })
      // Waiting for the user is not part of the cell's budget: this timer is cleared when the cell
      // stops for approval, and the continuation arms a fresh one.
      const timer = setTimeout(() => {
        finish(new Error('TIMED_OUT: js call exceeded its time budget'))
        this.dispose(session.taskId)
      }, limits.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS)
      session.child.stdin.write(`${JSON.stringify(message)}\n`)
      if (limits.signal?.aborted) onAbort()
    })
  }

  /** Stops the running cell on an action and hands the request to the caller. */
  private suspend(session: Session, callId: number, action: { method: string; args: unknown }): void {
    const active = session.active
    if (!active) return
    const suspended: Suspended = {
      cellId: active.cellId,
      callId,
      action: { index: active.actions, method: action.method, args: action.args },
      events: active.events,
      collected: active.collected,
      actions: active.actions + 1
    }
    session.suspended = suspended
    session.active = null
    session.child.stdin.write(`${JSON.stringify({ type: 'approvalRequired', id: callId })}\n`)
    session.cells.get(suspended.cellId)?.({ kind: 'approval', action: suspended.action })
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
          (error: unknown) => {
            if (error instanceof ApprovalRequiredError) {
              this.suspend(session, callId, error.action)
              return
            }
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
