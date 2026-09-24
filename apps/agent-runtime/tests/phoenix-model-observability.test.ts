import { describe, expect, it, vi } from 'vitest'
import type { Tracer } from '@opentelemetry/api'
import { PhoenixModelObservability } from '../src/phoenix-model-observability'
import type { ModelTracePort } from '../src/model-trace-port'

describe('Phoenix model observability', () => {
  it('puts complete model input and output on one OTel span, with no credential fields', async () => {
    const attributes: Record<string, unknown> = {}
    const end = vi.fn()
    const tracer = {
      startSpan: vi.fn(() => ({
        setAttribute: (key: string, value: unknown) => {
          attributes[key] = value
          return undefined
        },
        setStatus: vi.fn(),
        end
      }))
    } as unknown as Tracer
    const observation = new PhoenixModelObservability(tracer)
    await observation.start({
      id: 'call-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      requestId: 'request-1',
      correlationId: 'correlation-1',
      model: { connectionId: 'connection-1', modelId: 'test-model' },
      startedAt: '2026-09-24T00:00:00Z',
      input: { prompt: 'MODEL_INPUT_MARKER', apiKey: 'secret' }
    })
    await observation.finish('call-1', {
      completedAt: '2026-09-24T00:00:01Z',
      output: { text: 'MODEL_OUTPUT_MARKER' }
    })
    expect(tracer.startSpan).toHaveBeenCalledWith('chat test-model', expect.anything())
    expect(JSON.stringify(attributes)).toContain('MODEL_INPUT_MARKER')
    expect(JSON.stringify(attributes)).toContain('MODEL_OUTPUT_MARKER')
    expect(JSON.stringify(attributes)).not.toContain('secret')
    expect(end).toHaveBeenCalledOnce()
  })
})

describe('Phoenix trace failure boundary', () => {
  it('filters nested credentials and ends a failed model span', async () => {
    const attributes: Record<string, unknown> = {}
    const setStatus = vi.fn()
    const end = vi.fn()
    const tracer = {
      startSpan: () => ({
        setAttribute: (key: string, value: unknown) => {
          attributes[key] = value
        },
        setStatus,
        end
      })
    } as unknown as Tracer
    const port: ModelTracePort = new PhoenixModelObservability(tracer)
    await port.start({
      id: 'call-2',
      sessionId: 'session-1',
      taskId: 'task-1',
      requestId: 'request-1',
      correlationId: 'correlation-1',
      model: { connectionId: 'connection-1', modelId: 'test-model' },
      startedAt: '2026-09-24T00:00:00Z',
      input: {
        messages: [
          {
            text: 'MODEL_INPUT_MARKER',
            headers: { Authorization: 'Bearer secret' },
            access_token: 'ACCESS_MARKER',
            refreshToken: 'REFRESH_MARKER'
          }
        ]
      }
    })
    await port.finish('call-2', {
      completedAt: '2026-09-24T00:00:01Z',
      output: {
        value: [
          { text: 'MODEL_OUTPUT_MARKER', apiKey: 'secret', accessToken: 'OUTPUT_ACCESS_MARKER' }
        ]
      },
      error: 'Bearer secret rejected'
    })
    expect(JSON.stringify(attributes)).toContain('MODEL_INPUT_MARKER')
    expect(JSON.stringify(attributes)).toContain('MODEL_OUTPUT_MARKER')
    expect(JSON.stringify(attributes)).not.toMatch(/secret|Bearer/)
    expect(JSON.stringify(attributes)).not.toMatch(/ACCESS_MARKER|REFRESH_MARKER/)
    expect(JSON.stringify(setStatus.mock.calls)).not.toMatch(/secret|Bearer/)
    expect(end).toHaveBeenCalledOnce()
  })

  it.each(['input.value', 'output.value', 'status'])(
    'ends a span when %s writing throws',
    async (failure) => {
      const end = vi.fn()
      const span = {
        setAttribute: vi.fn((key: string) => {
          if (key === failure) throw new Error('attribute failed')
        }),
        setStatus: vi.fn(() => {
          if (failure === 'status') throw new Error('status failed')
        }),
        end
      }
      const tracer = { startSpan: () => span } as unknown as Tracer
      const observation = new PhoenixModelObservability(tracer)
      const run = {
        id: 'failed-span',
        sessionId: 'session-1',
        taskId: 'task-1',
        requestId: 'request-1',
        correlationId: 'correlation-1',
        model: { connectionId: 'connection-1', modelId: 'test-model' },
        startedAt: '2026-09-24T00:00:00Z',
        input: { prompt: 'hello' }
      }
      if (failure === 'input.value') {
        await expect(observation.start(run)).rejects.toThrow('attribute failed')
      } else {
        await observation.start(run)
        await expect(
          observation.finish(run.id, {
            completedAt: '2026-09-24T00:00:01Z',
            output: { text: 'done' }
          })
        ).rejects.toThrow(failure === 'status' ? 'status failed' : 'attribute failed')
      }
      expect(end).toHaveBeenCalledOnce()
    }
  )
})
