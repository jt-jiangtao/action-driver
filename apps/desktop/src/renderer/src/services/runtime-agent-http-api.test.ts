import { describe, expect, it, vi } from 'vitest'
import { RuntimeAgentHttpApi } from './runtime-agent-http-api'
import type { RuntimeHttpClient } from './runtime-http-client'

describe('RuntimeAgentHttpApi', () => {
  it('routes task reads and control commands directly to Runtime HTTP', async () => {
    const request = vi.fn(async (path: string) => path.startsWith('/tasks/task-1')
      ? { task: { id: 'task-1' }, accepted: true }
      : { tasks: [] })
    const api = new RuntimeAgentHttpApi({ request } as unknown as RuntimeHttpClient)
    await api.get('task-1')
    await api.listTasks(10)
    await api.interrupt('task-1')
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/tasks/task-1', '/tasks?limit=10', '/tasks/task-1/interrupt'
    ])
  })
})
