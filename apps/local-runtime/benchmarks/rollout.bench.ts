// @vitest-environment node
import { afterAll, beforeAll, bench, describe } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import type {
  PersistedMessage,
  PersistedStreamRequest,
  RuntimeEventRecord,
  RuntimeTaskRecord
} from '@action-driver/agent-runtime/ports'
import { RolloutSessionStore } from '../src/rollout/session-store'

const at = '2026-09-30T00:00:00.000Z'
const root = mkdtempSync(join(tmpdir(), 'action-driver-rollout-bench-'))
const paths = {
  sessionsRoot: join(root, 'sessions'),
  statePath: join(root, 'state.sqlite'),
  historyPath: join(root, 'history.sqlite')
}
let store: RolloutSessionStore
let peakRss = 0
let cacheMemory: {
  beforeRss: number
  afterRss: number
  beforeHeap: number
  afterHeap: number
} | null = null
let cachedAppendSequence = 1
let uncachedAppendSequence = 1

function sampleMemory(): void {
  peakRss = Math.max(peakRss, process.memoryUsage().rss)
}

function requestFor(index: number, sessionId = `session-${index}`): PersistedStreamRequest {
  return {
    requestId: `request-${index}`,
    idempotencyKey: `key-${index}`,
    sessionId,
    taskId: `task-${index}`,
    responseId: `response-${index}`,
    streamId: `stream-${index}`,
    messageId: `message-${index}`,
    status: 'running',
    lastSequence: -1,
    createdAt: at,
    updatedAt: at
  }
}

function taskFor(request: PersistedStreamRequest): RuntimeTaskRecord {
  return {
    id: request.taskId,
    sessionId: request.sessionId,
    threadId: request.sessionId,
    goal: 'benchmark',
    model: { connectionId: 'connection', modelId: 'model' },
    status: 'running',
    error: null,
    lastCheckpointId: null,
    createdAt: at,
    updatedAt: at
  }
}

function messageFor(request: PersistedStreamRequest, role: 'user' | 'assistant'): PersistedMessage {
  return {
    id: role === 'assistant' ? request.messageId : `user-${request.taskId}`,
    taskId: request.taskId,
    role,
    content: { text: role === 'user' ? 'benchmark' : '' },
    createdAt: at
  }
}

function eventFor(
  request: PersistedStreamRequest,
  index: number
): Omit<RuntimeEventRecord, 'cursor'> {
  return {
    taskId: request.taskId,
    threadId: request.sessionId,
    checkpointId: request.responseId,
    eventKey: `benchmark:${index}`,
    type: 'benchmark.tick',
    payload: { index },
    occurredAt: at,
    eventId: `${request.requestId}:${index}`,
    requestId: request.requestId,
    responseId: request.responseId,
    streamId: request.streamId,
    messageId: request.messageId,
    sequence: index
  }
}

async function seedRequest(request: PersistedStreamRequest): Promise<void> {
  await store.createStreamTask({
    request,
    task: taskFor(request),
    userMessage: messageFor(request, 'user'),
    assistantMessage: messageFor(request, 'assistant'),
    acceptedEvent: eventFor(request, 0)
  })
}

beforeAll(async () => {
  store = new RolloutSessionStore(paths)
  for (let index = 0; index < 1_000; index += 1) {
    await seedRequest(requestFor(index))
    if (index % 100 === 0) await setImmediate()
  }
  for (const count of [100, 1_000, 10_000]) {
    const request = requestFor(count + 1_000)
    await seedRequest(request)
    for (let index = 1; index <= count; index += 1) {
      await store.events.append(eventFor(request, index))
      if (index % 100 === 0) await setImmediate()
    }
  }
  sampleMemory()
  await store.events.listForRequestAfter('request-0', 0, 256)
  if (globalThis.gc) {
    globalThis.gc()
    const before = process.memoryUsage()
    await store.events.listForRequestAfter('request-11000', 0, 256)
    globalThis.gc()
    const after = process.memoryUsage()
    cacheMemory = {
      beforeRss: before.rss,
      afterRss: after.rss,
      beforeHeap: before.heapUsed,
      afterHeap: after.heapUsed
    }
  }
}, 300_000)

afterAll(() => {
  store?.close()
  const entries = readdirSync(join(paths.sessionsRoot, 'sessions'), { recursive: true })
  const longLog = entries.find(
    (entry) => typeof entry === 'string' && entry.endsWith('session-11000.jsonl')
  )
  console.log(
    JSON.stringify({
      benchmark: 'rollout',
      peakRssBytes: peakRss,
      cacheMemory,
      longLogBytes: longLog ? statSync(join(paths.sessionsRoot, 'sessions', longLog)).size : null,
      node: process.version
    })
  )
  rmSync(root, { recursive: true, force: true })
})

describe('rollout store read paths', () => {
  bench('lookup among 1 request', async () => {
    await store.streamRequests.getByTaskId('task-0')
    sampleMemory()
  })

  bench('lookup among 100 requests', async () => {
    await store.streamRequests.getByTaskId('task-99')
    sampleMemory()
  })

  bench('lookup among 1000 requests', async () => {
    await store.streamRequests.getByTaskId('task-999')
    sampleMemory()
  })

  for (const count of [100, 1_000, 10_000]) {
    const requestId = `request-${count + 1_000}`
    bench(`first page of ${count} events`, async () => {
      await store.events.listForRequestAfter(requestId, 0, 256)
      sampleMemory()
    })
    bench(`last page of ${count} events`, async () => {
      await store.events.listForRequestAfter(requestId, count - 256, 256)
      sampleMemory()
    })
  }

  bench('reopen and read 10000-event session', async () => {
    const reopened = new RolloutSessionStore(paths)
    try {
      await reopened.events.listForRequestAfter('request-11000', 0, 256)
      sampleMemory()
    } finally {
      reopened.close()
    }
  })

  bench('append to cached request', async () => {
    await store.events.append(eventFor(requestFor(0), cachedAppendSequence++))
    sampleMemory()
  })

  bench('append to uncached request', async () => {
    await store.events.append(eventFor(requestFor(1), uncachedAppendSequence++))
    sampleMemory()
  })
})
