import { describe, expect, it } from 'vitest'
import { createMockRuntimeAdapters } from '../../src/mock-adapters'

describe('in-memory session catalog', () => {
  it('deletes only archived sessions', async () => {
    const tasks = createMockRuntimeAdapters().taskRepository
    const task = {
      id: 'turn-delete', threadId: 'session-delete', sessionId: 'session-delete', goal: 'Delete',
      model: { connectionId: 'conn', modelId: 'model' }, status: 'completed', error: null,
      lastCheckpointId: null, createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z'
    }
    await tasks.save(task)
    await expect(tasks.deleteSession?.('session-delete')).rejects.toThrow('Only archived')
    await tasks.setSessionArchived?.('session-delete', true)
    await tasks.deleteSession?.('session-delete')
    expect(await tasks.get('turn-delete')).toBeNull()
    expect((await tasks.listSessions?.({ archived: true, limit: 10 }))?.items).toEqual([])
  })

  it('preserves the first archive time, clears it on restore, and keeps the pin', async () => {
    const tasks = createMockRuntimeAdapters().taskRepository
    const task = {
      id: 'turn-1',
      threadId: 'session-1',
      sessionId: 'session-1',
      goal: 'Example',
      model: { connectionId: 'conn', modelId: 'model' },
      status: 'completed',
      error: null,
      lastCheckpointId: null,
      createdAt: '2026-09-30T00:00:00.000Z',
      updatedAt: '2026-09-30T00:00:00.000Z'
    }
    await tasks.save(task)
    await tasks.setSessionPinned?.('session-1', true)
    const first = await tasks.setSessionArchived?.('session-1', true)
    const repeated = await tasks.setSessionArchived?.('session-1', true)
    expect(repeated?.archivedAt).toBe(first?.archivedAt)
    expect((await tasks.listSessions?.({ archived: true, limit: 10 }))?.items[0]?.pinned).toBe(true)
    await tasks.setSessionArchived?.('session-1', false)
    expect((await tasks.listSessions?.({ archived: false, limit: 10 }))?.items[0]).toMatchObject({
      pinned: true,
      archivedAt: null
    })
  })
})
