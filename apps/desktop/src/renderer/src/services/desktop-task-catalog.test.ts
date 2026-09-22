import { describe, expect, it, vi } from 'vitest'
import type { AgentDesktopApi } from '../../../preload/desktop-api'
import { DesktopTaskCatalog } from './desktop-task-catalog'

describe('DesktopTaskCatalog', () => {
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
      listTasks: vi.fn(async () => [{
        id: task.id,
        sessionId: 'session-real',
        title: task.title,
        status: task.status,
        model: { connectionId: 'gateway', modelId: 'gpt-real' },
        createdAt: '2026-09-23T00:00:00.000Z',
        updatedAt: '2026-09-23T00:00:01.000Z'
      }]),
      get: vi.fn(async () => task)
    } as unknown as AgentDesktopApi
    const catalog = new DesktopTaskCatalog(api)

    await expect(catalog.listRecentTasks()).resolves.toEqual([
      { id: 'task-real', title: '真实任务', state: 'default' }
    ])
    await expect(catalog.getTask('task-real')).resolves.toEqual(task)
    expect(api.listTasks).toHaveBeenCalledWith(50)
    expect(api.get).toHaveBeenCalledWith('task-real')
  })
})
