import type {
  SkillControlCommand,
  SkillExecutionEvent,
  TaskProjection
} from '@actiondriver/contracts'

export const RUNTIME_PROTOCOL_VERSION = { major: 1, minor: 0 } as const

export type RuntimeCommandMap = {
  'task.submit': {
    request: { goal: string; systemPrompt?: string }
    response: { taskId: string }
  }
  'task.interrupt': { request: { taskId: string }; response: { accepted: true } }
  'task.continue': { request: { taskId: string }; response: { accepted: true } }
  'task.provide-input': {
    request: { taskId: string; value: unknown }
    response: { accepted: true }
  }
  'task.get': { request: { taskId: string }; response: { task: TaskProjection | null } }
  'skill.control': {
    request: { invocationId: string; command: SkillControlCommand }
    response: { event: SkillExecutionEvent }
  }
}

export type RuntimeEvent = {
  cursor: number
  taskId: string
  type: string
  payload: unknown
  occurredAt: string
}

export type SkillExecuteRequest = {
  invocationId: string
  requestedSkillId: string
  resolvedProviderId: string
  providerVersion: string
  input: unknown
}

export type SkillExecuteResult = {
  event: SkillExecutionEvent
  output?: unknown
}
