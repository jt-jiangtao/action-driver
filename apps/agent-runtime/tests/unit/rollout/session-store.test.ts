import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  PersistedMessage,
  PersistedStreamRequest,
  RuntimeEventRecord,
  RuntimeTaskRecord
} from '../../../src/ports'
import { RolloutSessionStore } from '../../../src/rollout/session-store'

const temporaryDirectories: string[] = []

function workspace(): { root: string; statePath: string; historyPath: string; sessionsRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'action-driver-session-store-'))
  temporaryDirectories.push(root)
  return {
    root,
    sessionsRoot: join(root, 'sessions'),
    statePath: join(root, 'state.sqlite'),
    historyPath: join(root, 'history.sqlite')
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const request: PersistedStreamRequest = {
  requestId: 'request-1',
  idempotencyKey: 'key-1',
  sessionId: 'session-1',
  taskId: 'turn-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'message-1',
  status: 'running',
  lastSequence: -1,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z'
}

const task: RuntimeTaskRecord = {
  id: 'turn-1',
  threadId: 'session-1',
  sessionId: 'session-1',
  goal: '生成图片并压缩',
  model: { connectionId: 'conn', modelId: 'model' },
  status: 'running',
  error: null,
  lastCheckpointId: null,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z'
}

const message: PersistedMessage = {
  id: 'message-1',
  taskId: 'turn-1',
  role: 'assistant',
  content: { text: '' },
  createdAt: '2026-09-30T00:00:00.000Z'
}

function event(
  type: string,
  payload: unknown,
  at: string,
  sequence: number
): Omit<RuntimeEventRecord, 'cursor'> {
  return {
    taskId: 'turn-1',
    threadId: 'session-1',
    checkpointId: 'response-1',
    eventKey: `${type}:${sequence}`,
    type,
    payload,
    occurredAt: at,
    eventId: `${type}:${sequence}`,
    requestId: 'request-1',
    responseId: 'response-1',
    streamId: 'stream-1',
    messageId: 'message-1',
    sequence
  }
}

const asset = {
  assetId: 'asset-1',
  sessionId: 'session-1',
  mimeType: 'image/png' as const,
  width: 64,
  height: 64,
  byteLength: 1024,
  source: 'generated' as const
}

async function runTurn(store: RolloutSessionStore): Promise<void> {
  await store.createStreamTask({
    request,
    task,
    userMessage: { ...message, role: 'user' },
    assistantMessage: message,
    acceptedEvent: event('request.accepted', {}, request.createdAt, 0)
  })
  await store.commitAssistantContentWithEvent(
    request,
    message,
    event('response.start', { model: task.model }, '2026-09-30T00:00:01.000Z', 1)
  )
  await store.commitAssistantContentWithEvent(
    request,
    message,
    event('activity.text', { activityId: null, textId: 'text:turn-1:1', delta: '先看看' }, '2026-09-30T00:00:02.000Z', 2)
  )
  await store.commitAssistantContentWithEvent(
    request,
    message,
    event('response.content', { delta: '先看看', contentIndex: 0, order: 1 }, '2026-09-30T00:00:02.100Z', 3)
  )
  await store.commitAssistantContentWithEvent(
    request,
    message,
    event('activity.text.done', { activityId: null, textId: 'text:turn-1:1', phase: 'process' }, '2026-09-30T00:00:02.200Z', 4)
  )
  await store.events.append(
    event('activity.started', { activityId: 'activity:turn-1:1', title: '生成图片', titleRevision: 1 }, '2026-09-30T00:00:03.000Z', 5)
  )
  await store.commitAssistantContentWithEvent(
    request,
    message,
    event('response.image_batch', { callId: 'call-1', imageCount: 2, contentIndex: 1, order: 3 }, '2026-09-30T00:00:04.000Z', 6)
  )
  await store.events.append(
    event('tool.proposed', { callId: 'call-1', toolId: 'tools/local/image-generation/generate', modelName: 'image_generate', summary: '生成图片', argumentsHash: '', activityId: 'activity:turn-1:1', callSequence: 7 }, '2026-09-30T00:00:05.000Z', 7)
  )
  await store.commitAssistantImageWithEvent(
    request,
    message,
    event('response.image', { asset, callId: 'call-1', index: 0, contentIndex: 2, order: 4 }, '2026-09-30T00:00:06.000Z', 8)
  )
  await store.events.append(
    event('activity.completed', { activityId: 'activity:turn-1:1' }, '2026-09-30T00:00:07.000Z', 9)
  )
  await store.finishStreamTask({
    request: { ...request, status: 'completed' },
    task: { ...task, status: 'completed' },
    assistantMessage: message,
    event: event('response.end', { status: 'completed', content: '完成', durationMs: 7000 }, '2026-09-30T00:00:08.000Z', 10)
  })
}

describe('rollout session store', () => {
  it('writes domain records to one JSONL log', async () => {
    const paths = workspace()
    const store = new RolloutSessionStore(paths)
    await runTurn(store)
    store.close()

    const raw = readFileSync(findRolloutFile(paths.sessionsRoot), 'utf8')
    const records = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { t: string })
    expect(records[0]?.t).toBe('session_meta')
    expect(records.map((record) => record.t)).toContain('block')
    expect(records.map((record) => record.t)).toContain('tool')
    expect(records.map((record) => record.t)).toContain('turn_end')
    // Binary assets stay in the file store; the log only ever carries a reference.
    expect(raw).not.toMatch(/data:image\//)
    expect(raw).toContain('asset-1')
  })

  it('reopens a session from disk with the same messages, tools and events', async () => {
    const paths = workspace()
    const store = new RolloutSessionStore(paths)
    await runTurn(store)
    store.close()

    const reopened = new RolloutSessionStore(paths)
    const snapshot = await reopened.readStreamSnapshot('request-1')
    const parts = (snapshot.messages.at(-1)?.content as { parts?: unknown[] }).parts ?? []
    expect(parts.map((part) => (part as { kind: string }).kind)).toEqual([
      'text',
      'activity',
      'image-batch',
      // The closing answer the model never streamed stays after the pictures.
      'image',
      'text'
    ])
    expect((parts[0] as { text: string }).text).toBe('先看看')
    expect((parts[2] as { imageCount: number }).imageCount).toBe(2)
    expect((parts[3] as { order: number }).order).toBe(4)
    expect(snapshot.tools.map((tool) => tool.id)).toEqual(['call-1'])
    expect(snapshot.events.some((entry) => entry.type === 'response.end')).toBe(true)
    expect(
      snapshot.events.filter((entry) => entry.type === 'response.content').map((entry) => entry.payload)
    ).toEqual([{ delta: '先看看', contentIndex: 0, order: 1 }])
    reopened.close()
  })

  it('keeps the image batch slots after the reserving record', async () => {
    const paths = workspace()
    const store = new RolloutSessionStore(paths)
    await runTurn(store)
    const snapshot = await store.readStreamSnapshot('request-1')
    const batch = snapshot.events.find((entry) => entry.type === 'response.image_batch')
    expect(batch?.payload).toEqual({ callId: 'call-1', imageCount: 2, contentIndex: 2, order: 3 })
    store.close()
  })

  it('writes the placeholder and the pending tool before their results', async () => {
    const paths = workspace()
    const store = new RolloutSessionStore(paths)
    await runTurn(store)
    store.close()
    const records = readFileSync(findRolloutFile(paths.sessionsRoot), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { t: string; kind?: string; status?: string; callId?: string })
    const kinds = records.map((record) => (record.t === 'block' ? `block:${record.kind}` : record.t))
    // The batch reserves its slots before any picture lands, and the tool is
    // recorded as proposed/running before it completes.
    expect(kinds.indexOf('block:image_batch')).toBeLessThan(kinds.indexOf('block:image'))
    const batch = records.findIndex((record) => record.kind === 'image_batch')
    const proposed = records.findIndex((record) => record.t === 'tool')
    const firstImage = records.findIndex((record) => record.kind === 'image')
    expect(batch).toBeLessThan(firstImage)
    expect(proposed).toBeLessThan(firstImage)
  })

  it('ends an interrupted turn by appending, never rewriting, history', async () => {
    const paths = workspace()
    const store = new RolloutSessionStore(paths)
    await store.createStreamTask({
      request,
      task,
      userMessage: { ...message, role: 'user' },
      assistantMessage: message,
      acceptedEvent: event('request.accepted', {}, request.createdAt, 0)
    })
    await store.events.append(
      event(
        'activity.started',
        { activityId: 'activity:turn-1:1', title: '执行命令', titleRevision: 1 },
        '2026-09-30T00:00:02.000Z',
        1
      )
    )
    await store.events.append(
      event(
        'tool.running',
        {
          callId: 'call-9',
          toolId: 'sandbox.shell.run',
          modelName: 'shell_run',
          summary: '执行命令',
          argumentsHash: '',
          activityId: 'activity:turn-1:1',
          callSequence: 2
        },
        '2026-09-30T00:00:03.000Z',
        2
      )
    )
    const before = readFileSync(findRolloutFile(paths.sessionsRoot))

    const recovered = await store.recoverInterruptedRequests('RUNTIME_RESTARTED')
    const after = readFileSync(findRolloutFile(paths.sessionsRoot))
    expect(after.subarray(0, before.length).equals(before)).toBe(true)
    expect(recovered.some((entry) => entry.type === 'tool.unknown')).toBe(true)
    expect(recovered.some((entry) => entry.type === 'response.end')).toBe(true)
    expect((await store.streamRequests.getByRequestId('request-1'))?.status).toBe('failed')
    expect((await store.readStreamSnapshot('request-1')).task?.status).toBe('failed')

    // Recovery is idempotent: a second call finds nothing left running.
    const second = await store.recoverInterruptedRequests('RUNTIME_RESTARTED')
    expect(second).toHaveLength(0)
    store.close()
  })
})

function findRolloutFile(root: string): string {
  const walk = (directory: string): string | null => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        const found = walk(path)
        if (found) return found
      } else if (entry.endsWith('.jsonl')) return path
    }
    return null
  }
  const found = walk(root)
  if (!found) throw new Error(`No rollout file under ${root}`)
  return found
}
