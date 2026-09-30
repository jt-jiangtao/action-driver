import { describe, expect, it } from 'vitest'
import { SkillInvocationStateMachine } from '../../src/index'

describe('SkillInvocationStateMachine', () => {
  it('accepts the queued, running, paused, waiting_user, takeover, and completed path', () => {
    const machine = new SkillInvocationStateMachine()

    expect(machine.transition('running')).toBe('running')
    expect(machine.transition('paused')).toBe('paused')
    expect(machine.transition('running')).toBe('running')
    expect(machine.transition('waiting_user')).toBe('waiting_user')
    expect(machine.transition('running')).toBe('running')
    expect(machine.transition('takeover')).toBe('takeover')
    expect(machine.transition('completed')).toBe('completed')
  })

  it('supports failed and cancelled terminal paths and rejects transitions afterward', () => {
    const failed = new SkillInvocationStateMachine()
    failed.transition('running')
    expect(failed.transition('failed')).toBe('failed')
    expect(() => failed.transition('running')).toThrow('INVALID_SKILL_TRANSITION')

    const cancelled = new SkillInvocationStateMachine()
    expect(cancelled.transition('cancelled')).toBe('cancelled')
    expect(() => cancelled.transition('running')).toThrow('INVALID_SKILL_TRANSITION')
  })
})
