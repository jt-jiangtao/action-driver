import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import { RuntimeRpcError, type RuntimeClient } from '@actiondriver/runtime-contracts'
import { describe, expect, it, vi } from 'vitest'
import { registerAgentIpcHandlers } from './agent-ipc'

type Handler = (
  event: { sender: { send(channel: string, payload: unknown): void } },
  input: unknown
) => unknown

function createHarness() {
  const handlers = new Map<string, Handler>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  let eventListener: ((event: RuntimeEvent) => void) | undefined
  const request = vi.fn(async (command: string, input: unknown) => {
    void input
    if (command === 'task.submit' && input === 'timeout') {
      throw new RuntimeRpcError('DEADLINE_EXCEEDED', 'Runtime request timed out', { timeoutMs: 50 })
    }
    if (command === 'task.submit') return { taskId: 'task-1' }
    if (command === 'task.get') {
      return {
        task: {
          id: 'task-1',
          title: 'Book a hotel',
          status: 'running',
          messages: [],
          steps: [],
          browser: null
        }
      }
    }
    return { accepted: true as const }
  })
  const subscribeEvents = vi.fn(
    async (_taskId: string, afterCursor: number, listener: (event: RuntimeEvent) => void) => {
      eventListener = listener
      return { subscriptionId: 'runtime-subscription', cursor: afterCursor }
    }
  )
  const runtimeClient = {
    request: request as RuntimeClient['request'],
    subscribeEvents: subscribeEvents as RuntimeClient['subscribeEvents']
  }
  registerAgentIpcHandlers(
    {
      handle(channel, handler) {
        handlers.set(channel, handler)
      }
    },
    runtimeClient
  )
  const sender = {
    send(channel: string, payload: unknown) {
      sent.push({ channel, payload })
    }
  }
  const invoke = (channel: string, input: unknown) => handlers.get(channel)?.({ sender }, input)

  return { eventListener: () => eventListener, handlers, invoke, request, sent, subscribeEvents }
}

describe('registerAgentIpcHandlers', () => {
  it('registers only the six explicitly named Agent command handlers', async () => {
    const { handlers, invoke, request } = createHarness()

    expect([...handlers.keys()].sort()).toEqual([
      'actiondriver:agent:continue',
      'actiondriver:agent:get',
      'actiondriver:agent:interrupt',
      'actiondriver:agent:provide-input',
      'actiondriver:agent:submit',
      'actiondriver:agent:subscribe'
    ])

    await expect(invoke('actiondriver:agent:submit', { goal: 'Book a hotel' })).resolves.toEqual({
      ok: true,
      value: { taskId: 'task-1' }
    })
    await expect(invoke('actiondriver:agent:get', { taskId: 'task-1' })).resolves.toEqual({
      ok: true,
      value: {
        task: {
          id: 'task-1',
          title: 'Book a hotel',
          status: 'running',
          messages: [],
          steps: [],
          browser: null
        }
      }
    })
    await expect(invoke('actiondriver:agent:interrupt', { taskId: 'task-1' })).resolves.toEqual({
      ok: true,
      value: { accepted: true }
    })
    await expect(invoke('actiondriver:agent:continue', { taskId: 'task-1' })).resolves.toEqual({
      ok: true,
      value: { accepted: true }
    })
    await expect(
      invoke('actiondriver:agent:provide-input', { taskId: 'task-1', value: 'confirm' })
    ).resolves.toEqual({ ok: true, value: { accepted: true } })

    expect(request.mock.calls).toEqual([
      ['task.submit', { goal: 'Book a hotel' }],
      ['task.get', { taskId: 'task-1' }],
      ['task.interrupt', { taskId: 'task-1' }],
      ['task.continue', { taskId: 'task-1' }],
      ['task.provide-input', { taskId: 'task-1', value: 'confirm' }]
    ])
  })

  it('projects subscribed Runtime events over one fixed renderer event channel', async () => {
    const { eventListener, invoke, sent, subscribeEvents } = createHarness()

    await expect(
      invoke('actiondriver:agent:subscribe', {
        subscriptionId: 'renderer-subscription',
        taskId: 'task-1',
        afterCursor: 4
      })
    ).resolves.toEqual({ ok: true, value: { cursor: 4 } })

    const event: RuntimeEvent = {
      cursor: 5,
      taskId: 'task-1',
      type: 'task.updated',
      payload: { status: 'running' },
      occurredAt: '2026-09-21T00:00:00.000Z'
    }
    eventListener()?.(event)

    expect(subscribeEvents).toHaveBeenCalledWith('task-1', 4, expect.any(Function))
    expect(sent).toEqual([
      {
        channel: 'actiondriver:agent:event',
        payload: { subscriptionId: 'renderer-subscription', event }
      }
    ])
  })

  it('returns structured-clone-safe Runtime errors instead of throwing through Electron IPC', async () => {
    const { handlers } = createHarness()
    const handler = handlers.get('actiondriver:agent:submit')
    const sender = { send: vi.fn() }

    await expect(handler?.({ sender }, 'timeout')).resolves.toEqual({
      ok: false,
      error: {
        code: 'DEADLINE_EXCEEDED',
        message: 'Runtime request timed out',
        details: { timeoutMs: 50 }
      }
    })
  })
})
