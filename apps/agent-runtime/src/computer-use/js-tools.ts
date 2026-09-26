import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ImageAssetRef } from '@actiondriver/contracts'
import type {
  SessionWorkspacePaths,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
  ToolExecutorEvent
} from '@actiondriver/runtime-contracts'
import { SessionSandbox, type SandboxPrepared } from '../execution/session-sandbox'
import { resolveExecutionRuntimePaths } from '../execution/runtime-paths'
import { CONSEQUENTIAL_SKY_METHODS } from './cell-actions'
import type { ComputerUseControlGate } from './control-gate'
import {
  ApprovalRequiredError,
  JsReplHost,
  type JsApprovalAction,
  type JsReplChild,
  type JsReplEvents,
  type JsRunOutcome
} from './js-repl'
import { createSkySession, type SkySession } from './sky-session'
import { ToolApprovalRequired } from './tool-approval'

type Registered = { definition: ToolDefinition; executor: ToolExecutor }
type Json = Parameters<NonNullable<ToolExecutor['redactForPersistence']>>[1]
type JsonRecord = { [key: string]: Json }

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type TaskSession = {
  sandbox: SandboxPrepared
  sky: SkySession
  screenshots: number
}

/** Sessions are per task; a fifth task evicts the oldest so helper children cannot pile up. */
const MAX_SESSIONS = 4

const JS_DESCRIPTION =
  'Execute JavaScript in a persistent entry with top-level await. Top-level bindings persist until ' +
  'js_reset and can be redeclared. Import Computer Use with `const { sky } = await import("@oai/sky")`; ' +
  '`sky` and `nodeRepl` are also available as globals. Use `nodeRepl.write(value)` for output and ' +
  '`nodeRepl.emitImage({ bytes, mimeType })` for images. Screenshots are written to files and ' +
  'returned as `screenshot.url` file URLs. Files can be written under `output/`; the working ' +
  'directory itself is read-only. Top-level static imports and node:process are unavailable. ' +
  'A call that reaches a method changing the desktop (click, drag, paste, press_key, select_text, ' +
  'set_value, type_text, perform_secondary_action) stops and asks the user before that action runs; ' +
  'keep one such action per call, since a second one is refused with COMPUTER_ACTION_SPLIT_REQUIRED. ' +
  'Observation-only calls run without a prompt, and a denied action comes back as USER_DENIED.'

const jsSchema: ToolDefinition['inputSchema'] = {
  type: 'object',
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 200_000 },
    timeout_ms: { type: 'integer', minimum: 1_000, maximum: 300_000 },
    title: { type: 'string', maxLength: 200 }
  },
  required: ['code'],
  additionalProperties: false
}

export function createJsEntryTools(options: {
  runtimeDist: string
  arch?: NodeJS.Architecture
  sandbox?: SessionSandbox
  /** Runs one native helper request; the same provider the `computer_*` tools use. */
  invokeComputer: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
  /** Stores one emitted image and returns the asset the model should receive. */
  saveImage: (sessionId: string, bytes: Uint8Array) => Promise<ImageAssetRef>
  skillLoaded?: (taskId: string) => boolean
  gate?: ComputerUseControlGate
  defaultTimeoutMs?: number
  environment?: NodeJS.ProcessEnv
}): { tools: Registered[]; dispose(): void } {
  const sandbox = options.sandbox ?? new SessionSandbox({ runtimeRoots: [options.runtimeDist] })
  const sessions = new Map<string, TaskSession>()
  const workspaces = new Map<string, SessionWorkspacePaths>()
  /** The action a task's cell stopped on, so the resumed call knows what it is answering. */
  const pendingApprovals = new Map<string, JsApprovalAction>()

  const skyFor = (taskId: string): SkySession => {
    const session = sessions.get(taskId)
    if (!session) throw new Error('ENGINE_UNAVAILABLE: the js entry is not running')
    return session.sky
  }

  const host = new JsReplHost({
    spawn: async (taskId) => await spawnChild(taskId),
    close: (taskId) => {
      const session = sessions.get(taskId)
      if (!session) return
      sessions.delete(taskId)
      workspaces.delete(taskId)
      pendingApprovals.delete(taskId)
      session.sky.dispose()
      void session.sandbox.dispose()
    },
    // Every desktop action from inside the cell stops here for the user's answer; the approved one is
    // performed by the resumed call itself, which is why this path never performs one directly.
    callSky: async (taskId, method, args, signal) => {
      if (CONSEQUENTIAL_SKY_METHODS.includes(method as typeof CONSEQUENTIAL_SKY_METHODS[number])) {
        throw new ApprovalRequiredError({ method, args })
      }
      return await skyFor(taskId).invoke(method, args, signal)
    },
    ...(options.defaultTimeoutMs === undefined
      ? {} : { defaultTimeoutMs: options.defaultTimeoutMs })
  })

  async function spawnChild(taskId: string): Promise<JsReplChild> {
    const workspace = workspaces.get(taskId)
    if (!workspace) throw new Error('COMPUTER_USE_CONTEXT_REQUIRED')
    while (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next()
      if (oldest.done) break
      host.dispose(oldest.value)
    }
    const paths = await resolveExecutionRuntimePaths(options.runtimeDist, options.arch, ['node'])
    const prepared = await sandbox.prepare({
      workspace,
      ...(options.environment === undefined ? {} : { environment: options.environment })
    })
    const sky = createSkySession({
      invoke: async (input, signal) => await options.invokeComputer(input, signal),
      writeScreenshot: async (bytes, mimeType) => {
        const session = sessions.get(taskId)
        if (!session) throw new Error('ENGINE_UNAVAILABLE: the js entry is not running')
        const extension = mimeType === 'image/png' ? 'png' : 'jpg'
        const path = join(session.sandbox.tempDirectory,
          `computer-use-${session.screenshots++}.${extension}`)
        await writeFile(path, bytes)
        return pathToFileURL(path).href
      }
    })
    sessions.set(taskId, { sandbox: prepared, sky, screenshots: 0 })
    const wrapped = prepared.wrap(paths.node, [
      '--experimental-vm-modules', '--no-warnings',
      join(options.runtimeDist, 'js-repl', 'repl-server.mjs')
    ])
    return spawn(wrapped.executable, wrapped.args, {
      cwd: workspace.root, env: prepared.environment, stdio: ['pipe', 'pipe', 'pipe']
    }) as unknown as JsReplChild
  }

  /**
   * Drives the cell: delivers the decisions the suspended work has not seen, reports the action it
   * is waiting for, or starts a fresh cell.
   *
   * A resumed graph replays the call from the start and passes every decision again, so decisions
   * older than the action the cell is waiting for are simply skipped — the action is performed on
   * the way in, exactly once, and the cell continues from the point it paused.
   */
  async function continueOrStart(
    execution: ToolExecutionContext,
    code: string,
    limits: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined },
    events: JsReplEvents,
    signal?: AbortSignal
  ): Promise<JsRunOutcome> {
    const taskId = execution.taskId
    for (const decision of execution.continuation?.decisions ?? []) {
      const waiting = pendingApprovals.get(taskId)
      if (!waiting) break
      if (decision.actionIndex < waiting.index) continue
      if (decision.actionIndex > waiting.index) {
        throw new Error(
          `APPROVAL_STALE: the cell waits for action ${waiting.index}, not ${decision.actionIndex}`)
      }
      pendingApprovals.delete(taskId)
      const outcome = await host.continueRun(taskId, {
        action: waiting,
        approved: decision.approved,
        ...(decision.approved
          ? { perform: async () => await skyFor(taskId).invoke(waiting.method, waiting.args, signal,
              { allowActions: true }) }
          : {})
      }, limits)
      if (outcome.kind === 'approval') {
        pendingApprovals.set(taskId, outcome.action)
        throw new ToolApprovalRequired(outcome.action)
      }
      return outcome
    }
    // The cell is already waiting on an action the user has not answered: report it again instead of
    // starting a second cell on top of it.
    const waiting = pendingApprovals.get(taskId)
    if (waiting) throw new ToolApprovalRequired(waiting)
    return await host.run(taskId, code, limits, events)
  }

  const requireSkill = (context: ToolExecutionContext | undefined): void => {
    if (!options.skillLoaded) return
    if (!context?.taskId) throw new Error('COMPUTER_USE_CONTEXT_REQUIRED')
    if (!options.skillLoaded(context.taskId)) {
      throw new Error(
        'SKILL_NOT_LOADED: read the computer-use Skill with skill_read before using Computer Use')
    }
  }

  const jsTool: Registered = {
    definition: {
      id: 'computer.js', version: 1, modelName: 'js',
      description: JS_DESCRIPTION, inputSchema: jsSchema, risk: 'high' as const,
      sideEffects: { filesystem: 'write' as const, network: true }, timeoutMs: 320_000
    },
    executor: {
      async *execute(call: ToolCall, signal?: AbortSignal,
                     context?: ToolExecutionContext): AsyncIterable<ToolExecutorEvent> {
        requireSkill(context)
        if (!context?.workspace?.root) throw new Error('COMPUTER_USE_CONTEXT_REQUIRED')
        const execution = context
        options.gate?.assertRunning(execution.taskId)
        const { code, timeoutMs } = readInput(call.arguments)
        workspaces.set(execution.taskId, execution.workspace)
        const limits = { ...(signal === undefined ? {} : { signal }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }) }

        const queue: ToolExecutorEvent[] = []
        // Held in one object so the closures below and the loop after them agree on every value.
        const state: {
          notify: (() => void) | null
          finished: boolean
          failure: Error | null
          images: number
        } = { notify: null, finished: false, failure: null, images: 0 }
        const push = (event: ToolExecutorEvent) => {
          queue.push(event)
          state.notify?.()
          state.notify = null
        }
        const running = (async () => {
          try {
            const events = {
              text: (chunk: string) => push({ kind: 'content' as const, stream: 'result' as const,
                delta: chunk }),
              image: (bytes: Buffer) => {
                const index = state.images++
                void options.saveImage(execution.sessionId, bytes).then(
                  (asset) => push({ kind: 'asset', index, asset }),
                  (error: unknown) => {
                    state.failure ??= error instanceof Error ? error : new Error(String(error))
                  }
                )
              }
            }
            const outcome = await continueOrStart(execution, code, limits, events, signal)
            if (outcome.kind === 'approval') {
              // Stop the tool call here; the graph asks the user and resumes this same cell.
              pendingApprovals.set(execution.taskId, outcome.action)
              throw new ToolApprovalRequired(outcome.action)
            }
            push({ kind: 'result', output: { output: outcome.output } })
          } catch (error) {
            state.failure = error instanceof Error ? error : new Error(String(error))
          } finally {
            state.finished = true
            state.notify?.()
            state.notify = null
          }
        })()
        while (!state.finished || queue.length > 0) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => { state.notify = resolve })
            continue
          }
          yield queue.shift()!
        }
        await running
        if (state.failure) throw state.failure
      },
      // The code is the model's own instruction, like a shell script; what it reads off the screen is
      // what must stay out of history.
      redactForPersistence: (kind: 'input' | 'output', value: Json): Json => {
        if (kind === 'input') return value
        const output = isRecord(value) && typeof value.output === 'string' ? value.output : ''
        return { outputLength: output.length }
      }
    }
  }

  const resetTool: Registered = {
    definition: {
      id: 'computer.js_reset', version: 1, modelName: 'js_reset',
      description: 'Reset the persistent js entry. All bindings are discarded; the next js call ' +
        'starts a fresh session, which does not close apps or erase their state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'low' as const, sideEffects: { filesystem: 'none' as const, network: false },
      timeoutMs: 10_000
    },
    executor: {
      async *execute(_call: ToolCall, _signal?: AbortSignal,
                     context?: ToolExecutionContext): AsyncIterable<ToolExecutorEvent> {
        if (!context?.taskId) throw new Error('COMPUTER_USE_CONTEXT_REQUIRED')
        await host.reset(context.taskId)
        yield { kind: 'result', output: { reset: true } }
      }
    }
  }

  return {
    tools: [jsTool, resetTool],
    // The host owns the child processes for the runtime's lifetime; shutdown releases them.
    dispose() {
      host.disposeAll()
      for (const session of sessions.values()) {
        session.sky.dispose()
        void session.sandbox.dispose()
      }
      sessions.clear()
    }
  }
}

function readInput(input: JsonRecord): { code: string; timeoutMs?: number } {
  const allowed = ['code', 'timeout_ms', 'title']
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('TOOL_INPUT_INVALID')
  const code = input.code
  if (typeof code !== 'string' || code.trim().length === 0) throw new Error('TOOL_INPUT_INVALID')
  const raw = input.timeout_ms
  if (raw === undefined) return { code }
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1_000 || raw > 300_000) {
    throw new Error('TOOL_INPUT_INVALID')
  }
  return { code, timeoutMs: raw }
}
