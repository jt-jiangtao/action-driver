import type { TaskProjection } from '@actiondriver/contracts'
import { AgentServiceError } from '@actiondriver/contracts'
import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import { describe, expect, it, vi } from 'vitest'
import type { AgentDesktopApi } from '../../../preload/desktop-api'
import { DesktopAgentAdapter } from './desktop-agent-adapter'

const task = (status: TaskProjection['status'] = 'running'): TaskProjection => ({
  id: 'task-1',
  title: 'Book a hotel',
  status,
  messages: [{ id: 'message-1', role: 'user', content: 'Book a hotel' }],
  steps: [{ id: 'step-1', title: 'Plan', detail: 'Planning', state: 'current' }],
  browser: null
})

function harness() {
  let currentTask = task()
  let eventListener: ((event: RuntimeEvent) => void) | undefined
  const api: AgentDesktopApi = {
    submit: vi.fn(async () => ({ taskId: 'task-1' })),
    get: vi.fn(async () => structuredClone(currentTask)),
    interrupt: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    provideInput: vi.fn(async () => undefined),
    subscribe: vi.fn(async (_taskId, _cursor, listener) => {
      eventListener = listener
      return () => {
        eventListener = undefined
      }
    })
  }
  return {
    adapter: new DesktopAgentAdapter(api),
    api,
    emit(event: RuntimeEvent) {
      eventListener?.(event)
    },
    setTask(next: TaskProjection) {
      currentTask = next
    }
  }
}

describe('DesktopAgentAdapter', () => {
  it('submits through Preload, caches an immutable projection, and refreshes it from events', async () => {
    const { adapter, api, emit, setTask } = harness()
    const listener = vi.fn()
    adapter.subscribe(listener)

    const submitted = await adapter.submitGoal('Book a hotel')
    submitted.title = 'mutated outside the adapter'

    expect(api.submit).toHaveBeenCalledWith('Book a hotel')
    expect(api.get).toHaveBeenCalledWith('task-1')
    expect(api.subscribe).toHaveBeenCalledWith('task-1', 0, expect.any(Function))
    expect(adapter.getTask('task-1')?.title).toBe('Book a hotel')
    expect(listener).toHaveBeenLastCalledWith(task())

    setTask(task('waiting-user'))
    emit({
      cursor: 7,
      taskId: 'task-1',
      type: 'task.updated',
      payload: { status: 'waiting-user' },
      occurredAt: '2026-09-22T00:00:00.000Z'
    })

    await vi.waitFor(() => expect(adapter.getTask('task-1')?.status).toBe('waiting-user'))
    expect(listener).toHaveBeenLastCalledWith(task('waiting-user'))
  })

  it('delegates interrupt, continue, and user input commands to the whitelisted API', async () => {
    const { adapter, api } = harness()

    await adapter.interrupt('task-1')
    await adapter.continueTask('task-1')
    await adapter.provideInput('task-1', { approved: true })

    expect(api.interrupt).toHaveBeenCalledWith('task-1')
    expect(api.continue).toHaveBeenCalledWith('task-1')
    expect(api.provideInput).toHaveBeenCalledWith('task-1', { approved: true })
  })

  it('rejects malformed or non-cloneable task projections before caching them', async () => {
    const invalidTasks = [
      { ...task(), messages: [{ id: 'message-1', role: 'system', content: 'invalid role' }] },
      { ...task(), privateHandle: () => undefined }
    ]

    for (const invalidTask of invalidTasks) {
      const { adapter, api } = harness()
      vi.mocked(api.get).mockResolvedValue(invalidTask as unknown as TaskProjection)

      await expect(adapter.submitGoal('Book a hotel')).rejects.toMatchObject({
        name: 'AgentServiceError',
        code: 'invalid-response'
      })
      expect(adapter.getTask('task-1')).toBeNull()
    }
  })

  it.each([
    ['HANDSHAKE_REQUIRED', 'unavailable'],
    ['HANDSHAKE_REJECTED', 'incompatible-runtime'],
    ['DEADLINE_EXCEEDED', 'timeout'],
    ['INVALID_MESSAGE', 'invalid-response'],
    ['RUNTIME_DISCONNECTED', 'unavailable'],
    ['REMOTE_ERROR', 'runtime-error'],
    ['LATE_RESPONSE', 'invalid-response']
  ] as const)('maps %s to the %s domain error', async (runtimeCode, domainCode) => {
    const { adapter, api } = harness()
    vi.mocked(api.submit).mockRejectedValue({ code: runtimeCode, message: 'runtime failed' })

    const error = await adapter.submitGoal('Book a hotel').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AgentServiceError)
    expect(error).toMatchObject({ code: domainCode, message: 'runtime failed' })
  })
})
