import { describe, expect, it } from 'vitest'
import { MockTaskCatalog } from './mock-task-catalog'

describe('MockTaskCatalog', () => {
  it('returns distinct immutable projections for every recent task', () => {
    const catalog = new MockTaskCatalog()
    const recent = catalog.listRecentTasks()
    const [first, second] = recent
    if (!first || !second) throw new Error('recent task fixtures missing')

    expect(recent).toHaveLength(5)
    expect(new Set(recent.map((task) => task.id)).size).toBe(recent.length)
    expect(catalog.getTask(first.id)?.title).not.toBe(catalog.getTask(second.id)?.title)
    expect(catalog.getTask('missing-task')).toBeNull()

    const firstRead = catalog.getTask(first.id)
    if (!firstRead) throw new Error('fixture missing')
    firstRead.title = '被调用方修改'
    expect(catalog.getTask(first.id)?.title).toBe(first.title)
  })
})
