import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolPresentation } from '@actiondriver/plugin-contracts'
import type { RequestCreateEvent, StreamServerEvent } from '@actiondriver/runtime-contracts'
import { STREAM_PROTOCOL } from '@actiondriver/runtime-contracts'
import {
  SqliteRuntimeRepositories,
  StreamSessionService,
  openRuntimeDatabase,
  type GraphRunner,
  type IdGenerator
} from '../../src/index'
import { SessionAssetStore } from '../../src/media/session-asset-store'
import { SessionInputFileStore } from '../../src/media/session-input-file-store'
import { SessionWorkspaceStore } from '../../src/execution/session-workspace'
import { SessionOutputStore } from '../../src/media/session-output-store'
import { readFileSync } from 'node:fs'
import { AppApprovalBroker } from '../../src/computer-use/app-approval-broker'

const temporaryDirectories: string[] = []

function createHarness(
  graphRunner: GraphRunner,
  rawToolIO?: { enabled: boolean; maxBytes?: number },
  listEnabledSkills?: () => Promise<Array<{ skillId: string; description: string }>>,
  describeSessionInputs?: (
    sessionId: string
  ) => Promise<Array<{ name: string; path: string; mimeType: string }>>,
  appApprovals?: AppApprovalBroker,
  turnEnded?: (taskId: string) => Promise<void>,
  toolPresentation?: (toolId: string) => ToolPresentation | undefined
) {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-stream-session-'))
  temporaryDirectories.push(directory)
  const database = openRuntimeDatabase(join(directory, 'actiondriver.db'))
  const repositories = new SqliteRuntimeRepositories(database)
  const assets = new SessionAssetStore({ database, rootDirectory: directory })
  const inputFiles = new SessionInputFileStore({
    database,
    rootDirectory: directory,
    workspaces: new SessionWorkspaceStore({ workspaceRoot: join(directory, 'workspace') })
  })
  const workspaces = new SessionWorkspaceStore({ workspaceRoot: join(directory, 'workspace') })
  const outputs = new SessionOutputStore({
    database,
    rootDirectory: directory,
    workspaces
  })
  const counters = new Map<string, number>()
  const ids: IdGenerator = {
    next(prefix) {
      const next = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, next)
      return `${prefix}-${next}`
    }
  }
  let now = Date.parse('2026-09-23T00:00:00.000Z')
  const service = new StreamSessionService({
    repositories,
    assets,
    inputFiles,
    outputs,
    listOutputs: (taskId) => outputs.listByTask(taskId),
    graphRunner,
    ...(appApprovals ? { appApprovals } : {}),
    ...(turnEnded ? { turnEnded } : {}),
    ...(toolPresentation ? { toolPresentation } : {}),
    ids,
    now: () => new Date(now++).toISOString(),
    ...(rawToolIO ? { rawToolIO } : {}),
    ...(listEnabledSkills ? { listEnabledSkills } : {}),
    ...(describeSessionInputs ? { describeSessionInputs } : {})
  })
  return {
    database,
    repositories,
    service,
    assets,
    inputFiles,
    outputs,
    workspaceRoot: join(directory, 'workspace')
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const createEvent: RequestCreateEvent = {
  type: 'request.create',
  protocol: 'actiondriver.stream.v2',
  eventId: 'client-event-1',
  createdAt: '2026-09-23T00:00:00.000Z',
  requestId: 'request-client-1',
  idempotencyKey: 'idempotency-1',
  sessionId: null,
  payload: {
    input: { role: 'user', content: 'Return **real Markdown**' },
    model: { connectionId: 'connection-real', modelId: 'gpt-real' },
    systemPrompt: 'Be concise.',
    skills: []
  }
}

async function runToEnd(
  service: StreamSessionService,
  event: RequestCreateEvent
): Promise<StreamServerEvent[]> {
  const published: StreamServerEvent[] = []
  await new Promise<void>((resolve) => {
    void service.handle(event, (serverEvent) => {
      published.push(serverEvent)
      if (serverEvent.type === 'response.end' || serverEvent.type === 'request.error') resolve()
    })
  })
  return published
}

describe('StreamSessionService', () => {
  it('ends every turn once, completed or failed, before its response.end is published', async () => {
    const order: string[] = []
    const turnEnded = vi.fn(async (taskId: string) => {
      order.push(`ended:${taskId}`)
    })
    let fail = false
    const harness = createHarness(
      {
        async run(request, _signal, observer) {
          await observer?.({ kind: 'end', content: '好', finishReason: 'stop', usage: null })
          return {
            taskId: request.taskId,
            threadId: request.taskId,
            status: fail ? ('failed' as const) : ('completed' as const),
            output: fail ? null : '好',
            error: fail ? 'MODEL_GATEWAY_ERROR' : null,
            trace: []
          }
        },
        interrupt: () => false,
        async continue() {
          throw new Error('unused')
        },
        async provideInput() {
          throw new Error('unused')
        }
      } as GraphRunner,
      undefined,
      undefined,
      undefined,
      undefined,
      turnEnded
    )
    const collect = async (event: RequestCreateEvent) => {
      const published: StreamServerEvent[] = []
      await new Promise<void>((resolve) => {
        void harness.service.handle(event, (serverEvent) => {
          published.push(serverEvent)
          if (serverEvent.type === 'response.end') {
            order.push(`end:${serverEvent.taskId}`)
            resolve()
          }
        })
      })
      return published.find((item) => item.type === 'request.accepted') as Extract<
        StreamServerEvent,
        { type: 'request.accepted' }
      >
    }

    const first = await collect(createEvent)
    fail = true
    const second = await collect({
      ...createEvent,
      eventId: 'client-event-2',
      requestId: 'request-client-2',
      idempotencyKey: 'idempotency-2'
    })

    expect(turnEnded.mock.calls).toEqual([[first.taskId], [second.taskId]])
    expect(order).toEqual([
      `ended:${first.taskId}`,
      `end:${first.taskId}`,
      `ended:${second.taskId}`,
      `end:${second.taskId}`
    ])
  })

  it('persists approval events with cursors and exposes only live approvals in snapshots', async () => {
    const ready: { service?: StreamSessionService } = {}
    const broker = new AppApprovalBroker({
      queryPolicy: async () => ({
        decision: 'allowed',
        allowPersistentApproval: true,
        target: {
          bundleId: 'com.apple.Notes',
          displayName: 'Notes',
          appPath: '/System/Applications/Notes.app',
          risk: 'low'
        }
      }),
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      withSuspendedTimeout: async (_, wait) => wait(),
      emit: (event) => ready.service!.publishAppApproval(event)
    })
    const run = vi.fn<GraphRunner['run']>(async (request, _signal, observer) => {
      await broker.authorize(
        { taskId: request.taskId, sessionId: request.sessionId! },
        { app: 'Notes' }
      )
      await observer?.({ kind: 'end', content: 'approved', finishReason: 'stop', usage: null })
      return {
        taskId: request.taskId,
        threadId: request.taskId,
        status: 'completed',
        output: 'approved',
        error: null,
        trace: []
      }
    })
    const harness = createHarness(
      {
        run,
        interrupt: () => false,
        continue: async () => {
          throw new Error('must not continue')
        },
        provideInput: async () => {
          throw new Error('must not replay')
        }
      },
      undefined,
      undefined,
      undefined,
      broker
    )
    const service = harness.service
    ready.service = service
    const events: StreamServerEvent[] = []
    await service.handle(createEvent, (event) => {
      events.push(event)
    })
    await vi.waitFor(() =>
      expect(
        events.map((e) => e.type),
        JSON.stringify(events)
      ).toContain('computer.app-approval.requested')
    )
    const requested = events.find((e) => e.type === 'computer.app-approval.requested')!
    if (requested.type !== 'computer.app-approval.requested') throw new Error('missing approval')
    expect((await service.getTaskSnapshot(requested.taskId))?.pendingAppApproval).toEqual([
      requested.approval
    ])
    const liveReconnect: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: STREAM_PROTOCOL,
        eventId: 'live-resume',
        createdAt: createEvent.createdAt,
        requestId: createEvent.requestId,
        afterCursor: 0
      },
      (event) => {
        liveReconnect.push(event)
        events.push(event)
      }
    )
    expect(liveReconnect).toHaveLength(1)
    expect(liveReconnect[0]).toMatchObject({
      type: 'response.snapshot',
      pendingAppApproval: [requested.approval]
    })
    await broker.decide(requested.taskId, requested.approval.requestId, 'once')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'response.end')).toBe(true))
    const resolved = events.find((e) => e.type === 'computer.app-approval.resolved')!
    expect(resolved.cursor).toBeGreaterThan(requested.cursor)
    expect((await service.getTaskSnapshot(requested.taskId))?.pendingAppApproval).toEqual([])
    expect((await service.getTaskSnapshot(requested.taskId))?.status).toBe('completed')
    const resumed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: STREAM_PROTOCOL,
        eventId: 'resume',
        createdAt: createEvent.createdAt,
        requestId: createEvent.requestId,
        afterCursor: requested.cursor
      },
      (event) => {
        resumed.push(event)
      }
    )
    expect(resumed.at(-1)).toMatchObject({ type: 'response.snapshot', pendingAppApproval: [] })
    expect(resumed).toHaveLength(1)
    expect(run).toHaveBeenCalledTimes(1)
    await service.handle(
      {
        ...createEvent,
        eventId: 'next-create',
        requestId: 'next-request',
        idempotencyKey: 'next-idempotency',
        sessionId: requested.sessionId,
        payload: { input: { role: 'user', content: 'continue' }, skills: [] }
      },
      (event) => {
        events.push(event)
      }
    )
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'computer.app-approval.requested')).toHaveLength(2)
    )
    const nextRequested = events.filter((e) => e.type === 'computer.app-approval.requested').at(-1)!
    if (nextRequested.type !== 'computer.app-approval.requested')
      throw new Error('missing next approval')
    await service.handle(
      {
        type: 'request.cancel',
        protocol: STREAM_PROTOCOL,
        eventId: 'cancel-request',
        createdAt: createEvent.createdAt,
        requestId: 'next-request',
        taskId: nextRequested.taskId,
        responseId: nextRequested.responseId
      },
      () => {}
    )
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'response.end' && e.requestId === 'next-request')).toBe(
        true
      )
    )
    expect(
      events.find(
        (e) =>
          e.type === 'computer.app-approval.resolved' &&
          e.approval.requestId === nextRequested.approval.requestId
      )
    ).toMatchObject({ decision: 'cancelled' })
    expect((await service.getTaskSnapshot(nextRequested.taskId))?.pendingAppApproval).toEqual([])
    expect((await service.getTaskSnapshot(nextRequested.taskId))?.status).toBe('cancelled')
    await expect(
      broker.decide(nextRequested.taskId, nextRequested.approval.requestId, 'once')
    ).rejects.toThrow('APPROVAL_STALE')
    await service.close()
    harness.database.close()
  })
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
  const completedGraph: GraphRunner = {
    async run(request) {
      return {
        taskId: request.taskId,
        threadId: request.taskId,
        status: 'completed',
        output: '已读取',
        error: null,
        trace: []
      }
    },
    interrupt: () => false,
    async continue() {
      throw new Error('unused')
    },
    async provideInput() {
      throw new Error('unused')
    }
  }

  it('materializes an uploaded document into the session input directory', async () => {
    const harness = createHarness(completedGraph)
    const staged = await harness.inputFiles.stageUpload({
      bytes: pdf,
      name: 'quarterly report.pdf',
      mimeType: 'application/pdf'
    })
    const events = await runToEnd(harness.service, {
      ...createEvent,
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '总结附件', inputFileIds: [staged.fileId] }
      }
    })
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing request')

    const messages = await harness.repositories.messages.listByTask(accepted.taskId)
    expect(messages[0]?.content).toEqual({
      parts: [
        { kind: 'text', text: '总结附件' },
        {
          kind: 'document',
          file: {
            fileId: staged.fileId,
            sessionId: accepted.sessionId,
            taskId: accepted.taskId,
            name: 'quarterly report.pdf',
            mimeType: 'application/pdf',
            byteLength: pdf.byteLength
          }
        }
      ]
    })
    expect(
      existsSync(
        join(harness.workspaceRoot, 'sessions', accepted.sessionId, 'input', 'quarterly report.pdf')
      )
    ).toBe(true)
    harness.repositories.close()
  })

  it('registers only the deliverables of successful tasks', async () => {
    const state = { workspaceRoot: '', write: null as null | 'pdf' | 'failed-pdf' }
    const harness = createHarness({
      async run(request, _signal, observer) {
        const output = join(state.workspaceRoot, 'sessions', request.sessionId!, 'output')
        mkdirSync(output, { recursive: true })
        if (state.write === 'pdf') writeFileSync(join(output, 'report.pdf'), pdf)
        if (state.write === 'failed-pdf') writeFileSync(join(output, 'draft.pdf'), pdf)
        await observer?.({
          kind: 'end',
          content: '已生成',
          finishReason: 'stop',
          usage: null
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: state.write === 'failed-pdf' ? ('failed' as const) : ('completed' as const),
          output: state.write === 'failed-pdf' ? null : '已生成',
          error: state.write === 'failed-pdf' ? 'MODEL_GATEWAY_ERROR' : null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    } as GraphRunner)
    state.workspaceRoot = harness.workspaceRoot

    state.write = 'pdf'
    const first = await runToEnd(harness.service, createEvent)
    const accepted = first.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing request')
    expect((await harness.outputs.listByTask(accepted.taskId)).map((file) => file.name)).toEqual([
      'report.pdf'
    ])
    const snapshot = await harness.service.getTaskSnapshot(accepted.taskId)
    expect(snapshot?.outputFiles).toEqual([
      expect.objectContaining({
        taskId: accepted.taskId,
        name: 'report.pdf',
        byteLength: pdf.byteLength
      })
    ])

    // The same session, an untouched old file and a failed task add nothing.
    state.write = null
    const second = await runToEnd(harness.service, {
      ...createEvent,
      eventId: 'client-event-2',
      requestId: 'request-client-2',
      idempotencyKey: 'idempotency-2',
      sessionId: accepted.sessionId,
      payload: { ...createEvent.payload, input: { role: 'user', content: '继续' } }
    })
    const secondAccepted = second.find((event) => event.type === 'request.accepted')
    if (!secondAccepted || secondAccepted.type !== 'request.accepted') {
      throw new Error('missing second request')
    }
    expect(await harness.outputs.listByTask(secondAccepted.taskId)).toEqual([])

    state.write = 'failed-pdf'
    const failed = await runToEnd(harness.service, {
      ...createEvent,
      eventId: 'client-event-3',
      requestId: 'request-client-3',
      idempotencyKey: 'idempotency-3',
      sessionId: accepted.sessionId,
      payload: { ...createEvent.payload, input: { role: 'user', content: '失败的任务' } }
    })
    const failedAccepted = failed.find((event) => event.type === 'request.accepted')
    if (!failedAccepted || failedAccepted.type !== 'request.accepted') {
      throw new Error('missing failed request')
    }
    expect(await harness.outputs.listByTask(failedAccepted.taskId)).toEqual([])
    harness.repositories.close()
  }, 30_000)

  it('offers bound session inputs to later tasks and hides other sessions', async () => {
    const seen: Array<Array<{ name: string; path: string; mimeType: string }> | undefined> = []
    let repositories: ReturnType<typeof createHarness>['repositories'] | null = null
    let workspaceRoot = ''
    const harness = createHarness(
      {
        async run(request) {
          seen.push(request.inputContext)
          return {
            taskId: request.taskId,
            threadId: request.taskId,
            status: 'completed',
            output: '已读取',
            error: null,
            trace: []
          }
        },
        interrupt: () => false,
        async continue() {
          throw new Error('unused')
        },
        async provideInput() {
          throw new Error('unused')
        }
      },
      undefined,
      undefined,
      async (sessionId) => {
        const files = await repositories!.inputFiles.listBySession(sessionId)
        return files
          .filter((file) => file.status === 'bound' && file.relativePath)
          .map((file) => ({
            name: file.name,
            path: join(workspaceRoot, 'sessions', sessionId, file.relativePath!),
            mimeType: file.mimeType
          }))
      }
    )
    repositories = harness.repositories
    workspaceRoot = harness.workspaceRoot

    const staged = await harness.inputFiles.stageUpload({
      bytes: pdf,
      name: 'quarterly.pdf',
      mimeType: 'application/pdf'
    })
    const first = await runToEnd(harness.service, {
      ...createEvent,
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '分析附件', inputFileIds: [staged.fileId] }
      }
    })
    const accepted = first.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing request')

    await runToEnd(harness.service, {
      ...createEvent,
      eventId: 'client-event-follow-up',
      requestId: 'request-client-follow-up',
      idempotencyKey: 'idempotency-follow-up',
      sessionId: accepted.sessionId,
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '继续处理同一个文件' }
      }
    })

    const expected = [
      {
        name: 'quarterly.pdf',
        path: join(harness.workspaceRoot, 'sessions', accepted.sessionId, 'input', 'quarterly.pdf'),
        mimeType: 'application/pdf'
      }
    ]
    expect(seen[0]).toEqual(expected)
    expect(seen[1]).toEqual(expected)

    const otherSession = await runToEnd(harness.service, {
      ...createEvent,
      eventId: 'client-event-other',
      requestId: 'request-client-other',
      idempotencyKey: 'idempotency-other',
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '另一个会话' }
      }
    })
    expect(otherSession.some((event) => event.type === 'request.accepted')).toBe(true)
    expect(seen[2]).toBeUndefined()
    harness.repositories.close()
  })

  it('rejects unknown or already attached uploads without creating a task', async () => {
    const harness = createHarness(completedGraph)
    const unknown = await runToEnd(harness.service, {
      ...createEvent,
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '附件', inputFileIds: ['missing-file'] }
      }
    })
    expect(unknown.at(-1)).toMatchObject({
      type: 'request.error',
      error: { code: 'input-invalid' }
    })

    const staged = await harness.inputFiles.stageUpload({
      bytes: pdf,
      name: 'report.pdf',
      mimeType: 'application/pdf'
    })
    await runToEnd(harness.service, {
      ...createEvent,
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '第一次', inputFileIds: [staged.fileId] }
      }
    })
    const secondSession = await runToEnd(harness.service, {
      ...createEvent,
      eventId: 'client-event-2',
      requestId: 'request-client-2',
      idempotencyKey: 'idempotency-2',
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '第二次', inputFileIds: [staged.fileId] }
      }
    })
    expect(secondSession.at(-1)).toMatchObject({
      type: 'request.error',
      error: { code: 'input-invalid' }
    })
    expect(await harness.repositories.tasks.listRecent(10)).toHaveLength(1)
    harness.repositories.close()
  })

  it('does not place an uncommitted image in the terminal snapshot after asset write failure', async () => {
    const png = readFileSync(join(process.cwd(), 'apps/agent-runtime/tests/fixtures/tiny.png'))
    const graphRunner: GraphRunner = {
      async run(request, _signal, _observer, onToolEvent) {
        const asset = await harness.assets.saveGenerated(request.sessionId!, png)
        const record = await harness.repositories.events.append({
          taskId: request.taskId,
          threadId: request.sessionId!,
          checkpointId: 'tool:0',
          eventKey: 'tool.asset:a:0',
          type: 'tool.asset',
          payload: {
            callId: 'a',
            toolId: 'tools/local/image-generation/generate',
            modelName: 'tools_local_image_generation_generate',
            summary: '生成图片',
            argumentsHash: '',
            activityId: null,
            index: 0,
            asset
          },
          occurredAt: '2026-09-23T00:00:01.000Z',
          eventId: 'asset-a',
          requestId: request.streamRequestId!,
          sequence: 1
        })
        await onToolEvent?.(record)
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const harness = createHarness(graphRunner)
    vi.spyOn(harness.repositories, 'commitAssistantImageWithEvent').mockImplementation(() => {
      throw new Error('image write failed')
    })
    const events = await runToEnd(harness.service, createEvent)
    expect(events.some((event) => event.type === 'response.image')).toBe(false)
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing request')
    const snapshot = await harness.service.getTaskSnapshot(accepted.taskId)
    expect(snapshot?.messages.at(-1)?.parts?.some((part) => part.kind === 'image')).not.toBe(true)
    harness.repositories.close()
  })
  it('does not publish an image batch when its atomic content commit fails', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, _observer, onToolEvent) {
        const record = await harness.repositories.events.append({
          taskId: request.taskId,
          threadId: request.sessionId!,
          checkpointId: 'tool:0',
          eventKey: 'tool.running:a',
          type: 'tool.running',
          payload: {
            callId: 'a',
            toolId: 'tools/local/image-generation/generate',
            modelName: 'tools_local_image_generation_generate',
            summary: '生成图片',
            argumentsHash: '',
            activityId: null,
            imageCount: 2
          },
          occurredAt: '2026-09-23T00:00:01.000Z',
          eventId: 'running-a',
          requestId: request.streamRequestId!,
          sequence: 1
        })
        await onToolEvent?.(record)
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const harness = createHarness(graphRunner)
    const original = harness.repositories.commitAssistantContentWithEvent.bind(harness.repositories)
    vi.spyOn(harness.repositories, 'commitAssistantContentWithEvent').mockImplementation(
      (...args) => {
        if (args[2].type === 'response.image_batch') throw new Error('storage failed')
        return original(...args)
      }
    )
    const events = await runToEnd(harness.service, createEvent)
    expect(events.some((event) => event.type === 'response.image_batch')).toBe(false)
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing request')
    const snapshot = await harness.service.getTaskSnapshot(accepted.taskId)
    expect(snapshot?.messages.at(-1)?.parts?.some((part) => part.kind === 'image-batch')).not.toBe(
      true
    )
    harness.repositories.close()
  })
  it('preserves legacy image tool batch positions before images and leaves final text after both batches', async () => {
    const png = readFileSync(join(process.cwd(), 'apps/agent-runtime/tests/fixtures/tiny.png'))
    const runningSnapshots: Array<Awaited<ReturnType<StreamSessionService['getTaskSnapshot']>>> = []
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer, onToolEvent) {
        const appendToolEvent = async (type: string, callId: string, index?: number) => {
          const asset =
            index === undefined
              ? undefined
              : await harness.assets.saveGenerated(request.sessionId!, png)
          const record = await harness.repositories.events.append({
            taskId: request.taskId,
            threadId: request.sessionId!,
            checkpointId: 'tool:0',
            eventKey: `${type}:${callId}:${index ?? 'start'}`,
            type,
            payload: {
              callId,
              toolId: 'tools/local/image-generation/generate',
              modelName: 'image_generate',
              summary: '生成图片',
              argumentsHash: '',
              activityId: null,
              imageCount: 2,
              ...(index === undefined ? {} : { index, asset })
            },
            occurredAt: '2026-09-23T00:00:01.000Z',
            eventId: `${type}-${callId}-${index ?? 'start'}`,
            requestId: request.streamRequestId!,
            sequence: index ?? 1
          })
          await onToolEvent?.(record)
        }
        await observer?.({ kind: 'content', delta: '过程一' })
        await appendToolEvent('tool.running', 'a')
        runningSnapshots.push(await harness.service.getTaskSnapshot(request.taskId))
        await observer?.({ kind: 'content', delta: '过程二' })
        await appendToolEvent('tool.running', 'b')
        for (const [callId, index] of [
          ['b', 1],
          ['a', 1],
          ['b', 0],
          ['a', 0]
        ] as const)
          await appendToolEvent('tool.asset', callId, index)
        await observer?.({ kind: 'content', delta: '全部完成' })
        await observer?.({ kind: 'end', content: '全部完成', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '全部完成',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const harness = createHarness(graphRunner)
    const events = await runToEnd(harness.service, createEvent)
    expect(
      events.filter((event) => event.type === 'response.image_batch').map((event) => event.callId)
    ).toEqual(['a', 'b'])
    expect(events.map((event) => event.type).indexOf('response.image_batch')).toBeLessThan(
      events.map((event) => event.type).indexOf('response.image')
    )
    expect(runningSnapshots[0]?.messages.at(-1)?.parts).toContainEqual({
      kind: 'image-batch',
      callId: 'a',
      imageCount: 2,
      order: 2
    })
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || !('taskId' in accepted)) throw new Error('missing task')
    const snapshot = await harness.service.getTaskSnapshot(accepted.taskId)
    // Streamed order is canonical: process text stays before the batches and
    // the closing answer after them.
    // The order contract reserves one slot per image, so the closing answer
    // keeps its place after both batches no matter which picture lands first.
    expect(snapshot?.messages.at(-1)?.parts?.filter((part) => part.kind !== 'image')).toEqual([
      { kind: 'text', text: '过程一', order: 1 },
      { kind: 'image-batch', callId: 'a', imageCount: 2, order: 2 },
      { kind: 'text', text: '过程二', order: 5 },
      { kind: 'image-batch', callId: 'b', imageCount: 2, order: 6 },
      { kind: 'text', text: '全部完成', order: 9 }
    ])
    expect(JSON.stringify(events)).not.toContain('data:image/')
    harness.repositories.close()
  })

  it('anchors a tool group where its tools ran instead of grouping it separately', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer, onToolEvent) {
        const appendToolEvent = async (type: string, callId: string, activityId: string) => {
          const record = await harness.repositories.events.append({
            taskId: request.taskId,
            threadId: request.sessionId!,
            checkpointId: 'tool:0',
            eventKey: `${type}:${callId}`,
            type,
            payload: {
              callId,
              toolId: 'sandbox.shell.run',
              modelName: 'tools_local_command_shell_run',
              summary: '执行命令',
              argumentsHash: '',
              activityId
            },
            occurredAt: '2026-09-23T00:00:01.000Z',
            eventId: `${type}-${callId}`,
            requestId: request.streamRequestId!,
            sequence: 1
          })
          await onToolEvent?.(record)
        }
        await observer?.({ kind: 'content', delta: '先说明' })
        for (const type of ['tool.proposed', 'tool.running', 'tool.completed'])
          await appendToolEvent(type, 'call-1', 'activity:default')
        await observer?.({ kind: 'content', delta: '全部完成' })
        await observer?.({ kind: 'end', content: '全部完成', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '全部完成',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const harness = createHarness(graphRunner)
    const events = await runToEnd(harness.service, createEvent)
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || !('taskId' in accepted)) throw new Error('missing task')
    const snapshot = await harness.service.getTaskSnapshot(accepted.taskId)
    // The group sits between the prose that preceded it and the prose that
    // followed it, and repeats of the same activity collapse into one anchor.
    expect(snapshot?.messages.at(-1)?.parts).toEqual([
      { kind: 'text', text: '先说明', order: 1 },
      { kind: 'activity', activityId: 'activity:default', order: 2 },
      { kind: 'text', text: '全部完成', order: 3 }
    ])
    harness.repositories.close()
  })

  it('keeps the streamed part order when a turn with images finishes', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer, onToolEvent) {
        const png = readFileSync(join(process.cwd(), 'apps/agent-runtime/tests/fixtures/tiny.png'))
        // 过程文本 → 生图（第二张先完成）→ 结尾文本，和"测试所有工具"场景一致。
        await observer?.({ kind: 'content', delta: '先看看现有依赖' })
        const batch = await harness.repositories.events.append({
          taskId: request.taskId,
          threadId: request.sessionId!,
          checkpointId: 'tool:0',
          eventKey: 'tool.running:image',
          type: 'tool.running',
          payload: {
            callId: 'call-1',
            toolId: 'tools/local/image-generation/generate',
            modelName: 'tools_local_image_generation_generate',
            summary: '生成 2 张图片',
            argumentsHash: '',
            activityId: null,
            imageCount: 2
          },
          occurredAt: '2026-09-23T00:00:02.000Z',
          eventId: 'tool-running-image',
          requestId: request.streamRequestId!,
          sequence: 2
        })
        await onToolEvent?.(batch)
        for (const index of [1, 0]) {
          const asset = await harness.assets.saveGenerated(request.sessionId!, png)
          const record = await harness.repositories.events.append({
            taskId: request.taskId,
            threadId: request.sessionId!,
            checkpointId: 'tool:0',
            eventKey: `tool.asset:${index}`,
            type: 'tool.asset',
            payload: {
              callId: 'call-1',
              toolId: 'tools/local/image-generation/generate',
              modelName: 'tools_local_image_generation_generate',
              summary: '生成 2 张图片',
              argumentsHash: '',
              activityId: null,
              index,
              asset
            },
            occurredAt: '2026-09-23T00:00:03.000Z',
            eventId: `tool-asset-${index}`,
            requestId: request.streamRequestId!,
            sequence: 3 + index
          })
          await onToolEvent?.(record)
        }
        await observer?.({ kind: 'content', delta: '图片已生成' })
        await observer?.({
          kind: 'end',
          content: '先看看现有依赖图片已生成',
          finishReason: 'stop',
          usage: null
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '过程文本图片已生成',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const harness = createHarness(graphRunner)
    const events = await runToEnd(harness.service, createEvent)
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing request')

    const stored = (await harness.repositories.messages.listByTask(accepted.taskId)).at(-1)
      ?.content as {
      parts?: Array<{ kind: string; text?: string; generation?: { index: number } }>
    }
    expect(
      stored.parts?.map((part) =>
        part.kind === 'image'
          ? `image:${part.generation?.index}`
          : `${part.kind}:${part.text ?? ''}`
      )
    ).toEqual(['text:先看看现有依赖', 'image-batch:', 'image:0', 'image:1', 'text:图片已生成'])
    harness.repositories.close()
  }, 30_000)

  it('streams completed images and keeps them in the final assistant snapshot', async () => {
    const completionOrder = [15, 1, 0, 2, ...Array.from({ length: 12 }, (_, offset) => offset + 3)]
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer, onToolEvent) {
        const png = readFileSync(join(process.cwd(), 'apps/agent-runtime/tests/fixtures/tiny.png'))
        for (const index of completionOrder) {
          const asset = await harness.assets.saveGenerated(request.sessionId!, png)
          const record = await harness.repositories.events.append({
            taskId: request.taskId,
            threadId: request.sessionId!,
            checkpointId: 'tool:0',
            eventKey: `tool.asset:${index}`,
            type: 'tool.asset',
            payload: {
              callId: 'call-1',
              toolId: 'tools/local/image-generation/generate',
              modelName: 'tools_local_image_generation_generate',
              summary: '生成图片',
              argumentsHash: '',
              activityId: null,
              index,
              asset
            },
            occurredAt: '2026-09-23T00:00:01.000Z',
            eventId: `tool-asset-${index}`,
            requestId: request.streamRequestId!,
            sequence: index
          })
          await onToolEvent?.(record)
        }
        await observer?.({ kind: 'end', content: '已生成图片', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '已生成图片',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const harness = createHarness(graphRunner)
    const events = await runToEnd(harness.service, createEvent)
    expect(events.filter((event) => event.type === 'response.image')).toHaveLength(16)
    const imageEvents = events.filter((event) => event.type === 'response.image')
    expect(imageEvents.map((event) => ('index' in event ? event.index : -1))).toEqual([
      15,
      1,
      0,
      2,
      ...Array.from({ length: 12 }, (_, offset) => offset + 3)
    ])
    expect(imageEvents.every((event) => 'contentIndex' in event && event.contentIndex >= 0)).toBe(
      true
    )
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || !('taskId' in accepted)) throw new Error('missing task')
    const snapshot = await harness.service.getTaskSnapshot(accepted.taskId)
    expect(snapshot?.messages.at(-1)?.parts?.map((part) => part.kind)).toEqual([
      ...Array(16).fill('image'),
      'text'
    ])
    // A stream without a batch anchor has no reservation to honour, so each
    // picture takes the next order and the transcript keeps arrival order; the
    // reserved slot order is covered by the batch tests above.
    const snapshotImages = snapshot?.messages.at(-1)?.parts?.filter((part) => part.kind === 'image')
    expect(snapshotImages?.map((part) => part.generation?.index)).toEqual(completionOrder)
    expect(snapshotImages?.map((part) => part.order)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1)
    )
    expect(JSON.stringify(snapshot)).not.toContain('data:image/')
    harness.repositories.close()
  })
  it('persists an image-only user turn and gives the graph an image reference', async () => {
    let graphInput: Parameters<GraphRunner['run']>[0] | null = null
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        graphInput = request
        await observer?.({ kind: 'end', content: '看到了图片', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '看到了图片',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const { service, assets, repositories } = createHarness(graphRunner)
    const image = readFileSync(join(process.cwd(), 'apps/agent-runtime/tests/fixtures/tiny.png'))
    const staged = await assets.stageUpload(image)
    const request: RequestCreateEvent = {
      ...createEvent,
      payload: {
        ...createEvent.payload,
        input: { role: 'user', content: '', imageAssetIds: [staged.assetId] }
      }
    }
    const events = await runToEnd(service, request)
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || !('taskId' in accepted)) throw new Error('Expected accepted request')
    const task = await repositories.tasks.get(accepted.taskId)
    expect(task?.goal).toBe('图片消息')
    const messages = await repositories.messages.listByTask(accepted.taskId)
    expect(messages[0]?.content).toMatchObject({
      parts: [{ kind: 'image', asset: { assetId: staged.assetId, sessionId: accepted.sessionId } }]
    })
    expect(graphInput).toMatchObject({
      currentMessage: {
        role: 'user',
        content: [{ kind: 'image', asset: { assetId: staged.assetId } }]
      }
    })
    const snapshot = await service.getTaskSnapshot(accepted.taskId)
    expect(snapshot?.messages[0]).toMatchObject({
      parts: [{ kind: 'image', asset: { assetId: staged.assetId } }]
    })
    expect(JSON.stringify(snapshot)).not.toContain('data:image/')
    await service.handle(request, () => undefined)
    expect(await repositories.messages.listByTask(accepted.taskId)).toHaveLength(2)
    repositories.close()
  })

  it('discovers currently enabled Skills for a new task', async () => {
    let discovered: unknown = null
    const graphRunner: GraphRunner = {
      async run(request) {
        discovered = request.skills
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('unused')
      },
      async provideInput() {
        throw new Error('unused')
      }
    }
    const { service } = createHarness(graphRunner, undefined, async () => [
      { skillId: 'skill-creator', description: 'Create a Skill' }
    ])
    await runToEnd(service, createEvent)
    expect(discovered).toEqual([{ skillId: 'skill-creator', description: 'Create a Skill' }])
  })
  it('publishes tool preparation before model completion and omits it from completed snapshots', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await observer?.({
          kind: 'tool-call-preparing',
          index: 0,
          modelName: 'tools_local_command_shell_run'
        })
        await gate
        await observer?.({ kind: 'end', content: 'done', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const events: StreamServerEvent[] = []
    let reachedPreparation!: () => void
    let reachedEnd!: () => void
    const preparation = new Promise<void>((resolve) => {
      reachedPreparation = resolve
    })
    const end = new Promise<void>((resolve) => {
      reachedEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      events.push(event)
      if (event.type === 'response.tool_preparing') reachedPreparation()
      if (event.type === 'response.end') reachedEnd()
    })
    await preparation
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || !('taskId' in accepted)) throw new Error('missing task')
    expect(events.map((event) => event.type)).toContain('response.tool_preparing')
    const progress = events.find((event) => event.type === 'response.tool_preparing')
    expect(progress).toMatchObject({ index: 0, modelName: 'tools_local_command_shell_run' })
    expect(progress).not.toHaveProperty('command')
    expect(progress).not.toHaveProperty('arguments')
    const runningSnapshot = await service.getTaskSnapshot(accepted.taskId)
    expect(runningSnapshot).toMatchObject({
      status: 'running',
      preparingToolName: 'tools_local_command_shell_run'
    })
    release()
    await end
    const completedSnapshot = await service.getTaskSnapshot(accepted.taskId)
    expect(completedSnapshot).toMatchObject({ status: 'completed' })
    expect(completedSnapshot).not.toHaveProperty('preparingToolName')
    expect(events.filter((event) => 'sequence' in event).map((event) => event.sequence)).toEqual(
      events
        .filter((event) => 'sequence' in event)
        .map((event) => event.sequence)
        .sort((a, b) => a - b)
    )
    repositories.close()
  })

  it('publishes concurrent activity callbacks in persisted cursor order', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await Promise.all([
          observer?.({
            kind: 'activity',
            event: { type: 'started', activityId: 'activity', title: '开始', titleRevision: 1 }
          } as never),
          observer?.({
            kind: 'activity',
            event: { type: 'updated', activityId: 'activity', title: '读取', titleRevision: 2 }
          } as never)
        ])
        await observer?.({ kind: 'end', content: '', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published: StreamServerEvent[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const ended = new Promise<void>((resolve) => {
      void service.handle(createEvent, async (event) => {
        if (event.type === 'activity.started') await firstGate
        published.push(event)
        if (event.type === 'response.end') resolve()
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    releaseFirst()
    await ended
    expect(published.filter((event) => 'cursor' in event).map((event) => event.cursor)).toEqual(
      [...published.filter((event) => 'cursor' in event).map((event) => event.cursor)].sort(
        (a, b) => a - b
      )
    )
    repositories.close()
  })

  it('reads a snapshot at one high-water cursor', async () => {
    const graphRunner: GraphRunner = {
      async run(request) {
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const events = await runToEnd(service, createEvent)
    const accepted = events.find((event) => event.type === 'request.accepted')
    if (!accepted || !('taskId' in accepted)) throw new Error('expected accepted')
    const read = await repositories.readStreamSnapshot(accepted.requestId)
    expect(read.events.every((event) => event.cursor <= read.cursor)).toBe(true)
    await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.taskId,
      checkpointId: 'later',
      eventKey: 'later',
      type: 'activity.updated',
      payload: { activityId: 'activity', title: 'later', titleRevision: 2 },
      occurredAt: '2026-09-24T00:00:00.000Z',
      requestId: accepted.requestId
    })
    expect(read.events.some((event) => event.eventKey === 'later')).toBe(false)
    repositories.close()
  })

  it('publishes and replays an ordered activity lifecycle with title revisions', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await observer?.({
          kind: 'activity',
          event: {
            type: 'started',
            activityId: 'activity-research',
            title: '正在调研',
            titleRevision: 1
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'text',
            activityId: 'activity-research',
            textId: 'plan:research',
            delta: '已读取 README。'
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'text',
            activityId: 'activity-research',
            textId: 'plan:research',
            delta: '正在核对配置。'
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'text.done',
            activityId: 'activity-research',
            textId: 'plan:research',
            phase: 'process'
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'updated',
            activityId: 'activity-research',
            title: '已完成调研',
            titleRevision: 2
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: { type: 'completed', activityId: 'activity-research' }
        } as never)
        await observer?.({ kind: 'end', content: 'done', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published = await runToEnd(service, createEvent)
    const accepted = published[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    const started = published[1]
    if (started?.type !== 'response.start') throw new Error('expected response.start')

    expect(published.map((event) => event.type)).toEqual([
      'request.accepted',
      'response.start',
      'activity.started',
      'activity.text',
      'activity.text',
      'activity.text.done',
      'activity.updated',
      'activity.completed',
      'response.end'
    ])
    expect(published[3]).toMatchObject({
      type: 'activity.text',
      activityId: 'activity-research',
      textId: 'plan:research',
      delta: '已读取 README。'
    })
    expect(published[4]).toMatchObject({
      type: 'activity.text',
      activityId: 'activity-research',
      textId: 'plan:research',
      delta: '正在核对配置。'
    })
    expect(published[5]).toMatchObject({
      type: 'activity.text.done',
      activityId: 'activity-research',
      textId: 'plan:research',
      phase: 'process'
    })
    expect(published[6]).toMatchObject({
      type: 'activity.updated',
      activityId: 'activity-research',
      title: '已完成调研',
      titleRevision: 2
    })

    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v2',
        eventId: 'resume-activity',
        createdAt: '2026-09-23T00:00:10.000Z',
        requestId: accepted.requestId,
        afterCursor: started.cursor
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed.map((event) => event.type)).toEqual([
      'activity.started',
      'activity.text',
      'activity.text',
      'activity.text.done',
      'activity.updated',
      'activity.completed',
      'response.end'
    ])

    repositories.close()
  })

  it('publishes future events to a resumed connection instead of a closed emitter', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await gate
        await observer?.({ kind: 'content', delta: 'after reconnect' })
        await observer?.({
          kind: 'end',
          content: 'after reconnect',
          finishReason: 'stop',
          usage: null
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'after reconnect',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const oldEvents: StreamServerEvent[] = []
    let started!: () => void
    const startSeen = new Promise<void>((resolve) => {
      started = resolve
    })
    await service.handle(createEvent, (event) => {
      oldEvents.push(event)
      if (event.type === 'response.start') started()
    })
    await startSeen
    const start = oldEvents.find((event) => event.type === 'response.start')
    if (!start || start.type !== 'response.start') throw new Error('missing start')
    const resumedEvents: StreamServerEvent[] = []
    let ended!: () => void
    const endSeen = new Promise<void>((resolve) => {
      ended = resolve
    })
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v2',
        eventId: 'resume-new-socket',
        createdAt: '2026-09-23T00:00:00.000Z',
        requestId: start.requestId,
        afterCursor: start.cursor
      },
      (event) => {
        resumedEvents.push(event)
        if (event.type === 'response.end') ended()
      }
    )
    release()
    await endSeen
    expect(resumedEvents.map((event) => event.type)).toEqual(['response.content', 'response.end'])
    expect(oldEvents.map((event) => event.type)).toEqual(['request.accepted', 'response.start'])
    await service.close()
    repositories.close()
  })
  it('replays persisted legacy approval events without requiring a live decision', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await gate
        await observer?.({ kind: 'end', content: 'done', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published: StreamServerEvent[] = []
    await service.handle(createEvent, (event) => {
      published.push(event)
    })
    const accepted = published.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing accepted')
    await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.sessionId,
      checkpointId: accepted.responseId,
      eventKey: 'call-1.1',
      type: 'tool.waiting_approval',
      payload: {
        callId: 'call-1',
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: 'rg TODO README.md',
        argumentsHash: 'sha256:abc'
      },
      occurredAt: '2026-09-23T00:00:01.000Z',
      eventId: 'tool-event-1',
      requestId: accepted.requestId,
      sequence: 1
    })
    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v2',
        eventId: 'resume-1',
        createdAt: '2026-09-23T00:00:02.000Z',
        requestId: accepted.requestId,
        afterCursor: accepted.cursor
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed).toContainEqual(
      expect.objectContaining({
        type: 'tool.waiting_approval',
        callId: 'call-1',
        callSequence: 1
      })
    )
    release()
    await service.close()
    repositories.close()
  })
  it('creates a new task in the same session and inherits model with complete history', async () => {
    const requests: Parameters<GraphRunner['run']>[0][] = []
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        requests.push(request)
        const answer = requests.length === 1 ? '第一答' : '第二答'
        await observer?.({ kind: 'end', content: answer, finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: answer,
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const first = await runToEnd(service, {
      ...createEvent,
      payload: { ...createEvent.payload, input: { role: 'user', content: '第一问' } }
    })
    const acceptedFirst = first.find((event) => event.type === 'request.accepted')
    if (!acceptedFirst || acceptedFirst.type !== 'request.accepted')
      throw new Error('missing first')

    const continuation: RequestCreateEvent = {
      type: 'request.create',
      protocol: 'actiondriver.stream.v2',
      eventId: 'client-event-2',
      createdAt: '2026-09-23T00:01:00.000Z',
      requestId: 'request-client-2',
      idempotencyKey: 'idempotency-2',
      sessionId: acceptedFirst.sessionId,
      payload: { input: { role: 'user', content: '第二问' }, skills: [] }
    }
    const second = await runToEnd(service, continuation)
    const acceptedSecond = second.find((event) => event.type === 'request.accepted')
    if (!acceptedSecond || acceptedSecond.type !== 'request.accepted') {
      throw new Error('missing second')
    }

    expect(acceptedSecond.sessionId).toBe(acceptedFirst.sessionId)
    expect(acceptedSecond.taskId).not.toBe(acceptedFirst.taskId)
    expect(requests[1]).toMatchObject({
      goal: '第二问',
      model: createEvent.payload.model,
      messages: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' }
      ]
    })
    await expect(repositories.tasks.listBySession(acceptedFirst.sessionId)).resolves.toHaveLength(2)

    const replay = await runToEnd(service, { ...continuation, eventId: 'client-event-retry' })
    expect(replay[0]).toMatchObject({ type: 'request.accepted', taskId: acceptedSecond.taskId })
    expect(requests).toHaveLength(2)
    repositories.close()
  })

  it('rejects unknown or busy sessions before writing a task', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, signal, observer) {
        await Promise.race([
          gate,
          new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
        ])
        await observer?.({ kind: 'end', content: 'done', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: signal?.aborted ? 'interrupted' : 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const unknown = await runToEnd(service, {
      ...createEvent,
      requestId: 'unknown-request',
      idempotencyKey: 'unknown-idempotency',
      sessionId: 'missing-session',
      payload: { input: { role: 'user', content: '继续' }, skills: [] }
    })
    expect(unknown).toEqual([
      expect.objectContaining({
        type: 'request.error',
        error: expect.objectContaining({ code: 'session-not-found' })
      })
    ])
    await expect(repositories.tasks.listRecent(20)).resolves.toHaveLength(0)

    const initialEvents: StreamServerEvent[] = []
    await service.handle(createEvent, (event) => {
      initialEvents.push(event)
    })
    const accepted = initialEvents.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing accepted')
    const busy = await runToEnd(service, {
      ...createEvent,
      eventId: 'busy-event',
      requestId: 'busy-request',
      idempotencyKey: 'busy-idempotency',
      sessionId: accepted.sessionId,
      payload: { input: { role: 'user', content: '不要并发' }, skills: [] }
    })
    expect(busy).toEqual([
      expect.objectContaining({
        type: 'request.error',
        error: expect.objectContaining({ code: 'session-busy' })
      })
    ])
    await expect(repositories.tasks.listBySession(accepted.sessionId)).resolves.toHaveLength(1)
    release()
    await service.close()
    repositories.close()
  })

  it('persists accepted/start/content/end before publishing and never re-executes an idempotent request', async () => {
    let graphRuns = 0
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        graphRuns += 1
        await observer?.({ kind: 'content', delta: '**real' })
        await observer?.({ kind: 'content', delta: ' answer**' })
        await observer?.({
          kind: 'end',
          content: '**real answer**',
          finishReason: 'stop',
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 }
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '**real answer**',
          error: null,
          trace: ['acceptGoal', 'plan', 'finish']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published: StreamServerEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    const emit = (event: StreamServerEvent) => {
      published.push(event)
      if (event.type === 'response.end') resolveEnd()
    }

    await service.handle(createEvent, emit)
    await ended

    expect(published.map((event) => event.type)).toEqual([
      'request.accepted',
      'response.start',
      'response.content',
      'response.content',
      'response.end'
    ])
    expect(published.map((event) => 'sequence' in event && event.sequence)).toEqual([0, 1, 2, 3, 4])
    const accepted = published[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    expect(accepted).toMatchObject({
      type: 'request.accepted',
      requestId: 'request-client-1'
    })
    await expect(repositories.tasks.get(accepted.taskId)).resolves.toMatchObject({
      status: 'completed',
      goal: 'Return **real Markdown**'
    })
    await expect(repositories.messages.listByTask(accepted.taskId)).resolves.toEqual([
      expect.objectContaining({
        role: 'user',
        content: { parts: [{ kind: 'text', text: 'Return **real Markdown**' }] }
      }),
      expect.objectContaining({ role: 'assistant', content: { text: '**real answer**' } })
    ])
    await expect(
      repositories.streamRequests.getByRequestId('request-client-1')
    ).resolves.toMatchObject({ status: 'completed', lastSequence: 4 })

    const replayed: StreamServerEvent[] = []
    await service.handle(
      { ...createEvent, eventId: 'client-event-duplicate', requestId: 'request-duplicate' },
      (event) => {
        replayed.push(event)
      }
    )
    expect(graphRuns).toBe(1)
    expect(replayed.map((event) => event.type)).toEqual([
      'request.accepted',
      'response.start',
      'response.content',
      'response.content',
      'response.end'
    ])

    repositories.close()
  })

  it('aborts an active request and preserves partial assistant content in a cancelled end event', async () => {
    let contentPublished!: () => void
    const sawContent = new Promise<void>((resolve) => {
      contentPublished = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, signal, observer) {
        await observer?.({ kind: 'content', delta: 'partial answer' })
        contentPublished()
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'interrupted',
          output: null,
          error: null,
          trace: ['acceptGoal', 'plan']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published: StreamServerEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      published.push(event)
      if (event.type === 'response.end') resolveEnd()
    })
    await sawContent
    const accepted = published.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') {
      throw new Error('expected request.accepted')
    }

    await service.handle(
      {
        type: 'request.cancel',
        protocol: 'actiondriver.stream.v2',
        eventId: 'client-event-cancel',
        createdAt: '2026-09-23T00:00:01.000Z',
        requestId: accepted.requestId,
        taskId: accepted.taskId,
        responseId: accepted.responseId
      },
      (event) => {
        published.push(event)
      }
    )
    await ended

    expect(published.at(-1)).toMatchObject({
      type: 'response.end',
      status: 'cancelled',
      content: 'partial answer',
      error: { code: 'cancelled' }
    })
    await expect(repositories.tasks.get(accepted.taskId)).resolves.toMatchObject({
      status: 'cancelled'
    })
    await expect(repositories.messages.listByTask(accepted.taskId)).resolves.toContainEqual(
      expect.objectContaining({ role: 'assistant', content: { text: 'partial answer' } })
    )

    repositories.close()
  })

  // 2.11: the user pressing Esc during Computer Use ends the session and stops the turn, using the
  // same abort path as a client-sent request.cancel.
  it('stops the running turn when Computer Use reports that the user pressed Esc', async () => {
    let started!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, signal) {
        started()
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'interrupted',
          output: null,
          error: null,
          trace: ['acceptGoal']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published: StreamServerEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      published.push(event)
      if (event.type === 'response.end') resolveEnd()
    })
    await running
    const accepted = published.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted')
      throw new Error('expected request.accepted')

    await expect(service.cancelTask(accepted.taskId)).resolves.toBe(true)
    await ended
    expect(published.at(-1)).toMatchObject({
      type: 'response.end',
      status: 'cancelled',
      error: { code: 'cancelled' }
    })
    await expect(service.cancelTask('task-not-running')).resolves.toBe(false)

    repositories.close()
  })

  it('returns one authoritative snapshot when the requested replay cursor has expired', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await observer?.({
          kind: 'activity',
          event: {
            type: 'started',
            activityId: 'activity-snapshot',
            title: '正在执行命令',
            titleRevision: 1
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: { type: 'text', activityId: 'activity-snapshot', delta: '已准备读取。' }
        } as never)
        await observer?.({
          kind: 'activity',
          event: { type: 'completed', activityId: 'activity-snapshot' }
        } as never)
        await observer?.({ kind: 'content', delta: 'final answer' })
        await observer?.({
          kind: 'end',
          content: 'final answer',
          finishReason: 'stop',
          usage: null
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'final answer',
          error: null,
          trace: ['acceptGoal', 'plan', 'finish']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { database, repositories, service } = createHarness(graphRunner)
    const initial: StreamServerEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      initial.push(event)
      if (event.type === 'response.end') resolveEnd()
    })
    await ended
    const accepted = initial[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    await repositories.toolInvocations.save({
      id: 'call-snapshot',
      providerCallId: 'provider-snapshot',
      taskId: accepted.taskId,
      toolId: 'tools/local/command/shell/run',
      toolVersion: 1,
      argumentsHash: '',
      decision: 'allow',
      status: 'completed',
      input: { path: 'README.md' },
      output: { text: 'read' },
      error: null,
      createdAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:01.000Z'
    })
    await repositories.toolInvocations.save({
      id: 'call-image-snapshot',
      providerCallId: 'provider-image-snapshot',
      taskId: accepted.taskId,
      toolId: 'tools/local/image-generation/generate',
      toolVersion: 1,
      argumentsHash: '',
      decision: 'allow',
      status: 'completed',
      input: { images: Array.from({ length: 16 }, (_, index) => ({ prompt: `image ${index}` })) },
      output: { result: { succeeded: 16, failed: 0 } },
      error: null,
      createdAt: '2026-09-23T00:00:02.000Z',
      updatedAt: '2026-09-23T00:00:03.000Z'
    })
    database.prepare('DELETE FROM runtime_events WHERE cursor <= 2').run()

    const resumed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v2',
        eventId: 'client-event-resume',
        createdAt: '2026-09-23T00:01:00.000Z',
        requestId: accepted.requestId,
        afterCursor: 0
      },
      (event) => {
        resumed.push(event)
      }
    )

    expect(resumed).toEqual([
      expect.objectContaining({
        type: 'response.snapshot',
        requestId: accepted.requestId,
        status: 'completed',
        sequence: 6,
        messages: [
          expect.objectContaining({ role: 'user', content: 'Return **real Markdown**' }),
          expect.objectContaining({ role: 'assistant', content: 'final answer' })
        ],
        tools: [
          expect.objectContaining({
            callId: 'call-snapshot',
            status: 'completed',
            title: '已执行命令'
          }),
          expect.objectContaining({ callId: 'call-image-snapshot', imageCount: 16 })
        ],
        activities: [
          expect.objectContaining({
            activityId: 'activity-snapshot',
            title: '正在执行命令',
            status: 'completed',
            items: [
              expect.objectContaining({ kind: 'text', content: '已准备读取。', phase: 'pending' })
            ]
          })
        ],
        activityTimeline: [
          { id: 'activity:activity-snapshot', kind: 'activity', activityId: 'activity-snapshot' }
        ]
      })
    ])

    const reopened = await service.getTaskSnapshot(accepted.taskId)
    expect(reopened).toMatchObject({
      type: 'response.snapshot',
      taskId: accepted.taskId,
      status: 'completed',
      activities: [expect.objectContaining({ activityId: 'activity-snapshot' })],
      activityTimeline: [expect.objectContaining({ kind: 'activity' })],
      tools: expect.arrayContaining([
        expect.objectContaining({ callId: 'call-image-snapshot', imageCount: 16 })
      ])
    })

    repositories.close()
  })

  it('projects terminal tool activity without streaming raw output or error details', async () => {
    const graphRunner: GraphRunner = {
      async run(request) {
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const initial = await runToEnd(service, createEvent)
    const accepted = initial[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    const record = await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.sessionId,
      checkpointId: accepted.responseId,
      eventKey: 'call-safe.2',
      type: 'tool.completed',
      payload: {
        callId: 'call-safe',
        toolId: 'tools/local/web/search@1',
        modelName: 'tools_local_web_search',
        summary: '搜索 “privacy news”',
        argumentsHash: '',
        output: {
          stdout: 'secret stdout',
          stderr: 'secret stderr',
          content: '',
          result: { results: [{ title: 'Safe result title' }], token: 'secret' },
          byteLength: 1,
          truncated: false
        }
      },
      occurredAt: '2026-09-23T00:00:03.000Z',
      eventId: 'tool-safe',
      requestId: accepted.requestId,
      sequence: 2
    })
    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v2',
        eventId: 'resume-safe',
        createdAt: '2026-09-23T00:00:04.000Z',
        requestId: accepted.requestId,
        afterCursor: record.cursor - 1
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        resultSummary: 'Safe result title',
        durationMs: 0
      })
    )
    expect(JSON.stringify(replayed)).not.toContain('secret stdout')
    expect(JSON.stringify(replayed)).not.toContain('secret')
    repositories.close()
  })

  it('exposes bounded raw tool I/O when the local runtime enables it', async () => {
    const graphRunner: GraphRunner = {
      async run(request) {
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner, {
      enabled: true,
      maxBytes: 12
    })
    const initial = await runToEnd(service, createEvent)
    const accepted = initial[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    const record = await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.sessionId,
      checkpointId: accepted.responseId,
      eventKey: 'call-raw.1',
      type: 'tool.completed',
      payload: {
        callId: 'call-raw',
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: '执行命令',
        argumentsHash: '',
        presentation: { input: [{ label: 'Command', path: 'command', kind: 'code' }], output: [] },
        input: { command: 'printf long-output' },
        output: 'this output is deliberately long',
        durationMs: 1
      },
      occurredAt: '2026-09-23T00:00:03.000Z',
      eventId: 'tool-raw',
      requestId: accepted.requestId,
      sequence: 1
    })
    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: STREAM_PROTOCOL,
        eventId: 'resume-raw',
        createdAt: '2026-09-23T00:00:04.000Z',
        requestId: accepted.requestId,
        afterCursor: record.cursor - 1
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        rawInput: expect.any(String),
        rawOutput: expect.any(String),
        rawOutputTruncated: true
      })
    )
    const raw = replayed.find((event) => event.type === 'tool.completed')
    if (raw?.type !== 'tool.completed') throw new Error('expected raw tool event')
    expect(raw.details).toEqual({
      input: [{ label: 'Command', kind: 'code', value: 'printf long-' }],
      output: [],
      truncated: true
    })
    expect(Buffer.byteLength(raw.rawInput ?? '', 'utf8')).toBeLessThanOrEqual(12)
    expect(Buffer.byteLength(raw.rawOutput ?? '', 'utf8')).toBeLessThanOrEqual(12)
    repositories.close()
  })

  it('replays the persisted Computer Use source and output after a reload', async () => {
    const source = 'await cua.getApp("Calculator")'
    const graphRunner: GraphRunner = {
      async run(request) {
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner, { enabled: true })
    const initial = await runToEnd(service, createEvent)
    const accepted = initial[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    const stored = await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.sessionId,
      checkpointId: accepted.responseId,
      eventKey: 'call-persisted.1',
      type: 'tool.completed',
      payload: {
        callId: 'call-persisted',
        toolId: 'tools/local/cua/js',
        modelName: 'js',
        summary: 'Computer Use',
        argumentsHash: '',
        input: { code: source },
        output: { stdout: '', stderr: '', content: 'printed before failing', result: null },
        durationMs: 1
      },
      occurredAt: '2026-09-23T00:00:03.000Z',
      eventId: 'tool-persisted',
      requestId: accepted.requestId,
      sequence: 1
    })
    expect(JSON.stringify(stored)).toContain('cua.getApp')
    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: STREAM_PROTOCOL,
        eventId: 'resume-persisted',
        createdAt: '2026-09-23T00:00:04.000Z',
        requestId: accepted.requestId,
        afterCursor: stored.cursor - 1
      },
      (event) => {
        replayed.push(event)
      }
    )
    const toolEvent = replayed.find((event) => event.type === 'tool.completed')
    if (toolEvent?.type !== 'tool.completed') throw new Error('expected tool.completed')
    expect(toolEvent.rawInput).toBe(JSON.stringify({ code: source }))
    expect(toolEvent.rawOutput).toContain('printed before failing')
    repositories.close()
  })

  it('ends as failed while retaining content emitted before a model failure', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await observer?.({ kind: 'content', delta: 'useful partial' })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'failed',
          output: null,
          error: 'MODEL_GATEWAY_ERROR: upstream disconnected',
          trace: ['acceptGoal', 'plan', 'failed']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    let terminal: StreamServerEvent | undefined
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      if (event.type === 'response.end') {
        terminal = event
        resolveEnd()
      }
    })
    await ended

    expect(terminal).toMatchObject({
      type: 'response.end',
      status: 'failed',
      content: 'useful partial',
      error: {
        code: 'model-execution-failed',
        message: 'MODEL_GATEWAY_ERROR: upstream disconnected'
      }
    })
    repositories.close()
  })

  it('aborts active model work before service shutdown resolves', async () => {
    let started!: () => void
    const active = new Promise<void>((resolve) => {
      started = resolve
    })
    let aborted = false
    const graphRunner: GraphRunner = {
      async run(request, signal) {
        started()
        await new Promise<void>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              resolve()
            },
            { once: true }
          )
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'interrupted',
          output: null,
          error: null,
          trace: ['acceptGoal', 'plan']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    await service.handle(createEvent, () => undefined)
    await active

    await service.close()

    expect(aborted).toBe(true)
    await expect(
      repositories.streamRequests.getByRequestId(createEvent.requestId)
    ).resolves.toMatchObject({ status: 'cancelled' })
    repositories.close()
  })
})

describe('semantic snapshot privacy and declaration ownership', () => {
  it.each([true, false])(
    'restores stored declarations and existing assets only when rawToolIO=%s',
    async (enabled) => {
      const graphRunner: GraphRunner = {
        async run(request) {
          return {
            taskId: request.taskId,
            threadId: request.taskId,
            status: 'completed',
            output: '',
            error: null,
            trace: []
          }
        },
        interrupt: () => false,
        async continue() {
          throw new Error('unused')
        },
        async provideInput() {
          throw new Error('unused')
        }
      }
      const fallback = {
        input: [{ label: 'Changed label', path: 'path', kind: 'text' as const }],
        output: []
      }
      const stored = {
        input: [{ label: 'Original', path: 'path', kind: 'text' as const }],
        output: [
          { label: 'Image', path: 'assets.*', kind: 'image' as const },
          { label: 'Count', path: 'result.count', kind: 'text' as const }
        ]
      }
      const { repositories, service } = createHarness(
        graphRunner,
        { enabled },
        undefined,
        undefined,
        undefined,
        undefined,
        () => fallback
      )
      const events = await runToEnd(service, createEvent)
      const accepted = events[0]
      if (accepted?.type !== 'request.accepted') throw new Error('accepted expected')
      const invocation = {
        id: 'semantic-call',
        providerCallId: 'provider-call',
        taskId: accepted.taskId,
        toolId: 'tools/local/example/run',
        toolVersion: 1,
        argumentsHash: '',
        decision: 'allow' as const,
        status: 'completed' as const,
        input: { path: 'safe', secret: 'private' },
        output: { result: { count: 0 } },
        error: null,
        createdAt: '2026-09-23T00:00:00.000Z',
        updatedAt: '2026-09-23T00:00:01.000Z'
      }
      const asset = {
        assetId: 'image',
        sessionId: accepted.sessionId,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: 1,
        source: 'generated'
      }
      await repositories.commitToolInvocationWithEvent(invocation, {
        taskId: accepted.taskId,
        threadId: accepted.sessionId,
        checkpointId: accepted.responseId,
        eventKey: 'semantic-asset',
        type: 'tool.asset',
        payload: {
          callId: invocation.id,
          toolId: invocation.toolId,
          modelName: 'example',
          summary: 'Example',
          argumentsHash: '',
          index: 0,
          asset,
          presentation: stored,
          input: invocation.input
        },
        occurredAt: invocation.updatedAt,
        eventId: 'semantic-asset',
        requestId: accepted.requestId,
        sequence: 0
      })
      const snapshot = await service.getTaskSnapshot(accepted.taskId)
      const tool = snapshot?.tools?.find((tool) => tool.callId === invocation.id)
      if (enabled) {
        expect(tool?.presentation).toEqual(stored)
        expect(tool?.details).toEqual({
          input: [{ label: 'Original', kind: 'text', value: 'safe' }],
          output: [
            { label: 'Image 1', kind: 'image', value: 'image', asset },
            { label: 'Count', kind: 'text', value: '0' }
          ]
        })
        expect(JSON.stringify(tool?.details)).not.toContain('private')
      } else {
        expect(tool?.details).toBeUndefined()
        expect(tool?.presentation).toBeUndefined()
      }
      repositories.close()
    }
  )
})
