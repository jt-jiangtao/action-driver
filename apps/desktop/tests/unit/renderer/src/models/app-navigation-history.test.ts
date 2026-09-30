import { describe, expect, it } from 'vitest'
import {
  createAppNavigationHistory,
  navigateAppHistory,
  travelAppHistory
} from '../../../../../src/renderer/src/models/app-navigation-history'

describe('app navigation history', () => {
  it('moves between task and settings routes and disables history boundaries', () => {
    const home = { kind: 'home' } as const
    const task = { kind: 'task', taskId: 'task-1' } as const
    const settings = { kind: 'settings', returnTo: task } as const
    const first = createAppNavigationHistory(home)
    const visited = navigateAppHistory(navigateAppHistory(first, task), settings)

    expect(visited.index).toBe(2)
    expect(travelAppHistory(visited, 1).entries[1]).toEqual(task)
    expect(travelAppHistory(visited, -1).index).toBe(1)
    expect(travelAppHistory(first, -1)).toBe(first)
    expect(travelAppHistory(visited, 1)).toBe(visited)
  })

  it('drops forward entries after branching from an older page', () => {
    const home = { kind: 'home' } as const
    const task = { kind: 'task', taskId: 'task-1' } as const
    const settings = { kind: 'settings', returnTo: task } as const
    const skills = { kind: 'skills', returnTo: task } as const
    const visited = navigateAppHistory(
      navigateAppHistory(createAppNavigationHistory(home), task),
      settings
    )
    const branched = navigateAppHistory(travelAppHistory(visited, -1), skills)

    expect(branched.entries).toEqual([home, task, skills])
    expect(travelAppHistory(branched, 1)).toBe(branched)
    expect(navigateAppHistory(branched, skills)).toBe(branched)
  })
})
