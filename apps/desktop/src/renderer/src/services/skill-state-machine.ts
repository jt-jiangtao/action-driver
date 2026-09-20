import type { SkillExecutionState } from '@actiondriver/contracts'

export type SkillCommand = 'pause' | 'resume' | 'take-over' | 'complete' | 'fail'

export function transitionSkillState(
  state: SkillExecutionState,
  command: SkillCommand
): SkillExecutionState {
  const transitions: Partial<
    Record<SkillExecutionState, Partial<Record<SkillCommand, SkillExecutionState>>>
  > = {
    running: {
      pause: 'paused',
      'take-over': 'taken-over',
      complete: 'succeeded',
      fail: 'failed'
    },
    paused: {
      resume: 'running',
      'take-over': 'taken-over',
      fail: 'failed'
    },
    'taken-over': {
      resume: 'running',
      fail: 'failed'
    },
    queued: {
      resume: 'running',
      fail: 'failed'
    },
    'waiting-user': {
      resume: 'running',
      fail: 'failed'
    }
  }
  const next = transitions[state]?.[command]
  if (!next) throw new Error(`Invalid skill transition: ${state} -> ${command}`)
  return next
}
