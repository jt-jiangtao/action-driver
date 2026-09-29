import { describe, expect, it } from 'vitest'
import { LoadedSkills } from '../../../src/computer-use/skill-gate'

describe('LoadedSkills', () => {
  it('remembers skills per conversation session and forgets them on clear', () => {
    const loaded = new LoadedSkills()
    expect(loaded.has('session-1', 'computer-use')).toBe(false)
    loaded.record('session-1', 'computer-use')
    expect(loaded.has('session-1', 'computer-use')).toBe(true)
    expect(loaded.has('session-2', 'computer-use')).toBe(false)
    loaded.clear('session-1')
    expect(loaded.has('session-1', 'computer-use')).toBe(false)
  })
})
