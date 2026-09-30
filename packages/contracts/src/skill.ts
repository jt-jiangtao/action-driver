export type SkillExecutionState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting-user'
  | 'taken-over'
  | 'succeeded'
  | 'failed'

export const SKILL_IDS = {
  browser: 'browser-use',
  computer: 'computer-use'
} as const

export type SkillId = (typeof SKILL_IDS)[keyof typeof SKILL_IDS]

export interface SkillExecutionEvent {
  id: string
  invocationId: string
  skillId: string
  state: SkillExecutionState
  occurredAt: string
}

export interface BrowserTargetProjection {
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserSkillProjection {
  title: string
  url: string
  status: SkillExecutionState
  target: BrowserTargetProjection | null
  sessionId?: string
  surface?: 'embedded' | 'external-chrome'
  activeTabId?: string | null
  tabs?: Array<{
    id: string
    title: string
    url: string
    loading: boolean
    canGoBack: boolean
    canGoForward: boolean
  }>
  error?: string | null
}

interface BaseSkillInvocation<TSkillId extends SkillId, TInput> {
  id: string
  taskId: string
  skillId: TSkillId
  input: TInput
}

export type BrowserSkillInput =
  | { action: 'open-url'; url: string }
  | { action: 'click'; nodeHandle: string }
  | { action: 'scroll'; deltaX: number; deltaY: number }
  | { action: 'type'; nodeHandle: string; text: string }

export type ComputerUseSkillInput =
  | { action: 'activate-app'; bundleId: string }
  | { action: 'click'; x: number; y: number }
  | { action: 'type'; text: string }

export type BrowserSkillInvocation = BaseSkillInvocation<
  typeof SKILL_IDS.browser,
  BrowserSkillInput
>
export type ComputerUseSkillInvocation = BaseSkillInvocation<
  typeof SKILL_IDS.computer,
  ComputerUseSkillInput
>
export type SkillInvocation = BrowserSkillInvocation | ComputerUseSkillInvocation

export type SkillControlCommand = 'pause' | 'resume' | 'take-over'

export interface SkillCapability<TSkillId extends SkillId> {
  readonly skillId: TSkillId
  invoke(invocation: Extract<SkillInvocation, { skillId: TSkillId }>): Promise<SkillExecutionEvent>
  transition(invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent>
}
