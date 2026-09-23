import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  SqliteRuntimeRepositories,
  openRuntimeDatabase,
  type PersistedMessage,
  type PersistedModelCall,
  type PersistedStreamRequest,
  type PersistedSkillInvocation,
  type PersistedStep,
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
    expect(created).toMatchObject({ created: true, request })

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
    expect(duplicate).toEqual({ created: false, request })
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

  it('stores and reads tasks, messages, steps, skill invocations, and ordered events', async () => {
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

    await repositories.messages.save(message)
    await repositories.steps.save(step)
    await repositories.skillInvocations.save(invocation)
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
    await expect(repositories.events.listAfter(0)).resolves.toEqual([{ ...event, cursor: 1 }])

    repositories.close()
  })

  it('lists recent tasks and persisted model calls in stable order after reopening', async () => {
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
    const modelCall: PersistedModelCall = {
      id: 'call-1',
      taskId: task.id,
      requestId: 'plan:task-1',
      correlationId: 'correlation-1',
      model: task.model,
      status: 'completed',
      request: { messages: [{ role: 'user', content: 'hello' }] },
      response: { choices: [{ message: { content: 'answer' } }] },
      error: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z'
    }
    await first.modelCalls.save(modelCall)
    first.close()

    const reopened = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    await expect(reopened.tasks.listRecent(20)).resolves.toEqual([
      expect.objectContaining({ id: 'task-2' }),
      expect.objectContaining({ id: 'task-1' })
    ])
    await expect(reopened.modelCalls.listByTask(task.id)).resolves.toEqual([modelCall])
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
