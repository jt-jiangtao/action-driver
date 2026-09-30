import { describe, expect, it, vi } from 'vitest'
import type { AgentDesktopApi } from '../../../../../../src/preload/desktop-api'
import { DesktopTaskCatalog } from '../../../../../../src/renderer/src/services/task-catalog/desktop-task-catalog'
import type { AgentControlApi } from '../../../../../../src/renderer/src/services/agent-session/runtime-agent-http-api'

describe('DesktopTaskCatalog', () => {
  it('keeps task and session IDs distinct across catalog pages and mutations', async () => {
    const session = { id: 'turn-2', sessionId: 'session-1', title: '第一回合标题',
      status: 'completed' as const, model: { connectionId: 'gateway', modelId: 'model' },
      createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:02.000Z',
      pinned: true, archivedAt: '2026-09-30T00:00:03.000Z' }
    const listSessions = vi.fn(async () => ({ items: [session], nextCursor: 'older' }))
    const setSessionPinned = vi.fn(async () => {})
    const setSessionArchived = vi.fn(async () => {})
    const catalog = new DesktopTaskCatalog({ listSessions, setSessionPinned, setSessionArchived } as unknown as AgentControlApi)
    await expect(catalog.listArchivedTasks('标题', 'cursor')).resolves.toEqual({
      items: [{ id: 'turn-2', sessionId: 'session-1', title: '第一回合标题', state: 'default',
        pinned: true, archivedAt: '2026-09-30T00:00:03.000Z' }], nextCursor: 'older'
    })
    expect(listSessions).toHaveBeenCalledWith(true, '标题', 'cursor')
    await catalog.setPinned('session-1', false)
    await catalog.setArchived('session-1', false)
    expect(setSessionPinned).toHaveBeenCalledWith('session-1', false)
    expect(setSessionArchived).toHaveBeenCalledWith('session-1', false)
  })

  it('loads recent tasks and task details from the desktop API', async () => {
    const task = {
      id: 'task-real',
      title: '真实任务',
      status: 'succeeded' as const,
      messages: [],
      steps: [],
      browser: null
    }
    const api = {
      listTasks: vi.fn(async () => [
        {
          id: task.id,
          sessionId: 'session-real',
          title: task.title,
          status: task.status,
          model: { connectionId: 'gateway', modelId: 'gpt-real' },
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:01.000Z'
        }
      ]),
      get: vi.fn(async () => task)
    } as unknown as AgentDesktopApi
    const catalog = new DesktopTaskCatalog(api)

    await expect(catalog.listRecentTasks()).resolves.toEqual([
      {
        id: 'task-real',
        sessionId: 'session-real',
        title: '真实任务',
        state: 'default',
        pinned: false
      }
    ])
    await expect(catalog.getTask('task-real')).resolves.toEqual(task)
    expect(api.listTasks).toHaveBeenCalledWith(50)
    expect(api.get).toHaveBeenCalledWith('task-real')
  })
})
