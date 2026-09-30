import type { PersistedStreamRequest, RuntimeTaskRecord } from '@action-driver/agent-runtime/ports'
import type { RolloutSessionState } from './fold'
import type { RolloutLine, RolloutLineDraft } from './model'
import type { RolloutProjection } from './projection'
import type { RolloutWriter } from './log'

export type SessionRuntime = {
  sessionId: string
  path: string
  writer: RolloutWriter
  lines: RolloutLine[]
  state: RolloutSessionState
}

/** Shared access to the store's sole in-memory state and append operation. */
export type RolloutStoreContext = {
  readonly requests: Map<string, PersistedStreamRequest>
  readonly taskSessions: Map<string, string>
  readonly projection: RolloutProjection
  now(): string
  ensureRuntime(sessionId: string): SessionRuntime | null
  runtimeFor(sessionId: string, task: RuntimeTaskRecord): SessionRuntime
  appendLines(runtime: SessionRuntime, lines: readonly RolloutLineDraft[]): void
}
