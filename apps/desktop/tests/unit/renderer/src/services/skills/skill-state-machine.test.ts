import { describe, expect, it } from 'vitest'
import { transitionSkillState } from '../../../../../../src/renderer/src/services/skills/skill-state-machine'

describe('transitionSkillState', () => {
  it.each([
    ['running', 'pause', 'paused'],
    ['paused', 'resume', 'running'],
    ['running', 'take-over', 'taken-over'],
    ['taken-over', 'resume', 'running'],
    ['running', 'complete', 'succeeded'],
    ['running', 'fail', 'failed'],
    ['queued', 'resume', 'running'],
    ['waiting-user', 'resume', 'running']
  ] as const)('transitions %s with %s to %s', (state, command, expected) => {
    expect(transitionSkillState(state, command)).toBe(expected)
  })

  it('rejects transitions from terminal states', () => {
    expect(() => transitionSkillState('succeeded', 'pause')).toThrow('Invalid skill transition')
    expect(() => transitionSkillState('failed', 'resume')).toThrow('Invalid skill transition')
  })
})
