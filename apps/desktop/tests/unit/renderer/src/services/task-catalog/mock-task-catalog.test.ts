import { describe, expect, it } from 'vitest'
import { MockTaskCatalog } from '../../../../../../src/renderer/src/services/task-catalog/mock-task-catalog'

describe('MockTaskCatalog', () => {
  it('keeps archive and pin state local to one catalog instance', async () => {
    const catalog = new MockTaskCatalog()
    await catalog.setPinned('research-task-session', true)
    expect((await catalog.listRecentTasks())[0]?.id).toBe('research-task')
    await catalog.setArchived('research-task-session', true)
    const first = (await catalog.listArchivedTasks('研究')).items[0]
    await catalog.setArchived('research-task-session', true)
    expect((await catalog.listArchivedTasks('研究')).items[0]?.archivedAt).toBe(first?.archivedAt)
    expect((await catalog.listRecentTasks()).some((task) => task.id === 'research-task')).toBe(false)
    await catalog.setArchived('research-task-session', false)
    expect((await catalog.listRecentTasks())[0]?.id).toBe('research-task')
    expect((await new MockTaskCatalog().listArchivedTasks('')).items).toEqual([])
  })

  it('returns distinct immutable projections for every recent task', async () => {
    const catalog = new MockTaskCatalog()
    const recent = await catalog.listRecentTasks()
    const [first, second] = recent
    if (!first || !second) throw new Error('recent task fixtures missing')

    expect(recent).toHaveLength(5)
    expect(new Set(recent.map((task) => task.id)).size).toBe(recent.length)
    expect((await catalog.getTask(first.id))?.title).not.toBe((await catalog.getTask(second.id))?.title)
    expect(await catalog.getTask('missing-task')).toBeNull()

    const firstRead = await catalog.getTask(first.id)
    if (!firstRead) throw new Error('fixture missing')
    firstRead.title = '被调用方修改'
    expect((await catalog.getTask(first.id))?.title).toBe(first.title)
  })
})
