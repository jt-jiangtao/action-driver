import type { RuntimeRpcError } from '@actiondriver/runtime-contracts'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeClient } from './agent-ipc'
import { RuntimeClientGateway } from './runtime-client-gateway'

function createClient(taskId: string): AgentRuntimeClient {
  return {
    request: vi.fn(async () => ({ taskId })),
    subscribeEvents: vi.fn(async () => ({ subscriptionId: `events-${taskId}`, cursor: 0 }))
  } as unknown as AgentRuntimeClient
}

describe('RuntimeClientGateway', () => {
  it('rejects commands before a local Runtime connection is attached', async () => {
    const gateway = new RuntimeClientGateway()

    await expect(gateway.request('task.submit', { goal: 'Book a hotel' })).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeRpcError>>({ code: 'HANDSHAKE_REQUIRED' })
    )
  })

  it('delegates through the latest handshaken client after Runtime restart', async () => {
    const gateway = new RuntimeClientGateway()
    const first = createClient('task-first')
    const restarted = createClient('task-restarted')

    gateway.attach(Promise.resolve(first))
    await expect(gateway.request('task.submit', { goal: 'First' })).resolves.toEqual({
      taskId: 'task-first'
    })

    gateway.attach(Promise.resolve(restarted))
    await expect(gateway.request('task.submit', { goal: 'After restart' })).resolves.toEqual({
      taskId: 'task-restarted'
    })
  })
})
