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

const task = (status: TaskProjection['status'] = 'running'): TaskProjection => ({
  id: 'task-1',
  title: 'Book a hotel',
  status,
  messages: [
    { id: 'message-1', role: 'user', content: 'Book a hotel' },
    { id: 'assistant-1', role: 'agent', content: '' }
  ],
  steps: [{ id: 'step-1', title: 'Plan', detail: 'Planning', state: 'current' }],
  browser: null
})

function harness() {
  let currentTask = task()
  let eventListener: ((event: RuntimeEvent) => void) | undefined
  let streamListener: ((event: StreamServerEvent) => void) | undefined
  const api: AgentDesktopApi = {
    submit: vi.fn(async () => ({
      type: 'request.accepted' as const,
      protocol: 'actiondriver.stream.v1' as const,
      eventId: 'accepted-1',
      cursor: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'assistant-1',
      occurredAt: '2026-09-23T00:00:00.000Z'
    })),
    cancel: vi.fn(async () => undefined),
    subscribeStream: vi.fn((listener) => {
      streamListener = listener
      return () => {
        streamListener = undefined
      }
    }),
    get: vi.fn(async () => structuredClone(currentTask)),
    listTasks: vi.fn(async () => []),
    listModelLogs: vi.fn(async () => []),
    getModelLog: vi.fn(async () => null),
    interrupt: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    provideInput: vi.fn(async () => undefined),
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
  return {
    adapter: new DesktopAgentAdapter(api),
    skillGateway: new DesktopSkillGateway(api),
    api,
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
  it('subscribes before submit and projects the live stream without the legacy subscription', async () => {
    const { adapter, api, emitStream } = harness()
    const listener = vi.fn()
    adapter.subscribe(listener)

    const request = {
      goal: 'Book a hotel',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    }
    const submitted = await adapter.submitGoal(request)
    submitted.title = 'mutated outside the adapter'

    expect(api.submit).toHaveBeenCalledWith(request)
    expect(api.get).toHaveBeenCalledWith('task-1')
    expect(api.subscribeStream).toHaveBeenCalledOnce()
    expect(api.subscribe).not.toHaveBeenCalled()
    expect(vi.mocked(api.subscribeStream).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.submit).mock.invocationCallOrder[0]!
    )
    expect(adapter.getTask('task-1')?.title).toBe('Book a hotel')
    expect(listener).toHaveBeenLastCalledWith(task())

    emitStream({
      type: 'response.start',
      protocol: 'actiondriver.stream.v1',
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
      protocol: 'actiondriver.stream.v1',
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

  it('delegates interrupt, continue, and user input commands to the whitelisted API', async () => {
    const { adapter, api } = harness()

    await adapter.interrupt('task-1')
    await adapter.continueTask('task-1')
    await adapter.provideInput('task-1', { approved: true })

    expect(api.interrupt).toHaveBeenCalledWith('task-1')
    expect(api.continue).toHaveBeenCalledWith('task-1')
    expect(api.provideInput).toHaveBeenCalledWith('task-1', { approved: true })
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
    const { adapter, api } = harness()
    vi.mocked(api.submit).mockRejectedValue({ code: runtimeCode, message: 'runtime failed' })

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
