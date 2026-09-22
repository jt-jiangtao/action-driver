import type { RuntimeMessageEndpoint } from '@actiondriver/runtime-contracts'
import { RuntimeClient } from '@actiondriver/runtime-contracts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SqliteRuntimeRepositories,
  createLocalRuntimeAdapters,
  createLocalRuntimeServer,
  createSqliteCheckpointer,
  openRuntimeDatabase,
  type ModelGateway
} from '../src/index'

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

function createHarness(modelGateway: ModelGateway) {
  const [clientEndpoint, serverEndpoint] = linkedEndpoints()
  const path = join(mkdtempSync(join(tmpdir(), 'actiondriver-server-')), 'actiondriver.db')
  const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
  const checkpointer = createSqliteCheckpointer(path)
  const local = createLocalRuntimeAdapters({ repositories, checkpointer, modelGateway })
  const server = createLocalRuntimeServer(serverEndpoint, {
    adapters: local.adapters,
    messages: repositories.messages,
    modelCalls: repositories.modelCalls
  })
  const client = new RuntimeClient(clientEndpoint, {
    appVersion: '0.1.0',
    capabilities: ['task.submit', 'task.get', 'task.list', 'model-log.list', 'model-log.get'],
    onSkillExecute: async () => {
      throw new Error('Agent-only local runtime does not execute Skills')
    }
  })
  return { client, server, repositories, checkpointer }
}

const model = { connectionId: 'connection-1', modelId: 'gpt-real' }

describe('local Runtime server composition', () => {
  it('persists the real user input and assistant result', async () => {
    const harness = createHarness({
      async complete() {
        return { kind: 'finish', content: 'Real model answer' }
      }
    })
    await harness.client.connect()
    const { taskId } = await harness.client.request('task.submit', {
      goal: 'Book a hotel',
      model,
      skills: []
    })

    await vi.waitFor(async () => {
      const { task } = await harness.client.request('task.get', { taskId })
      expect(task?.status).toBe('succeeded')
      expect(task?.messages).toEqual([
        expect.objectContaining({ role: 'user', content: 'Book a hotel' }),
        expect.objectContaining({ role: 'agent', content: 'Real model answer' })
      ])
    })
    await expect(harness.repositories.messages.listByTask(taskId)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'Book a hotel' }),
      expect.objectContaining({ role: 'assistant', content: 'Real model answer' })
    ])
    await harness.repositories.modelCalls.save({
      id: 'call-1',
      taskId,
      requestId: `plan:${taskId}`,
      correlationId: 'correlation-1',
      model,
      status: 'completed',
      request: { model: 'gpt-real', messages: [{ role: 'user', content: 'Book a hotel' }] },
      response: { choices: [{ message: { content: 'Real model answer' } }] },
      error: null,
      startedAt: '2026-09-23T01:00:00.000Z',
      completedAt: '2026-09-23T01:00:01.000Z'
    })
    await expect(harness.client.request('task.list', { limit: 100 })).resolves.toMatchObject({
      tasks: [
        {
          id: taskId,
          sessionId: taskId,
          model,
          status: 'succeeded'
        }
      ]
    })
    await expect(harness.client.request('model-log.list', {})).resolves.toMatchObject({
      sessions: [{ id: taskId, tasks: [{ calls: [{ correlationId: 'correlation-1' }] }] }]
    })
    await expect(harness.client.request('model-log.get', { taskId })).resolves.toMatchObject({
      session: { id: taskId, tasks: [{ calls: [{ requestId: `plan:${taskId}` }] }] }
    })
    await harness.server.close()
    harness.checkpointer.close()
    harness.repositories.close()
  })

  it('persists a failed task when the selected model cannot execute', async () => {
    const harness = createHarness({
      async complete() {
        throw Object.assign(new Error('Model gpt-real is disabled'), {
          code: 'invalid-request',
          retryable: false
        })
      }
    })
    await harness.client.connect()
    const { taskId } = await harness.client.request('task.submit', {
      goal: 'Use the selected model',
      model,
      skills: []
    })

    await vi.waitFor(async () => {
      await expect(harness.repositories.tasks.get(taskId)).resolves.toMatchObject({
        status: 'failed',
        error: expect.objectContaining({ message: expect.stringContaining('disabled') })
      })
    })
    await harness.server.close()
    harness.checkpointer.close()
    harness.repositories.close()
  })
})
