import { describe, expect, it, vi } from 'vitest'
import type { LegacyModelLogApi } from './desktop-model-logs'
import { DesktopModelLogService } from './desktop-model-logs'

describe('DesktopModelLogService', () => {
  it('loads and maps real grouped model log projections', async () => {
    const listModelLogs = vi.fn(async () => [
      {
        id: 'session-1',
        sessionId: 'session-1',
        name: '第一轮',
        startTime: '2026-09-23T00:00:00.000Z',
        endTime: '2026-09-23T00:00:02.000Z',
        status: 'completed' as const,
        durationMs: 2_000,
        detailUrl: 'https://smith.langchain.com/r/session-1',
        tasks: [
          {
            id: 'task-1',
            sessionId: 'session-1',
            name: '第一轮',
            startTime: '2026-09-23T00:00:00.000Z',
            endTime: '2026-09-23T00:00:02.000Z',
            status: 'completed' as const,
            durationMs: 2_000,
            model: { connectionId: 'connection-1', modelId: 'model-1' },
            detailUrl: 'https://smith.langchain.com/r/task-1',
            calls: [
              {
                id: 'call-1',
                taskId: 'task-1',
                requestId: 'request-1',
                correlationId: 'correlation-1',
                label: '模型调用',
                time: '2026-09-23T00:00:00.000Z',
                status: 'completed' as const,
                description: '已完成',
                sections: []
              }
            ]
          }
        ]
      }
    ])
    const service = new DesktopModelLogService({ listModelLogs } as unknown as LegacyModelLogApi)

    await expect(service.list()).resolves.toMatchObject([
      {
        sessionId: 'session-1',
        duration: '2 秒',
        tasks: [
          {
            id: 'task-1',
            model: 'model-1',
            detailUrl: 'https://smith.langchain.com/r/task-1'
          }
        ]
      }
    ])
    expect(listModelLogs).toHaveBeenCalledOnce()
  })
})
