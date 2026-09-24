import { describe, expect, it } from 'vitest'
import {
  createLangSmithClient,
  createLangSmithConfiguration,
  LangSmithObservability
} from '../src/langsmith-observability'

describe('LangSmith configuration', () => {
  it('requires an API key and never exposes it in diagnostics', () => {
    const result = createLangSmithConfiguration({ LANGSMITH_API_KEY: 'secret-value' })
    expect(result).toMatchObject({ available: true, endpoint: 'https://api.smith.langchain.com' })
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })

  it('rejects a non-HTTPS endpoint', () => {
    expect(() =>
      createLangSmithConfiguration({
        LANGSMITH_API_KEY: 'secret',
        LANGSMITH_ENDPOINT: 'http://bad'
      })
    ).toThrow('LANGSMITH_ENDPOINT')
  })

  it('keeps an invalid endpoint from starting the Runtime adapter', async () => {
    const adapter = new LangSmithObservability({
      LANGSMITH_API_KEY: 'private',
      LANGSMITH_ENDPOINT: 'https://user:pass@api.example.com'
    })
    await expect(adapter.list({})).rejects.toThrow('LANGSMITH_ENDPOINT')
    expect(JSON.stringify(adapter.configuration)).not.toContain('private')
  })

  it('keeps the SDK client inside the Runtime configuration boundary', () => {
    expect(createLangSmithClient({})).toBeNull()
    expect(createLangSmithClient({ LANGSMITH_API_KEY: 'secret' })).not.toBeNull()
  })

  it('maps regional API endpoints to their LangSmith Web origin', () => {
    expect(
      createLangSmithConfiguration({
        LANGSMITH_API_KEY: 'secret',
        LANGSMITH_ENDPOINT: 'https://eu.api.smith.langchain.com'
      })
    ).toMatchObject({
      available: true,
      webOrigin: 'https://eu.smith.langchain.com'
    })
  })
})

describe('LangSmith observability', () => {
  it('writes a sanitized completed model run with ActionDriver correlation', async () => {
    const created: unknown[] = []
    const updated: unknown[] = []
    const adapter = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'ls-secret' },
      {
        createRun: async (run) => {
          created.push(run)
        },
        updateRun: async (_id, run) => {
          updated.push(run)
        },
        flush: async () => {},
        listRuns: async function* () {}
      }
    )
    await adapter.start({
      id: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-1',
      taskId: 'task-1',
      requestId: 'req-1',
      correlationId: 'corr-1',
      model: { connectionId: 'connection-1', modelId: 'model-1' },
      startedAt: '2026-09-24T01:00:00Z',
      input: { messages: [{ role: 'user', content: 'hello' }], Authorization: 'Bearer secret' }
    })
    await adapter.finish('00000000-0000-4000-8000-000000000001', {
      completedAt: '2026-09-24T01:00:01Z',
      output: { content: 'world', api_key: 'secret' },
      usage: { input_tokens: 2, output_tokens: 3 }
    })
    expect(JSON.stringify(created)).not.toMatch(/Bearer secret|ls-secret/)
    expect(created[0]).toMatchObject({
      extra: {
        metadata: {
          thread_id: 'session-1',
          sessionId: 'session-1',
          taskId: 'task-1',
          requestId: 'req-1',
          correlationId: 'corr-1'
        }
      }
    })
    expect(updated[0]).toMatchObject({
      outputs: { content: 'world' },
      extra: { metadata: { status: 'completed' } }
    })
    expect(JSON.stringify(updated)).not.toContain('api_key')
  })

  it('redacts authentication material from a failed run', async () => {
    const created: unknown[] = []
    const updates: unknown[] = []
    const adapter = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'lsv2_pt_private' },
      {
        createRun: async (run) => {
          created.push(run)
        },
        updateRun: async (_id, run) => {
          updates.push(run)
        },
        flush: async () => {},
        listRuns: async function* () {}
      }
    )
    await adapter.start({
      id: '00000000-0000-4000-8000-000000000002',
      sessionId: 'session-2',
      taskId: 'task-2',
      requestId: 'req-2',
      correlationId: 'corr-2',
      model: { connectionId: 'c', modelId: 'm' },
      startedAt: '2026-09-24T01:00:00Z',
      input: { note: 'key=lsv2_pt_private' }
    })
    await adapter.finish('00000000-0000-4000-8000-000000000002', {
      completedAt: '2026-09-24T01:00:01Z',
      output: { note: 'key=lsv2_pt_private' },
      error: 'Bearer lsv2_pt_private denied'
    })
    expect(updates[0]).toMatchObject({
      extra: { metadata: { thread_id: 'session-2', status: 'failed' } }
    })
    expect(JSON.stringify(created)).not.toContain('lsv2_pt_private')
    expect(JSON.stringify(updates)).not.toContain('lsv2_pt_private')
  })

  it('groups project runs into sorted sessions and rejects foreign detail URLs', async () => {
    const adapter = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'key', LANGSMITH_PROJECT: 'isolated' },
      {
        createRun: async () => {},
        updateRun: async () => {},
        flush: async () => {},
        listRuns: async function* () {
          yield {
            id: 'run-2',
            name: 'second',
            run_type: 'llm',
            inputs: {},
            start_time: '2026-09-24T02:00:00Z',
            end_time: '2026-09-24T02:00:01Z',
            extra: {
              metadata: { source: 'actiondriver', sessionId: 's1', taskId: 't2', modelId: 'm2' }
            },
            app_path: '/o/test/projects/p/r/run-2'
          }
          yield {
            id: 'run-1',
            name: 'first',
            run_type: 'llm',
            inputs: {},
            start_time: '2026-09-24T01:00:00Z',
            end_time: '2026-09-24T01:00:01Z',
            extra: {
              metadata: { source: 'actiondriver', sessionId: 's1', taskId: 't1', modelId: 'm1' }
            },
            app_path: 'https://evil.example/steal'
          }
        }
      }
    )
    const sessions = await adapter.list({})
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.tasks.map((task) => task.id)).toEqual(['t1', 't2'])
    expect(sessions[0]?.tasks[0]?.detailUrl).toBeNull()
    expect(sessions[0]?.tasks[1]?.detailUrl).toBe(
      'https://smith.langchain.com/o/test/projects/p/r/run-2'
    )
  })

  it('folds repeated calls for one task and reports query errors without credentials', async () => {
    const adapter = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'lsv2_pt_private' },
      {
        createRun: async () => {},
        updateRun: async () => {},
        flush: async () => {},
        listRuns: async function* () {
          yield {
            id: 'later',
            name: 'later',
            run_type: 'llm',
            inputs: {},
            start_time: '2026-09-24T02:00:00Z',
            end_time: '2026-09-24T02:00:03Z',
            error: 'failed',
            extra: { metadata: { source: 'actiondriver', sessionId: 's1', taskId: 't1' } },
            app_path: '/r/later'
          }
          yield {
            id: 'earlier',
            name: 'earlier',
            run_type: 'llm',
            inputs: {},
            start_time: '2026-09-24T01:00:00Z',
            end_time: '2026-09-24T01:00:01Z',
            extra: { metadata: { source: 'actiondriver', sessionId: 's1', taskId: 't1' } },
            app_path: '/r/earlier'
          }
        }
      }
    )
    const [session] = await adapter.list({})
    expect(session?.tasks).toHaveLength(1)
    expect(session?.tasks[0]).toMatchObject({
      status: 'failed',
      startTime: '2026-09-24T01:00:00.000Z',
      endTime: '2026-09-24T02:00:03.000Z'
    })
    const broken = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'lsv2_pt_private' },
      {
        createRun: async () => {},
        updateRun: async () => {},
        flush: async () => {},
        listRuns: async function* () {
          yield* []
          throw new Error('request failed with lsv2_pt_private')
        }
      }
    )
    await expect(broken.list({})).rejects.not.toThrow('lsv2_pt_private')
  })

  it('consumes the SDK run iterator in descending order and filters the mapped sessions', async () => {
    const queries: unknown[] = []
    const adapter = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'key', LANGSMITH_PROJECT: 'test-project' },
      {
        createRun: async () => {},
        updateRun: async () => {},
        flush: async () => {},
        listRuns: async function* (query) {
          queries.push(query)
          yield {
            id: 'older',
            name: 'Older model',
            run_type: 'llm',
            inputs: {},
            start_time: '2026-09-22T01:00:00Z',
            end_time: '2026-09-22T01:00:01Z',
            extra: { metadata: { source: 'actiondriver', sessionId: 'older', taskId: 'task-old' } },
            app_path: '/r/older'
          }
          yield {
            id: 'newer',
            name: 'Newer model',
            run_type: 'llm',
            inputs: {},
            start_time: '2026-09-24T01:00:00Z',
            extra: { metadata: { source: 'actiondriver', sessionId: 'newer', taskId: 'task-new' } },
            app_path: '/r/newer'
          }
        }
      }
    )
    expect((await adapter.list({})).map((session) => session.sessionId)).toEqual(['newer', 'older'])
    expect(await adapter.list({ status: 'running', query: 'Newer' })).toMatchObject([
      { sessionId: 'newer' }
    ])
    expect(await adapter.list({ query: 'absent' })).toEqual([])
    expect(queries[0]).toMatchObject({
      projectName: 'test-project',
      isRoot: true,
      order: 'desc',
      limit: 100
    })
  })
})
