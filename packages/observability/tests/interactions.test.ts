import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import {
  createInteractionLogger,
  summarizePayload,
  INTERACTION_REDACT_PATHS
} from '../src/index'

function capturingLogger() {
  const lines: string[] = []
  const logger = pino(
    { level: 'debug', redact: { paths: INTERACTION_REDACT_PATHS, censor: '[redacted]' } },
    {
      write: (line: string) => {
        lines.push(line)
        return true
      }
    }
  )
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line)) }
}

describe('interaction logging contract', () => {
  it('records transport, direction, operation, outcome, duration and payload size', () => {
    const { logger, records } = capturingLogger()
    const interactions = createInteractionLogger(logger)

    const finish = interactions.start({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'actiondriver:model-connections:list',
      requestId: 'request-1'
    })
    const record = finish({ outcome: 'ok', payload: [{ id: 'a' }, { id: 'b' }] })

    expect(record).toMatchObject({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'actiondriver:model-connections:list',
      requestId: 'request-1',
      outcome: 'ok',
      payloadItems: 2
    })
    expect(typeof record.durationMs).toBe('number')
    expect(typeof record.payloadBytes).toBe('number')
    expect(records()[0]!.msg).toBe('renderer->service actiondriver:model-connections:list ok')
  })

  it('records failures with a code and message and logs them at error level', () => {
    const { logger, records } = capturingLogger()
    const interactions = createInteractionLogger(logger)

    const record = interactions.record(
      { transport: 'http', direction: 'renderer->service', operation: 'POST /model-connections/test' },
      { outcome: 'error', status: 401, error: { code: 'unauthorized', message: '钥匙无效' } },
      12
    )

    expect(record).toMatchObject({
      status: 401,
      errorCode: 'unauthorized',
      errorMessage: '钥匙无效',
      durationMs: 12
    })
    expect(records()[0]!.level).toBe(50)
  })

  it('summarises payloads without storing their contents', () => {
    expect(summarizePayload(undefined)).toEqual({})
    expect(summarizePayload([1, 2, 3])).toEqual({
      payloadItems: 3,
      payloadBytes: Buffer.byteLength('[1,2,3]')
    })
    expect(summarizePayload({ goal: '预订酒店' }).payloadBytes).toBeGreaterThan(0)
    expect(summarizePayload({ goal: '预订酒店' })).not.toHaveProperty('payloadItems')
  })

  it('redacts credentials at any nesting depth', () => {
    const { logger, lines } = capturingLogger()

    logger.info(
      {
        authorization: 'Bearer service-token',
        draft: { apiKey: 'sk-secret-value' },
        'x-api-key': 'sk-other-secret'
      },
      'renderer->service request'
    )

    const text = lines.join('\n')
    expect(text).not.toContain('service-token')
    expect(text).not.toContain('sk-secret-value')
    expect(text).not.toContain('sk-other-secret')
    expect(text).toContain('[redacted]')
  })
})
