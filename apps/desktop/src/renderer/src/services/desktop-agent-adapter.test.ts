import type {
  SkillControlCommand,
  SkillExecutionEvent,
  TaskProjection
} from '@actiondriver/contracts'
import { AgentServiceError, SKILL_IDS } from '@actiondriver/contracts'
import type { RuntimeEvent, StreamServerEvent } from '@actiondriver/runtime-contracts'
import { describe, expect, it, vi } from 'vitest'
import type { AgentDesktopApi } from '../../../preload/desktop-api'
import { DesktopAgentAdapter, DesktopSkillGateway } from './desktop-agent-adapter'
import type { DesktopApi } from '../../../preload/desktop-api'

const task = (status: TaskProjection['status'] = 'running'): TaskProjection => ({
  id: 'task-1',
  sessionId: 'session-1',
  title: 'Book a hotel',
  status,
  model: { connectionId: 'connection-1', modelId: 'gpt-real' },
  messages: [
    { id: 'message-1', role: 'user', content: 'Book a hotel' },
    { id: 'assistant-1', role: 'agent', content: '' }
  ],
  steps: [{ id: 'step-1', title: 'Plan', detail: 'Planning', state: 'current' }],
  browser: null
})

function harness(browserSession?: DesktopApi['browserSession']) {
  let currentTask = task()
  let eventListener: ((event: RuntimeEvent) => void) | undefined
  let streamListener: ((event: StreamServerEvent) => void) | undefined
  const api: AgentDesktopApi = {
    get: vi.fn(async () => structuredClone(currentTask)),
    listTasks: vi.fn(async () => []),
    interrupt: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    provideInput: vi.fn(async () => undefined),
    decideAppApproval: vi.fn(async () => undefined),
    controlSkill: vi.fn(
      async (invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent> => ({
        id: `event-${command}`,
        invocationId,
        skillId: SKILL_IDS.browser,
        state: command === 'pause' ? 'paused' : command === 'resume' ? 'running' : 'taken-over',
        occurredAt: '2026-09-22T00:00:00.000Z'
      })
    ),
    subscribe: vi.fn(async (_taskId, _cursor, listener) => {
      eventListener = listener
      return () => {
        eventListener = undefined
      }
    })
  }
  const streamClient = {
    create: vi.fn(async () => ({
      type: 'request.accepted' as const,
      protocol: 'actiondriver.stream.v2' as const,
      eventId: 'accepted-1',
      cursor: 1,
      sequence: 0,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'assistant-1',
      occurredAt: '2026-09-23T00:00:00.000Z'
    })),
    cancel: vi.fn(async () => undefined),
    watchExisting: vi.fn(async () => undefined),
    subscribe: vi.fn((listener: (event: StreamServerEvent) => void) => {
      streamListener = listener
      return () => {
        streamListener = undefined
      }
    })
  }
  return {
    adapter: new DesktopAgentAdapter(api, streamClient, undefined, browserSession),
    skillGateway: new DesktopSkillGateway(api),
    api,
    streamClient,
    emit(event: RuntimeEvent) {
      eventListener?.(event)
    },
    emitStream(event: StreamServerEvent) {
      streamListener?.(event)
    },
    setTask(next: TaskProjection) {
      currentTask = next
    }
  }
}

describe('DesktopAgentAdapter', () => {
  it('projects an owned browser session onto the runtime task without changing mock tasks', async () => {
    let emitBrowser: ((event: unknown) => void) | undefined
    const browserSession: DesktopApi['browserSession'] = {
      command: vi.fn(async () => null),
      setViewport: vi.fn(async () => undefined),
      subscribe(listener) {
        emitBrowser = listener as (event: unknown) => void
        return () => { emitBrowser = undefined }
      }
    }
    const { adapter } = harness(browserSession)
    await adapter.submitGoal({ goal: 'Book a hotel', model: task().model })
    expect(adapter.getTask('task-1')?.browser).toBeNull()

    emitBrowser?.({ taskId: 'task-1', snapshot: {
      sessionId: 'browser-1', surface: 'embedded', status: 'running', error: null,
      activeTabId: 'tab-1', tabs: [{ id: 'tab-1', title: 'Wikipedia',
        url: 'https://www.wikipedia.org/', loading: false,
        canGoBack: false, canGoForward: false }]
    } })
    expect(adapter.getTask('task-1')?.browser).toMatchObject({
      title: 'Wikipedia', url: 'https://www.wikipedia.org/',
      sessionId: 'browser-1', surface: 'embedded', activeTabId: 'tab-1'
    })
    expect(adapter.getTask('task-1')?.browser?.target).toBeNull()
    emitBrowser?.({ taskId: 'task-1', snapshot: null })
    expect(adapter.getTask('task-1')?.browser).toBeNull()
  })
  it('reattaches a running task snapshot and applies the following live events', async () => {
    const { adapter, streamClient, emitStream } = harness()
    const restored: TaskProjection = {
      ...task(),
      streamRequestId: 'request-1',
      streamResponseId: 'response-1',
      streamCursor: 5,
      streamSequence: 2,
      preparingToolName: 'tools_local_command_shell_run'
    }
    await adapter.restoreTaskStream(restored)
    await adapter.restoreTaskStream(restored)
    expect(streamClient.watchExisting).toHaveBeenCalledTimes(1)
    expect(streamClient.watchExisting).toHaveBeenCalledWith({
      requestId: 'request-1',
      responseId: 'response-1',
      taskId: 'task-1',
      cursor: 5,
      sequence: 2
    })
    expect(adapter.getTask('task-1')?.preparingToolName).toBe('tools_local_command_shell_run')
    emitStream({
      type: 'response.end',
      protocol: 'actiondriver.stream.v2',
      eventId: 'restored-end',
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'assistant-1',
      cursor: 6,
      sequence: 3,
      occurredAt: '2026-09-23T00:00:02.000Z',
      status: 'completed',
      content: '完成',
      finishReason: 'stop',
      usage: null,
      durationMs: 1,
      error: null
    })
    expect(adapter.getTask('task-1')).toMatchObject({ status: 'succeeded' })
    expect(adapter.getTask('task-1')?.preparingToolName).toBeUndefined()
  })

  it('subscribes before submit and projects the live stream without the legacy subscription', async () => {
    const { adapter, api, streamClient, emitStream } = harness()
    const listener = vi.fn()
    adapter.subscribe(listener)

    const request = {
      goal: 'Book a hotel',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    }
    const submitted = await adapter.submitGoal(request)
    submitted.title = 'mutated outside the adapter'

    expect(streamClient.create).toHaveBeenCalledWith(request)
    expect(api.get).toHaveBeenCalledWith('task-1')
    expect(streamClient.subscribe).toHaveBeenCalledOnce()
    expect(api.subscribe).not.toHaveBeenCalled()
    expect(vi.mocked(streamClient.subscribe).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(streamClient.create).mock.invocationCallOrder[0]!
    )
    expect(adapter.getTask('task-1')?.title).toBe('Book a hotel')
    expect(listener).toHaveBeenLastCalledWith(task())

    emitStream({
      type: 'response.start',
      protocol: 'actiondriver.stream.v2',
      eventId: 'start-1',
      cursor: 2,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'assistant-1',
      occurredAt: '2026-09-23T00:00:00.000Z',
      sequence: 0,
      model: request.model
    })
    emitStream({
      type: 'response.content',
      protocol: 'actiondriver.stream.v2',
      eventId: 'content-1',
      cursor: 3,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'assistant-1',
      occurredAt: '2026-09-23T00:00:01.000Z',
      sequence: 1,
      delta: '**real**',
      contentIndex: 0
    })

    await vi.waitFor(() =>
      expect(adapter.getTask('task-1')?.messages.at(-1)?.content).toBe('**real**')
    )
  })

  it('continues the same session with a new task and preserves the full transcript', async () => {
    const { adapter, api, streamClient, emitStream, setTask } = harness()
    await adapter.submitGoal({
      goal: '第一问',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    setTask({
      ...task('running'),
      id: 'task-2',
      messages: [
        { id: 'message-1', role: 'user', content: '第一问' },
        { id: 'assistant-1', role: 'agent', content: '第一答' },
        { id: 'message-2', role: 'user', content: '第二问' },
        { id: 'assistant-2', role: 'agent', content: '' }
      ]
    })
    vi.mocked(streamClient.create).mockResolvedValueOnce({
      type: 'request.accepted',
      protocol: 'actiondriver.stream.v2',
      eventId: 'accepted-2',
      cursor: 4,
      sequence: 0,
      requestId: 'request-2',
      sessionId: 'session-1',
      taskId: 'task-2',
      responseId: 'response-2',
      streamId: 'stream-2',
      messageId: 'assistant-2',
      occurredAt: '2026-09-23T00:01:00.000Z'
    })

    await adapter.submitGoal({ goal: '第二问', sessionId: 'session-1' })
    emitStream({
      type: 'response.start',
      protocol: 'actiondriver.stream.v2',
      eventId: 'start-2',
      cursor: 5,
      requestId: 'request-2',
      sessionId: 'session-1',
      taskId: 'task-2',
      responseId: 'response-2',
      streamId: 'stream-2',
      messageId: 'assistant-2',
      occurredAt: '2026-09-23T00:01:01.000Z',
      sequence: 0,
      model: task().model
    })
    emitStream({
      type: 'response.content',
      protocol: 'actiondriver.stream.v2',
      eventId: 'content-2',
      cursor: 6,
      requestId: 'request-2',
      sessionId: 'session-1',
      taskId: 'task-2',
      responseId: 'response-2',
      streamId: 'stream-2',
      messageId: 'assistant-2',
      occurredAt: '2026-09-23T00:01:02.000Z',
      sequence: 1,
      delta: '第二答',
      contentIndex: 0
    })
    emitStream({
      type: 'response.end',
      protocol: 'actiondriver.stream.v2',
      eventId: 'end-2',
      cursor: 7,
      requestId: 'request-2',
      sessionId: 'session-1',
      taskId: 'task-2',
      responseId: 'response-2',
      streamId: 'stream-2',
      messageId: 'assistant-2',
      occurredAt: '2026-09-23T00:01:03.000Z',
      sequence: 2,
      status: 'completed',
      content: '第二答',
      finishReason: 'stop',
      usage: null,
      durationMs: 2,
      error: null
    })

    expect(streamClient.create).toHaveBeenLastCalledWith({
      goal: '第二问',
      sessionId: 'session-1'
    })
    expect(api.get).toHaveBeenLastCalledWith('task-2')
    expect(adapter.getTask('task-2')?.messages.map((message) => message.content)).toEqual([
      '第一问',
      '第一答',
      '第二问',
      '第二答'
    ])
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

  it('cancels an active streamed task through its stream request', async () => {
    const { adapter, api, streamClient } = harness()
    await adapter.submitGoal({ goal: 'Book a hotel', model: task().model })
    await adapter.interrupt('task-1')
    expect(streamClient.cancel).toHaveBeenCalledWith('task-1')
    expect(api.interrupt).not.toHaveBeenCalled()
  })

  it('controls Skill lifecycle through Preload and publishes the persisted events', async () => {
    const { api, skillGateway } = harness()
    const listener = vi.fn()
    skillGateway.subscribe(listener)

    await expect(skillGateway.pause('browser-invocation')).resolves.toMatchObject({
      state: 'paused'
    })
    await expect(skillGateway.resume('browser-invocation')).resolves.toMatchObject({
      state: 'running'
    })
    await expect(skillGateway.takeOver('browser-invocation')).resolves.toMatchObject({
      state: 'taken-over'
    })

    expect(api.controlSkill).toHaveBeenNthCalledWith(1, 'browser-invocation', 'pause')
    expect(api.controlSkill).toHaveBeenNthCalledWith(2, 'browser-invocation', 'resume')
    expect(api.controlSkill).toHaveBeenNthCalledWith(3, 'browser-invocation', 'take-over')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('exposes typed Browser and Computer capabilities without allowing Renderer invocation', async () => {
    const { skillGateway } = harness()

    expect(skillGateway.getCapability(SKILL_IDS.browser).skillId).toBe(SKILL_IDS.browser)
    expect(skillGateway.getCapability(SKILL_IDS.computer).skillId).toBe(SKILL_IDS.computer)
    await expect(
      skillGateway.invoke({
        id: 'renderer-invocation',
        taskId: 'task-1',
        skillId: SKILL_IDS.browser,
        input: { action: 'open-url', url: 'https://example.com' }
      })
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('rejects malformed or non-cloneable task projections before caching them', async () => {
    const invalidTasks = [
      { ...task(), messages: [{ id: 'message-1', role: 'system', content: 'invalid role' }] },
      { ...task(), privateHandle: () => undefined }
    ]

    for (const invalidTask of invalidTasks) {
      const { adapter, api } = harness()
      vi.mocked(api.get).mockResolvedValue(invalidTask as unknown as TaskProjection)

      await expect(
        adapter.submitGoal({
          goal: 'Book a hotel',
          model: { connectionId: 'connection-1', modelId: 'gpt-real' }
        })
      ).rejects.toMatchObject({
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
    const { adapter, streamClient } = harness()
    vi.mocked(streamClient.create).mockRejectedValue({
      code: runtimeCode,
      message: 'runtime failed'
    })

    const error = await adapter
      .submitGoal({
        goal: 'Book a hotel',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' }
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AgentServiceError)
    expect(error).toMatchObject({ code: domainCode, message: 'runtime failed' })
  })
})
