import type { RuntimeEvent, StreamServerEvent } from '@actiondriver/runtime-contracts'
import { RuntimeRpcError, type RuntimeClient } from '@actiondriver/runtime-contracts'
import { describe, expect, it, vi } from 'vitest'
import { registerAgentIpcHandlers } from './agent-ipc'

type Handler = (
  event: { sender: { send(channel: string, payload: unknown): void } },
  input: unknown
) => unknown

function createHarness(getSystemPrompt?: () => Promise<string>) {
  const handlers = new Map<string, Handler>()
  const sent: Array<{ channel: string; payload: unknown }> = []
  let eventListener: ((event: RuntimeEvent) => void) | undefined
  let streamListener: ((event: StreamServerEvent) => void) | undefined
  const request = vi.fn(async (command: string, input: unknown) => {
    void input
    if (
      command === 'task.submit' &&
      typeof input === 'object' &&
      input !== null &&
      'goal' in input &&
      input.goal === 'timeout'
    ) {
      throw new RuntimeRpcError('DEADLINE_EXCEEDED', 'Runtime request timed out', { timeoutMs: 50 })
    }
    if (command === 'skill.control') {
      return {
        event: {
          id: 'event-1',
          invocationId: 'browser-invocation',
          skillId: 'browser-use',
          state: 'paused',
          occurredAt: '2026-09-22T00:00:00.000Z'
        }
      }
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
    if (command === 'task.list') return { tasks: [] }
    if (command === 'model-log.list') return { sessions: [] }
    if (command === 'model-log.get') return { session: null }
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
  const streamCreate = vi.fn(async (input: { goal: string }) => {
    if (input.goal === 'timeout') {
      throw new RuntimeRpcError('DEADLINE_EXCEEDED', 'Runtime request timed out', {
        timeoutMs: 50
      })
    }
    return {
      type: 'request.accepted' as const,
      protocol: 'actiondriver.stream.v1' as const,
      eventId: 'stream-accepted',
      cursor: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      occurredAt: '2026-09-23T00:00:00.000Z'
    }
  })
  const streamCancel = vi.fn(async () => undefined)
  const streamClient = {
    create: streamCreate,
    cancel: streamCancel,
    subscribe(listener: (event: StreamServerEvent) => void) {
      streamListener = listener
      return () => {
        streamListener = undefined
      }
    }
  }
  registerAgentIpcHandlers(
    {
      handle(channel, handler) {
        handlers.set(channel, handler)
      }
    },
    runtimeClient,
    undefined,
    getSystemPrompt ? { getSystemPrompt } : undefined,
    streamClient
  )
  const sender = {
    send(channel: string, payload: unknown) {
      sent.push({ channel, payload })
    }
  }
  const invoke = (channel: string, input: unknown) => handlers.get(channel)?.({ sender }, input)

  return {
    eventListener: () => eventListener,
    streamListener: () => streamListener,
    handlers,
    invoke,
    request,
    sent,
    streamCancel,
    streamCreate,
    subscribeEvents
  }
}

describe('registerAgentIpcHandlers', () => {
  it('loads the latest main prompt when a task is submitted', async () => {
    const getSystemPrompt = vi.fn(async () => '# Current main prompt')
    const { invoke, request, streamCreate } = createHarness(getSystemPrompt)

    await expect(
      invoke('actiondriver:agent:submit', {
        goal: 'Book a hotel',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { taskId: 'task-1' }
    })

    expect(getSystemPrompt).toHaveBeenCalledOnce()
    expect(streamCreate).toHaveBeenCalledWith({
      goal: 'Book a hotel',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      systemPrompt: '# Current main prompt'
    })
    expect(request).not.toHaveBeenCalledWith('task.submit', expect.anything())
  })

  it('registers and forwards the typed task and model-log query handlers', async () => {
    const { handlers, invoke, request } = createHarness()

    expect([...handlers.keys()].sort()).toEqual([
      'actiondriver:agent:cancel',
      'actiondriver:agent:continue',
      'actiondriver:agent:control-skill',
      'actiondriver:agent:get',
      'actiondriver:agent:interrupt',
      'actiondriver:agent:list',
      'actiondriver:agent:model-log-get',
      'actiondriver:agent:model-log-list',
      'actiondriver:agent:provide-input',
      'actiondriver:agent:submit',
      'actiondriver:agent:subscribe'
    ])

    await expect(
      invoke('actiondriver:agent:submit', {
        goal: 'Book a hotel',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' }
      })
    ).resolves.toMatchObject({
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
    await expect(invoke('actiondriver:agent:list', { limit: 20 })).resolves.toEqual({
      ok: true,
      value: { tasks: [] }
    })
    await expect(
      invoke('actiondriver:agent:model-log-list', { status: 'failed' })
    ).resolves.toEqual({
      ok: true,
      value: { sessions: [] }
    })
    await expect(invoke('actiondriver:agent:model-log-get', { taskId: 'task-1' })).resolves.toEqual(
      {
        ok: true,
        value: { session: null }
      }
    )
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
    await expect(
      invoke('actiondriver:agent:control-skill', {
        invocationId: 'browser-invocation',
        command: 'pause'
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { event: { invocationId: 'browser-invocation', state: 'paused' } }
    })

    expect(request.mock.calls).toEqual([
      ['task.get', { taskId: 'task-1' }],
      ['task.list', { limit: 20 }],
      ['model-log.list', { status: 'failed' }],
      ['model-log.get', { taskId: 'task-1' }],
      ['task.interrupt', { taskId: 'task-1' }],
      ['task.continue', { taskId: 'task-1' }],
      ['task.provide-input', { taskId: 'task-1', value: 'confirm' }],
      ['skill.control', { invocationId: 'browser-invocation', command: 'pause' }]
    ])
  })

  it('installs stream forwarding before create and routes cancel through WebSocket', async () => {
    const { invoke, sent, streamCancel, streamListener } = createHarness()
    await invoke('actiondriver:agent:submit', {
      goal: 'stream',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    const event = {
      type: 'response.content' as const,
      protocol: 'actiondriver.stream.v1' as const,
      eventId: 'content-1',
      cursor: 2,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      occurredAt: '2026-09-23T00:00:01.000Z',
      sequence: 1,
      delta: 'hello',
      contentIndex: 0
    }
    streamListener()?.(event)
    await invoke('actiondriver:agent:cancel', { taskId: 'task-1' })

    expect(sent).toContainEqual({ channel: 'actiondriver:agent:stream-event', payload: event })
    expect(streamCancel).toHaveBeenCalledWith('task-1')
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

    await expect(
      handler?.({ sender }, { goal: 'timeout', model: { connectionId: 'c', modelId: 'm' } })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'DEADLINE_EXCEEDED',
        message: 'Runtime request timed out',
        details: { timeoutMs: 50 }
      }
    })
  })
})
