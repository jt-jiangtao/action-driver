import type { InteractionLogDetail, InteractionLogSummary } from '@actiondriver/observability'
import { describe, expect, it, vi } from 'vitest'
import { DesktopInteractionLogService } from './desktop-interaction-logs'

const summary = {
  id: 'service:event-1',
  correlationId: 'correlation-1',
  time: 1,
  completedAt: 2,
  transport: 'http',
  direction: 'renderer->service',
  kind: 'request-response',
  state: 'completed',
  operation: 'POST /model-connections/test',
  level: 30,
  levelLabel: 'info',
  outcome: 'ok',
  durationMs: 1,
  requestBytes: 10,
  responseBytes: 10,
  requestAvailable: true,
  responseAvailable: true,
  requestTruncated: false,
  responseTruncated: false
} satisfies InteractionLogSummary

describe('DesktopInteractionLogService', () => {
  it('keeps list summaries body-free and loads detail separately', async () => {
    const detail = {
      ...summary,
      request: {
        kind: 'json',
        contentType: 'application/json',
        byteLength: 10,
        truncated: false,
        text: '{"request":true}',
        unavailableReason: null
      },
      response: null
    } satisfies InteractionLogDetail
    const api = {
      list: vi.fn(async (request: unknown) => {
        void request
        return { records: [summary], nextCursor: null, files: ['/logs/service'] }
      }),
      detail: vi.fn(async () => detail)
    }
    const service = new DesktopInteractionLogService(api)

    await expect(service.list({ transports: ['http'], limit: 20 })).resolves.toEqual({
      records: [summary],
      nextCursor: null,
      files: ['/logs/service']
    })
    await expect(service.detail('service:event-1')).resolves.toEqual(detail)
    expect(api.list.mock.calls[0]?.[0]).toEqual({ transports: ['http'], limit: 20 })
    expect(api.detail).toHaveBeenCalledWith('service:event-1')
  })
})
