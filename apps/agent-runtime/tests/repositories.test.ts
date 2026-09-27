import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readMessageContentParts } from '@actiondriver/contracts'
import {
  SqliteRuntimeRepositories,
  StreamSessionService,
  openRuntimeDatabase,
  type GraphRunner,
  type PersistedMessage,
  type PersistedStreamRequest,
  type PersistedSkillInvocation,
  type PersistedStep,
  type PersistedToolInvocation,
  type RuntimeEventRecord,
  type RuntimeTaskRecord
} from '../src/index'

const temporaryDirectories: string[] = []

function createRepositories(): SqliteRuntimeRepositories {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-repositories-'))
  temporaryDirectories.push(directory)
  return new SqliteRuntimeRepositories(openRuntimeDatabase(join(directory, 'actiondriver.db')))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const task: RuntimeTaskRecord = {
  id: 'task-1',
  threadId: 'task-1',
  sessionId: 'session-1',
  goal: 'research a product',
  model: { connectionId: 'connection-1', modelId: 'gpt-real' },
  status: 'running',
  error: null,
  lastCheckpointId: 'checkpoint-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('SQLite runtime repositories', () => {
  it('reads legacy text content as one ordered text part', () => {
    expect(readMessageContentParts({ text: '旧任务' })).toEqual([{ kind: 'text', text: '旧任务' }])
  })

  it('recovers an orphan request once without discarding partial text or retrying a running tool', async () => {
    const repositories = createRepositories()
    const request: PersistedStreamRequest = {
      requestId: 'request-restart',
      idempotencyKey: 'key-restart',
      sessionId: task.sessionId,
      taskId: task.id,
      responseId: 'response-restart',
      streamId: 'stream-restart',
      messageId: 'assistant-restart',
      status: 'running',
      lastSequence: -1,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    await repositories.createStreamTask({
      request,
      task,
      userMessage: {
        id: 'user-restart',
        taskId: task.id,
        role: 'user',
        content: { text: 'goal' },
        createdAt: task.createdAt
      },
      assistantMessage: {
        id: request.messageId,
        taskId: task.id,
        role: 'assistant',
        content: { text: 'partial answer' },
        createdAt: task.createdAt
      },
      acceptedEvent: {
        taskId: task.id,
        threadId: task.sessionId,
        checkpointId: request.responseId,
        eventKey: 'request.accepted',
        type: 'request.accepted',
        payload: {},
        occurredAt: task.createdAt,
        eventId: 'accepted-restart',
        requestId: request.requestId,
        responseId: request.responseId,
        streamId: request.streamId,
        messageId: request.messageId,
        sequence: null
      }
    })
    await repositories.toolInvocations.save({
      id: 'tool-restart',
      providerCallId: 'provider-restart',
      taskId: task.id,
      toolId: 'sandbox.shell.run',
      toolVersion: 1,
      argumentsHash: 'hash',
      decision: 'allow',
      status: 'running',
      input: { command: 'touch marker' },
      output: null,
      error: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    })
    await repositories.events.append({
      taskId: task.id,
      threadId: task.sessionId,
      checkpointId: request.responseId,
      eventKey: 'tool.running:tool-restart',
      type: 'tool.running',
      payload: {
        callId: 'tool-restart',
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: 'touch marker',
        argumentsHash: 'hash',
        activityId: null,
        callSequence: 0
      },
      occurredAt: task.createdAt,
      eventId: 'tool-running-restart',
      requestId: request.requestId,
      responseId: request.responseId,
      streamId: request.streamId,
      messageId: request.messageId,
      sequence: null
    })

    const first = await repositories.recoverInterruptedRequests('RUNTIME_RESTARTED')
    const second = await repositories.recoverInterruptedRequests('RUNTIME_RESTARTED')
    expect(first.map((event) => event.type)).toEqual(['tool.unknown', 'runtime.interrupted'])
    expect(second).toEqual([])
    expect((await repositories.tasks.get(task.id))?.status).toBe('failed')
    expect(
      (await repositories.streamRequests.getByRequestId(request.requestId))?.lastSequence
    ).toBe(3)
    expect((await repositories.messages.listByTask(task.id)).at(-1)?.content).toEqual({
      text: 'partial answer'
    })
    expect((await repositories.toolInvocations.listByTask(task.id))[0]?.status).toBe('unknown')
    const service = new StreamSessionService({
      repositories,
      graphRunner: {} as GraphRunner,
      ids: { next: (prefix) => prefix + '-replay' },
      now: () => task.updatedAt
    })
    const replayed: string[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v2',
        eventId: 'resume-restart',
        createdAt: task.updatedAt,
        requestId: request.requestId,
        afterCursor: 0
      },
      (event) => {
        replayed.push(event.type)
      }
    )
    expect(replayed).toEqual([
      'request.accepted',
      'tool.running',
      'tool.unknown',
      'runtime.interrupted'
    ])
    repositories.close()
  })

  it('allocates a contiguous event sequence for each interleaved request', async () => {
    const repositories = createRepositories()
    for (const id of ['a', 'b']) {
      const request: PersistedStreamRequest = {
        requestId: id,
        idempotencyKey: `key-${id}`,
        sessionId: `session-${id}`,
        taskId: `task-${id}`,
        responseId: `response-${id}`,
        streamId: `stream-${id}`,
        messageId: `assistant-${id}`,
        status: 'running',
        lastSequence: -1,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      }
      await repositories.createStreamTask({
        request,
        task: {
          ...task,
          id: request.taskId,
          threadId: request.taskId,
          sessionId: request.sessionId
        },
        userMessage: {
          id: `user-${id}`,
          taskId: request.taskId,
          role: 'user',
          content: { text: 'goal' },
          createdAt: task.createdAt
        },
        assistantMessage: {
          id: request.messageId,
          taskId: request.taskId,
          role: 'assistant',
          content: { text: '' },
          createdAt: task.createdAt
        },
        acceptedEvent: {
          taskId: request.taskId,
          threadId: request.sessionId,
          checkpointId: request.responseId,
          eventKey: 'request.accepted',
          type: 'request.accepted',
          payload: {},
          occurredAt: task.createdAt,
          eventId: `accepted-${id}`,
          requestId: id,
          responseId: request.responseId,
          streamId: request.streamId,
          messageId: request.messageId,
          sequence: null
        }
      })
    }
    for (const id of ['a', 'b', 'a', 'b']) {
      const previous = (await repositories.events.listAfter(0)).filter(
        (event) => event.requestId === id
      ).length
      await repositories.events.append({
        taskId: `task-${id}`,
        threadId: `session-${id}`,
        checkpointId: `response-${id}`,
        eventKey: `activity-${previous}`,
        type: 'activity.started',
        payload: { activityId: `activity-${id}` },
        occurredAt: task.createdAt,
        eventId: `${id}-${previous}`,
        requestId: id,
        sequence: null
      })
    }
    const events = await repositories.events.listAfter(0)
    expect(
      events.filter((event) => event.requestId === 'a').map((event) => event.sequence)
    ).toEqual([0, 1, 2])
    expect(
      events.filter((event) => event.requestId === 'b').map((event) => event.sequence)
    ).toEqual([0, 1, 2])
    expect((await repositories.streamRequests.getByRequestId('a'))?.lastSequence).toBe(2)
    repositories.close()
  })

  it('cancels only legacy pending approvals and never reopens a completed task', async () => {
    const repositories = createRepositories()
    const request: PersistedStreamRequest = {
      requestId: 'request-legacy',
      idempotencyKey: 'idempotency-legacy',
      sessionId: task.sessionId,
      taskId: task.id,
      responseId: 'response-legacy',
      streamId: 'stream-legacy',
      messageId: 'message-assistant-legacy',
      status: 'running',
      lastSequence: 1,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    await repositories.createStreamTask({
      request,
      task,
      userMessage: {
        id: 'message-user-legacy',
        taskId: task.id,
        role: 'user',
        content: { text: task.goal },
        createdAt: task.createdAt
      },
      assistantMessage: {
        id: request.messageId,
        taskId: task.id,
        role: 'assistant',
        content: { text: '' },
        createdAt: task.createdAt
      },
      acceptedEvent: {
        taskId: task.id,
        threadId: task.threadId,
        checkpointId: request.responseId,
        eventKey: 'request.accepted',
        type: 'request.accepted',
        payload: { requestId: request.requestId },
        occurredAt: task.createdAt,
        eventId: 'event-legacy-accepted',
        requestId: request.requestId,
        responseId: request.responseId,
        streamId: request.streamId,
        messageId: request.messageId,
        sequence: null
      }
    })
    const pending: PersistedToolInvocation = {
      id: 'call-legacy',
      providerCallId: 'provider-legacy',
      taskId: task.id,
      toolId: 'sandbox.shell.run',
      toolVersion: 1,
      argumentsHash: 'sha256:legacy',
      decision: 'require_approval',
      status: 'waiting_approval',
      input: { command: 'rg', args: ['needle'] },
      output: null,
      error: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    await repositories.toolInvocations.save(pending)
    await repositories.toolInvocations.save({
      ...pending,
      id: 'call-legacy-2',
      providerCallId: 'provider-legacy-2'
    })
    await repositories.tasks.save({
      ...task,
      id: 'task-complete',
      threadId: 'task-complete',
      sessionId: 'session-complete',
      status: 'completed'
    })
    await repositories.toolInvocations.save({
      ...pending,
      id: 'call-complete',
      taskId: 'task-complete'
    })

    await repositories.cancelLegacyPendingApprovals('TOOL_APPROVAL_REMOVED')
    expect(await repositories.toolInvocations.listByTask(task.id)).toMatchObject([
      { id: 'call-legacy', status: 'cancelled', error: { code: 'TOOL_APPROVAL_REMOVED' } },
      { id: 'call-legacy-2', status: 'cancelled', error: { code: 'TOOL_APPROVAL_REMOVED' } }
    ])
    expect(await repositories.tasks.get(task.id)).toMatchObject({ status: 'failed' })
    expect(await repositories.streamRequests.getByRequestId(request.requestId)).toMatchObject({
      status: 'failed'
    })
    expect(await repositories.toolInvocations.listByTask('task-complete')).toMatchObject([
      { id: 'call-complete', status: 'waiting_approval' }
    ])
    const events = await repositories.events.listAfter(0)
    expect(
      events.filter((event) => event.type !== 'request.accepted').map((event) => event.type)
    ).toEqual(['tool.cancelled', 'tool.cancelled', 'response.end'])
    const snapshot = await new StreamSessionService({
      repositories,
      graphRunner: {} as GraphRunner,
      ids: { next: () => 'event-legacy-snapshot' },
      now: () => '2026-01-01T00:00:02.000Z'
    }).getTaskSnapshot(task.id)
    expect(snapshot?.status).toBe('failed')
    expect(snapshot?.tools?.map((tool) => tool.status)).toEqual(['cancelled', 'cancelled'])
    expect(snapshot?.activityTimeline?.filter((item) => item.kind === 'tool')).toHaveLength(2)
    await repositories.cancelLegacyPendingApprovals('TOOL_APPROVAL_REMOVED')
    expect(await repositories.events.listAfter(0)).toHaveLength(events.length)
    repositories.close()
  })

  it('commits a tool transition and event atomically and ignores an identical replay', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)
    const invocation: PersistedToolInvocation = {
      id: 'call-atomic',
      providerCallId: 'provider-atomic',
      taskId: task.id,
      toolId: 'tools.local.command.shell.run',
      toolVersion: 1,
      argumentsHash: '',
      decision: 'allow',
      status: 'proposed',
      input: { path: 'README.md' },
      output: null,
      error: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    const event: Omit<RuntimeEventRecord, 'cursor'> = {
      taskId: task.id,
      threadId: task.threadId,
      checkpointId: 'checkpoint-1',
      eventKey: 'call-atomic.0',
      type: 'tool.proposed',
      payload: { callId: invocation.id },
      occurredAt: task.createdAt
    }
    const first = await repositories.commitToolInvocationWithEvent(invocation, event)
    const replay = await repositories.commitToolInvocationWithEvent(
      { ...invocation, status: 'completed' },
      event
    )
    expect(replay.cursor).toBe(first.cursor)
    expect(await repositories.events.listAfter(0)).toHaveLength(1)
    expect(await repositories.toolInvocations.listByTask(task.id)).toEqual([invocation])
    repositories.close()
  })

  it('creates one durable stream task per idempotency key and commits content atomically', async () => {
    const repositories = createRepositories()
    const streamTask: RuntimeTaskRecord = {
      ...task,
      threadId: 'thread-1',
      lastCheckpointId: null
    }
    const request: PersistedStreamRequest = {
      requestId: 'request-1',
      idempotencyKey: 'idempotency-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-assistant-1',
      status: 'running',
      lastSequence: -1,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    const userMessage: PersistedMessage = {
      id: 'message-user-1',
      taskId: streamTask.id,
      role: 'user',
      content: { text: streamTask.goal },
      createdAt: streamTask.createdAt
    }
    const assistantMessage: PersistedMessage = {
      id: request.messageId,
      taskId: streamTask.id,
      role: 'assistant',
      content: { text: '' },
      createdAt: streamTask.createdAt
    }
    const acceptedEvent: Omit<RuntimeEventRecord, 'cursor'> = {
      taskId: request.taskId,
      threadId: request.sessionId,
      checkpointId: request.responseId,
      eventKey: 'request.accepted',
      type: 'request.accepted',
      payload: { requestId: request.requestId },
      occurredAt: request.createdAt,
      eventId: 'event-accepted-1',
      requestId: request.requestId,
      responseId: request.responseId,
      streamId: request.streamId,
      messageId: request.messageId,
      sequence: null
    }

    const created = await repositories.createStreamTask({
      request,
      task: streamTask,
      userMessage,
      assistantMessage,
      acceptedEvent
    })
    expect(created).toMatchObject({ created: true, request: { ...request, lastSequence: 0 } })

    const duplicate = await repositories.createStreamTask({
      request: {
        ...request,
        requestId: 'request-duplicate',
        taskId: 'task-duplicate',
        responseId: 'response-duplicate',
        streamId: 'stream-duplicate',
        messageId: 'message-duplicate'
      },
      task: { ...streamTask, id: 'task-duplicate', threadId: 'session-duplicate' },
      userMessage: { ...userMessage, id: 'user-duplicate', taskId: 'task-duplicate' },
      assistantMessage: {
        ...assistantMessage,
        id: 'message-duplicate',
        taskId: 'task-duplicate'
      },
      acceptedEvent: {
        ...acceptedEvent,
        eventId: 'event-duplicate',
        taskId: 'task-duplicate',
        threadId: 'session-duplicate'
      }
    })
    expect(duplicate).toEqual({ created: false, request: { ...request, lastSequence: 0 } })
    await expect(repositories.tasks.get('task-duplicate')).resolves.toBeNull()

    const contentEvent: Omit<RuntimeEventRecord, 'cursor'> = {
      ...acceptedEvent,
      eventId: 'event-content-1',
      eventKey: 'response.content:1',
      type: 'response.content',
      payload: { delta: 'hello' },
      sequence: 1
    }
    const contentMessage = { ...assistantMessage, content: { text: 'hello' } }
    await repositories.commitAssistantContentWithEvent(request, contentMessage, contentEvent)
    await expect(repositories.messages.listByTask(streamTask.id)).resolves.toContainEqual(
      contentMessage
    )
    await expect(
      repositories.streamRequests.getByRequestId(request.requestId)
    ).resolves.toMatchObject({ lastSequence: 1 })

    await expect(
      repositories.commitAssistantContentWithEvent(
        request,
        { ...contentMessage, content: { text: 'must roll back' } },
        contentEvent
      )
    ).rejects.toThrow()
    await expect(repositories.messages.listByTask(streamTask.id)).resolves.toContainEqual(
      contentMessage
    )

    const completedRequest: PersistedStreamRequest = {
      ...request,
      status: 'completed',
      lastSequence: 2,
      updatedAt: '2026-01-01T00:00:01.000Z'
    }
    const completedTask: RuntimeTaskRecord = {
      ...streamTask,
      status: 'completed',
      updatedAt: completedRequest.updatedAt
    }
    const terminalEvent: Omit<RuntimeEventRecord, 'cursor'> = {
      ...contentEvent,
      eventId: 'event-end-1',
      eventKey: 'response.end:2',
      type: 'response.end',
      payload: { status: 'completed', content: 'hello' },
      occurredAt: completedRequest.updatedAt,
      sequence: 2
    }
    await repositories.finishStreamTask({
      request: completedRequest,
      task: completedTask,
      assistantMessage: contentMessage,
      event: terminalEvent
    })
    await expect(repositories.streamRequests.getByRequestId(request.requestId)).resolves.toEqual(
      completedRequest
    )
    await expect(repositories.tasks.get(streamTask.id)).resolves.toEqual(completedTask)
    await expect(repositories.events.listAfter(0)).resolves.toContainEqual(
      expect.objectContaining({ eventId: 'event-end-1', type: 'response.end', sequence: 2 })
    )

    repositories.close()
  })

  it('stores and reads tasks, messages, steps, skill and tool invocations, and ordered events', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)

    const message: PersistedMessage = {
      id: 'message-1',
      taskId: task.id,
      role: 'user',
      content: { text: 'research a product' },
      createdAt: task.createdAt
    }
    const step: PersistedStep = {
      id: 'step-1',
      taskId: task.id,
      stepKey: 'plan',
      title: 'Plan',
      detail: 'Create a plan',
      status: 'completed',
      checkpointId: 'checkpoint-1',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    const invocation: PersistedSkillInvocation = {
      id: 'invocation-1',
      taskId: task.id,
      requestedSkillId: 'browser-use',
      resolvedProviderId: 'mock.browser',
      providerVersion: '1.0.0',
      contractVersion: 1,
      status: 'completed',
      input: { url: 'https://example.com' },
      output: { title: 'Example' },
      error: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    const toolInvocation: PersistedToolInvocation = {
      id: 'call-1',
      providerCallId: 'provider-call-1',
      taskId: task.id,
      toolId: 'tools.local.command.shell.run',
      toolVersion: 1,
      argumentsHash: 'sha256:test',
      decision: 'allow',
      status: 'completed',
      input: { path: 'README.md' },
      output: { content: 'ok' },
      error: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }

    await repositories.messages.save(message)
    await repositories.steps.save(step)
    await repositories.skillInvocations.save(invocation)
    await repositories.toolInvocations.save(toolInvocation)
    const event = await repositories.events.append({
      taskId: task.id,
      threadId: task.threadId,
      checkpointId: 'checkpoint-1',
      eventKey: 'task.started',
      type: 'task.started',
      payload: { status: 'running' },
      occurredAt: task.createdAt
    })

    await expect(repositories.tasks.get(task.id)).resolves.toEqual(task)
    await expect(repositories.messages.listByTask(task.id)).resolves.toEqual([message])
    await expect(repositories.steps.listByTask(task.id)).resolves.toEqual([step])
    await expect(repositories.skillInvocations.listByTask(task.id)).resolves.toEqual([invocation])
    await expect(repositories.toolInvocations.listByTask(task.id)).resolves.toEqual([
      toolInvocation
    ])
    await expect(repositories.events.listAfter(0)).resolves.toEqual([{ ...event, cursor: 1 }])

    repositories.close()
  })

  it('lists recent tasks in stable order after reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actiondriver-repositories-reopen-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'actiondriver.db')
    const first = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    await first.tasks.save(task)
    await first.tasks.save({
      ...task,
      id: 'task-2',
      threadId: 'task-2',
      sessionId: 'session-2',
      goal: 'newer task',
      createdAt: '2026-01-01T00:01:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z'
    })
    first.close()

    const reopened = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    await expect(reopened.tasks.listRecent(20)).resolves.toEqual([
      expect.objectContaining({ id: 'task-2' }),
      expect.objectContaining({ id: 'task-1' })
    ])
    reopened.close()
  })

  it('groups ordered tasks and messages by session and lists the latest task once', async () => {
    const repositories = createRepositories()
    const first = { ...task, id: 'task-1', threadId: 'thread-1', sessionId: 'session-1' }
    const second = {
      ...task,
      id: 'task-2',
      threadId: 'thread-2',
      sessionId: 'session-1',
      goal: 'continue',
      createdAt: '2026-01-01T00:01:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z'
    }
    await repositories.tasks.save(first)
    await repositories.tasks.save(second)
    await repositories.messages.save({
      id: 'message-1',
      taskId: first.id,
      role: 'user',
      content: { text: 'first' },
      createdAt: first.createdAt
    })
    await repositories.messages.save({
      id: 'message-2',
      taskId: second.id,
      role: 'assistant',
      content: { text: 'second' },
      createdAt: second.createdAt
    })

    await expect(repositories.tasks.getLatestBySession('session-1')).resolves.toEqual(second)
    await expect(repositories.tasks.listBySession('session-1')).resolves.toEqual([first, second])
    await expect(repositories.tasks.listRecentSessions(20)).resolves.toEqual([second])
    await expect(repositories.messages.listBySession('session-1')).resolves.toMatchObject([
      { id: 'message-1', taskId: 'task-1' },
      { id: 'message-2', taskId: 'task-2' }
    ])

    repositories.close()
  })

  it('preserves message insertion order when one task writes user and assistant in the same millisecond', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)
    await repositories.messages.save({
      id: 'z-user',
      taskId: task.id,
      role: 'user',
      content: { text: 'first question' },
      createdAt: task.createdAt
    })
    await repositories.messages.save({
      id: 'a-assistant',
      taskId: task.id,
      role: 'assistant',
      content: { text: 'first answer' },
      createdAt: task.createdAt
    })

    await expect(repositories.messages.listByTask(task.id)).resolves.toMatchObject([
      { id: 'z-user', role: 'user' },
      { id: 'a-assistant', role: 'assistant' }
    ])
    await expect(repositories.messages.listBySession(task.sessionId)).resolves.toMatchObject([
      { id: 'z-user', role: 'user' },
      { id: 'a-assistant', role: 'assistant' }
    ])
    repositories.close()
  })

  it('commits a task state change and its event atomically', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)
    const completed = { ...task, status: 'completed', updatedAt: '2026-01-01T00:01:00.000Z' }
    const event: Omit<RuntimeEventRecord, 'cursor'> = {
      taskId: task.id,
      threadId: task.threadId,
      checkpointId: 'checkpoint-2',
      eventKey: 'task.completed',
      type: 'task.completed',
      payload: { status: 'completed' },
      occurredAt: completed.updatedAt
    }

    await repositories.commitTaskStateWithEvent(completed, event)
    await expect(repositories.tasks.get(task.id)).resolves.toMatchObject({ status: 'completed' })
    await expect(repositories.events.listAfter(0)).resolves.toHaveLength(1)

    const conflicting = { ...completed, status: 'failed', updatedAt: '2026-01-01T00:02:00.000Z' }
    await expect(repositories.commitTaskStateWithEvent(conflicting, event)).rejects.toThrow()
    await expect(repositories.tasks.get(task.id)).resolves.toMatchObject({ status: 'completed' })
    await expect(repositories.events.listAfter(0)).resolves.toHaveLength(1)

    repositories.close()
  })

  it('keeps database drivers out of Electron Main and Renderer sources', () => {
    const desktopSource = resolve(process.cwd(), 'apps/desktop/src')
    const sourceFiles = readdirSync(desktopSource, { recursive: true })
      .flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
      .filter((entry) => /\.[cm]?[jt]sx?$/.test(entry))
      .map((entry) => readFileSync(join(desktopSource, entry), 'utf8'))

    expect(sourceFiles.join('\n')).not.toMatch(
      /from ['"]better-sqlite3['"]|require\(['"]better-sqlite3['"]\)/
    )
  })
})
