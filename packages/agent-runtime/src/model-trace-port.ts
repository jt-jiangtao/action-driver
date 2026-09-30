import type { ModelRef } from '@action-driver/contracts'

export type ModelTraceStart = {
  id: string
  sessionId: string
  sessionName?: string
  taskId: string
  requestId: string
  correlationId: string
  model: ModelRef
  startedAt: string
  input: unknown
}

export type ModelTraceFinish = {
  completedAt: string
  output?: unknown
  usage?: unknown
  error?: string
}

export interface ModelTracePort {
  start(run: ModelTraceStart): Promise<void>
  finish(id: string, result: ModelTraceFinish): Promise<void>
}
