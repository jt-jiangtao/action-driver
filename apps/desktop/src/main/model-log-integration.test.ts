import { LangSmithObservability } from '../../../agent-runtime/src/langsmith-observability'
import { describe, expect, it, vi } from 'vitest'
import { DesktopModelLogService, type LegacyModelLogApi } from '../renderer/src/services/desktop-model-logs'

function createStack(adapter: LangSmithObservability) {
  const navigation = {
    show: vi.fn(async (url: string, bounds: Parameters<LegacyModelLogApi['openModelLogDetail']>[1]) => {
      void url
      void bounds
    }),
    setBounds: vi.fn(), close: vi.fn()
  }
  const api: LegacyModelLogApi = {
    listModelLogs: () => adapter.list({}),
    async openModelLogDetail(url, bounds) {
      if (new URL(url).origin !== adapter.webOrigin) {
        throw { code: 'INVALID_MESSAGE', message: 'Foreign detail URL' }
      }
      await navigation.show(url, bounds)
    },
    setModelLogDetailBounds: async (bounds) => { navigation.setBounds(bounds) },
    closeModelLogDetail: async () => { navigation.close() }
  }
  return { service: new DesktopModelLogService(api), navigation }
}

describe.skip('Legacy LangSmith model logs across Runtime, IPC and Renderer service', () => {
  it('groups successful and failed traces, refreshes and rejects a foreign detail URL', async () => {
    let includeFailed = false
    const adapter = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'test-key' },
      {
        createRun: async () => {},
        updateRun: async () => {},
        flush: async () => {},
        listRuns: async function* () {
          yield {
            id: 'success',
            name: 'model-one',
            run_type: 'llm',
            inputs: {},
            start_time: '2026-09-24T01:00:00Z',
            end_time: '2026-09-24T01:00:02Z',
            extra: {
              metadata: { source: 'actiondriver', sessionId: 'session-one', taskId: 'task-one' }
            },
            app_path: '/r/success'
          }
          if (includeFailed)
            yield {
              id: 'failure',
              name: 'model-two',
              run_type: 'llm',
              inputs: {},
              start_time: '2026-09-24T01:01:00Z',
              end_time: '2026-09-24T01:01:02Z',
              error: 'failed',
              extra: {
                metadata: { source: 'actiondriver', sessionId: 'session-one', taskId: 'task-two' }
              },
              app_path: '/r/failure'
            }
        }
      }
    )
    const { service, navigation } = createStack(adapter)
    expect((await service.list())[0]?.tasks).toHaveLength(1)
    includeFailed = true
    const [session] = await service.list()
    expect(session).toMatchObject({ id: 'session-one', status: 'failed' })
    expect(session?.tasks).toHaveLength(2)
    await service.openDetail(session!.tasks[1]!.detailUrl!, {
      x: 1,
      y: 60,
      width: 800,
      height: 500
    })
    expect(navigation.show).toHaveBeenCalledWith(
      'https://smith.langchain.com/r/failure',
      expect.any(Object)
    )
    await expect(
      service.openDetail('https://evil.example/r/steal', { x: 1, y: 60, width: 800, height: 500 })
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })

  it('returns empty results and an explicit unconfigured error without a mock fallback', async () => {
    const empty = new LangSmithObservability(
      { LANGSMITH_API_KEY: 'test-key' },
      {
        createRun: async () => {},
        updateRun: async () => {},
        flush: async () => {},
        listRuns: async function* () {
          yield* []
        }
      }
    )
    expect(await createStack(empty).service.list()).toEqual([])
    await expect(createStack(new LangSmithObservability({})).service.list()).rejects.toMatchObject({
      message: 'LANGSMITH_API_KEY is required'
    })
  })
})
