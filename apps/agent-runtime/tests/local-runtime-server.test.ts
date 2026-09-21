import type { RuntimeMessageEndpoint } from '@actiondriver/runtime-contracts'
import { RuntimeClient } from '@actiondriver/runtime-contracts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalRuntimeServer } from '../src/index'

function linkedEndpoints(): [RuntimeMessageEndpoint, RuntimeMessageEndpoint] {
  const listeners: [Set<(message: unknown) => void>, Set<(message: unknown) => void>] = [
    new Set(),
    new Set()
  ]
  const closeListeners: [Set<() => void>, Set<() => void>] = [new Set(), new Set()]
  const endpoint = (side: 0 | 1): RuntimeMessageEndpoint => ({
    postMessage(message) {
      queueMicrotask(() => listeners[side === 0 ? 1 : 0].forEach((listener) => listener(message)))
    },
    onMessage(listener) {
      listeners[side].add(listener)
      return () => listeners[side].delete(listener)
    },
    onClose(listener) {
      closeListeners[side].add(listener)
      return () => closeListeners[side].delete(listener)
    }
  })
  return [endpoint(0), endpoint(1)]
}

describe('local Runtime server composition', () => {
  it('serves Agent commands from the local composition root after handshake', async () => {
    const [clientEndpoint, serverEndpoint] = linkedEndpoints()
    const path = join(mkdtempSync(join(tmpdir(), 'actiondriver-server-')), 'actiondriver.db')
    const server = createLocalRuntimeServer(serverEndpoint, path)
    const client = new RuntimeClient(clientEndpoint, {
      appVersion: '0.1.0',
      capabilities: ['task.submit', 'task.get'],
      onSkillExecute: async (request) => ({
        event: {
          id: `event-${request.invocationId}`,
          invocationId: request.invocationId,
          skillId: request.requestedSkillId,
          state: 'succeeded',
          occurredAt: '2026-09-22T00:00:00.000Z'
        },
        output: { accepted: true }
      })
    })

    await client.connect()
    const { taskId } = await client.request('task.submit', { goal: 'Book a hotel' })
    const { task } = await client.request('task.get', { taskId })

    expect(task).toMatchObject({
      id: taskId,
      title: 'Book a hotel',
      messages: [{ role: 'user', content: 'Book a hotel' }]
    })
    await server.close()
  })
})
