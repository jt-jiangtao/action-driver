import { describe, expect, it, vi } from 'vitest'
import { RuntimeAgentHttpApi } from '../../../../../../src/renderer/src/services/agent-session/runtime-agent-http-api'
import type { RuntimeHttpClient } from '../../../../../../src/renderer/src/services/transport/runtime-http-client'

describe('RuntimeAgentHttpApi', () => {
  it('encodes application decisions on the dedicated HTTP route', async () => {
    const request = vi.fn(async () => ({ accepted: true }))
    const api = new RuntimeAgentHttpApi({ request } as unknown as RuntimeHttpClient)
    await api.decideAppApproval('task/1', 'approval/1', 'session')
    expect(request).toHaveBeenCalledExactlyOnceWith(
      '/tasks/task%2F1/app-approvals/approval%2F1/decision',
      { method: 'POST', body: { decision: 'session' } }
    )
  })
  it('routes task reads and control commands directly to Runtime HTTP', async () => {
    const request = vi.fn(async (path: string) =>
      path.startsWith('/tasks/task-1') ? { task: { id: 'task-1' }, accepted: true } : { tasks: [] }
    )
    const api = new RuntimeAgentHttpApi({ request } as unknown as RuntimeHttpClient)
    await api.get('task-1')
    await api.listTasks(10)
    await api.interrupt('task-1')
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/tasks/task-1',
      '/tasks?limit=10',
      '/tasks/task-1/interrupt'
    ])
  })
})
