import { describe, expect, it } from 'vitest'
import { LoadedSkills } from './skill-gate'

describe('LoadedSkills', () => {
  it('remembers skills per task and forgets them on clear', () => {
    const loaded = new LoadedSkills()
    expect(loaded.has('task-1', 'computer-use')).toBe(false)
    loaded.record('task-1', 'computer-use')
    expect(loaded.has('task-1', 'computer-use')).toBe(true)
    expect(loaded.has('task-2', 'computer-use')).toBe(false)
    loaded.clear('task-1')
    expect(loaded.has('task-1', 'computer-use')).toBe(false)
  })
})
