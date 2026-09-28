import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import type { SessionWorkspacePaths } from '@actiondriver/runtime-contracts'
import { SessionSandbox, type SandboxPrepared } from '../execution/session-sandbox'
import { resolveExecutionRuntimePaths } from '../execution/runtime-paths'
import type { AppApprovalBroker } from './app-approval-broker'
import { ApplicationLeases } from './application-leases'
import { createOwnedSkySession } from './owned-sky-session'
import type { ComputerCallContext } from './call-context'
import { JsReplHost, type JsReplChild, type JsReplEvents } from './js-repl'
import { COMPUTER_USE_GUIDANCE_ERRORS } from '../tool-error-exposure'

type Context = { taskId: string; sessionId: string; workspace: SessionWorkspacePaths }
type Sky = ReturnType<typeof createOwnedSkySession>
type Session = {
  id: string
  workspace: SessionWorkspacePaths
  turns: Set<string>
  browserTasks: Set<string>
  lastUsed: number
  queue: Promise<unknown>
  active: ComputerCallContext | undefined
  executedText: ((length: number) => void) | undefined
  /** Writes host notices into the running cell's output. */
  notice: ((text: string) => void) | undefined
  /** Set when the user stopped Computer Use with Esc; the session is retired once the cell ends. */
  stopped?: boolean
}
type Resources = { child: JsReplChild; sandbox: SandboxPrepared; sky: Sky; screenshots: number }
const IDLE_MS = 30 * 60_000
const MAX_SESSIONS = 4

/** Trusted per-conversation owner; model code sees only the child JSON RPC transport. */
export function createCuaRuntime(options: {
  runtimeDist: string
  entryPath?: string
  broker: AppApprovalBroker
  invoke(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  invokeBrowser?(taskId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  browserSkillLoaded?(sessionId: string): boolean
  computerSkillLoaded?(sessionId: string): boolean
  assertRunning(taskId: string): void
  /** Interrupts the running turn, e.g. after the user ended Computer Use with Esc. */
  stopTask?(taskId: string): void
  clearSkill(sessionId: string): void
  clearImages?(sessionId: string): void
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const sessions = new Map<string, Session>()
  const tasks = new Map<string, Session>()
  const resources = new Map<string, Resources>()
  const cleanups = new Set<Promise<void>>()
  const leases = new ApplicationLeases()
  /** Turns that already asked the helper to show the overlay and listen for Esc (D7). */
  const supervised = new Map<string, string>()
  const entryPath = options.entryPath ?? join(options.runtimeDist, 'js-repl/repl-server.mjs')
  const sandbox = new SessionSandbox({
    runtimeRoots: [options.runtimeDist, dirname(entryPath)]
  })
  let disposed = false

  const track = (operation: Promise<void>) => {
    cleanups.add(operation)
    void operation.finally(() => cleanups.delete(operation)).catch(() => {})
    return operation
  }
  const assertRunning = (taskId: string) => {
    const session = tasks.get(taskId)
    if (!session || session.active?.taskId !== taskId) throw new Error('CANCELLED: turn ended')
    options.assertRunning(taskId)
  }
  /** One deliberate start per turn, so an Esc stop is only cleared by the next turn (D7). */
  const startSupervision = async (taskId: string, sessionId: string) => {
    if (supervised.has(taskId)) return
    supervised.set(taskId, sessionId)
    try {
      await options.invoke({ operation: 'session-start', sessionId })
    } catch {
      // The overlay is best effort: a helper that cannot show it must not fail the turn.
    }
  }
  const endSupervision = async (taskIds: Iterable<string>) => {
    const sessionIds = new Set<string>()
    for (const task of taskIds) {
      const sessionId = supervised.get(task)
      if (sessionId !== undefined) sessionIds.add(sessionId)
      supervised.delete(task)
    }
    for (const sessionId of sessionIds) {
      try {
        await options.invoke({ operation: 'session-end', sessionId })
      } catch {
        // The helper may already be gone; nothing else depends on the overlay.
      }
    }
  }
  const retire = (session: Session): Promise<void> => {
    if (sessions.get(session.id) !== session) return Promise.resolve()
    sessions.delete(session.id)
    const supervisedTurns = [...session.turns]
    const browserTasks = [...session.browserTasks]
    for (const task of session.turns) if (tasks.get(task) === session) tasks.delete(task)
    session.turns.clear()
    leases.releaseSession(session.id)
    options.clearSkill(session.id)
    options.clearImages?.(session.id)
    host.dispose(session.id)
    return track(
      Promise.all([endSupervision(supervisedTurns), options.broker.endSession(session.id),
        ...browserTasks.map(async (taskId) => {
          try { await options.invokeBrowser?.(taskId, { type: 'close_task' }) }
          catch { /* The desktop may already be closing. */ }
        })]).then(
        () => undefined
      )
    )
  }
  const host = new JsReplHost({
    spawn: async (sessionId, signal) => {
      let finished!: () => void
      const startup = new Promise<void>((resolve) => {
        finished = resolve
      })
      cleanups.add(startup)
      try {
        const session = sessions.get(sessionId)
        if (!session) throw new Error('ENGINE_UNAVAILABLE: session closed')
        const paths = await resolveExecutionRuntimePaths(options.runtimeDist, undefined, ['node'])
        signal.throwIfAborted()
        const prepared = await sandbox.prepare({
          workspace: session.workspace,
          jsExecutable: paths.node
        })
        try {
          signal.throwIfAborted()
          const sky = createOwnedSkySession({
            broker: options.broker,
            leases,
            assertRunning,
            invoke: options.invoke,
            onExecutedText: (context, text) => {
              const current = sessions.get(context.sessionId)
              if (current?.active?.taskId === context.taskId) current.executedText?.(text.length)
            },
            onNotice: (context, text) => {
              const current = sessions.get(context.sessionId)
              if (current?.active?.taskId === context.taskId) current.notice?.(text)
            }
          })
          signal.throwIfAborted()
          const wrapped = prepared.wrap(paths.node, [
            '--experimental-vm-modules',
            '--no-warnings',
            entryPath
          ])
          const child = spawn(wrapped.executable, wrapped.args, {
            cwd: session.workspace.root,
            env: prepared.environment,
            stdio: ['pipe', 'pipe', 'pipe']
          }) as unknown as JsReplChild
          resources.set(sessionId, { child, sandbox: prepared, sky, screenshots: 0 })
          return child
        } catch (error) {
          await prepared.dispose()
          throw error
        }
      } finally {
        finished()
        cleanups.delete(startup)
      }
    },
    close: (id, child) => {
      const resource = resources.get(id)
      if (!resource || resource.child !== child) return
      resources.delete(id)
      // Host timeout/exit also ends approval, Skill and instruction state.
      const session = sessions.get(id)
      if (session) void retire(session)
      return track(resource.sandbox.dispose())
    },
    callSky: async (id, method, input, signal) => {
      const session = sessions.get(id)
      const resource = resources.get(id)
      if (!session?.active || !resource)
        throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.contextRequired)
      const context = { ...session.active, ...(signal === undefined ? {} : { signal }) }
      assertRunning(context.taskId)
      if (method === 'browser_rpc') {
        if (!options.browserSkillLoaded?.(context.sessionId))
          throw new Error('BROWSER_SKILL_NOT_LOADED: read the browser-use Skill first')
        if (!options.invokeBrowser) throw new Error('BROWSER_SESSION_UNAVAILABLE')
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('BROWSER_RPC_INVALID')
        session.browserTasks.add(context.taskId)
        const result = await options.invokeBrowser(context.taskId,
          input as Record<string, unknown>, signal)
        assertRunning(context.taskId)
        return result
      }
      if (method !== 'computer_rpc') throw new Error('INVALID_REQUEST: unsupported CUA RPC')
      if (options.computerSkillLoaded && !options.computerSkillLoaded(context.sessionId))
        throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded)
      try {
        return await resource.sky.invoke(input, context)
      } catch (error) {
        // Esc ends the Computer Use session (D7, 2.11): bindings, approvals, leases and screenshots
        // go with it, so a later turn starts over and asks the user again. Interrupting the task
        // itself stays with the control gate and is wired separately.
        if (String((error as Error)?.message ?? '').includes('USER_STOPPED_SESSION') && !session.stopped) {
          session.stopped = true
          options.stopTask?.(context.taskId)
        }
        throw error
      }
    }
  })
  const drainCleanups = async () => {
    while (cleanups.size) await Promise.all([...cleanups])
  }
  const sweep = async () => {
    await Promise.all(
      [...sessions.values()]
        .filter((session) => session.turns.size === 0 && now() - session.lastUsed > IDLE_MS)
        .map(retire)
    )
    await drainCleanups()
  }
  const timer = setInterval(() => {
    void sweep().catch(() => {})
  }, 60_000)
  timer.unref()

  return {
    async run(
      context: Context,
      code: string,
      limits: { timeoutMs?: number; signal?: AbortSignal },
      events: JsReplEvents & { executedText?(length: number): void }
    ) {
      if (disposed) throw new Error('ENGINE_UNAVAILABLE: runtime closed')
      if (!context.taskId || !context.sessionId)
        throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.contextRequired)
      const bound = tasks.get(context.taskId)
      if (bound && bound.id !== context.sessionId)
        throw new Error('INVALID_REQUEST: task session changed')
      const maintenance = sweep()
      if (disposed) throw new Error('ENGINE_UNAVAILABLE: runtime closed')
      let session = sessions.get(context.sessionId)
      if (!session) {
        while (sessions.size >= MAX_SESSIONS) void retire(sessions.values().next().value!)
        if (disposed) throw new Error('ENGINE_UNAVAILABLE: runtime closed')
        session = {
          id: context.sessionId,
          workspace: context.workspace,
          turns: new Set(),
          browserTasks: new Set(),
          lastUsed: now(),
          queue: Promise.resolve(),
          active: undefined,
          executedText: undefined,
          notice: undefined
        }
        sessions.set(session.id, session)
      }
      // Touch insertion order for LRU; retain the first trusted workspace across turns.
      sessions.delete(session.id)
      sessions.set(session.id, session)
      session.turns.add(context.taskId)
      tasks.set(context.taskId, session)
      const current = session
      const operation = async () => {
        await maintenance
        if (sessions.get(current.id) !== current || tasks.get(context.taskId) !== current)
          throw new Error('ENGINE_UNAVAILABLE: turn or session closed')
        limits.signal?.throwIfAborted()
        options.assertRunning(context.taskId)
        current.active = { taskId: context.taskId, sessionId: current.id }
        current.executedText = events.executedText
        current.notice = (text) => events.text(text)
        await startSupervision(context.taskId, current.id)
        try {
          return await host.run(current.id, code, limits, events)
        } finally {
          current.active = undefined
          current.executedText = undefined
          current.notice = undefined
          current.lastUsed = now()
          if (current.stopped) void retire(current)
        }
      }
      const running = current.queue.then(operation, operation)
      current.queue = running.then(
        () => undefined,
        () => undefined
      )
      return await running
    },
    withSuspendedTimeout<T>(taskId: string, operation: () => Promise<T>) {
      const session = tasks.get(taskId)
      if (!session || session.active?.taskId !== taskId)
        throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.contextRequired)
      return host.withSuspendedTimeout(session.id, operation)
    },
    async endTurn(taskId: string) {
      const session = tasks.get(taskId)
      // Invalidate queued cells before cancelling any pending approval.
      tasks.delete(taskId)
      if (session) {
        session.turns.delete(taskId)
        session.lastUsed = now()
      }
      await options.broker.cancelTask(taskId)
      leases.releaseTurn(taskId)
      // Hiding the overlay is part of the per-turn wrap-up (D4); the sessions themselves persist.
      await endSupervision([taskId])
    },
    async reset(sessionId: string) {
      const session = sessions.get(sessionId)
      if (session) await retire(session)
      else {
        options.clearSkill(sessionId)
        options.clearImages?.(sessionId)
        await options.broker.endSession(sessionId)
      }
      await drainCleanups()
    },
    sweep,
    async dispose() {
      disposed = true
      clearInterval(timer)
      await Promise.all([...sessions.values()].map(retire))
      await drainCleanups()
    }
  }
}
