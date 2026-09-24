import { describe, expect, it, vi } from 'vitest'
import type { Tracer } from '@opentelemetry/api'
import { PhoenixModelObservability } from '../src/phoenix-model-observability'

describe('Phoenix model observability', () => {
  it('puts complete model input and output on one OTel span, with no credential fields', async () => {
    const attributes: Record<string, unknown> = {}
    const end = vi.fn()
    const tracer = {
      startSpan: vi.fn(() => ({
        setAttribute: (key: string, value: unknown) => { attributes[key] = value; return undefined },
        setStatus: vi.fn(),
        end
      }))
    } as unknown as Tracer
    const observation = new PhoenixModelObservability(tracer)
    await observation.start({
      id: 'call-1', sessionId: 'session-1', taskId: 'task-1', requestId: 'request-1',
      correlationId: 'correlation-1', model: { connectionId: 'connection-1', modelId: 'test-model' },
      startedAt: '2026-09-24T00:00:00Z', input: { prompt: 'MODEL_INPUT_MARKER', apiKey: 'secret' }
    })
    await observation.finish('call-1', {
      completedAt: '2026-09-24T00:00:01Z', output: { text: 'MODEL_OUTPUT_MARKER' }
    })
    expect(tracer.startSpan).toHaveBeenCalledWith('chat test-model', expect.anything())
    expect(JSON.stringify(attributes)).toContain('MODEL_INPUT_MARKER')
    expect(JSON.stringify(attributes)).toContain('MODEL_OUTPUT_MARKER')
    expect(JSON.stringify(attributes)).not.toContain('secret')
    expect(end).toHaveBeenCalledOnce()
  })
})
