import { describe, expect, it } from 'vitest'
import { createProcessObservability } from '../../src/otel'
import { createInteractionLogRecorder } from '../../src/interaction-store'
import { PhoenixModelObservability } from '../../../../apps/agent-runtime/src/phoenix-model-observability'

const live = process.env.ACTIONDRIVER_LIVE_OBSERVABILITY === '1'

describe.skipIf(!live)('Docker observability acceptance', () => {
  it('exports one application call and a complete model span', async () => {
    const marker = `ACTIONDRIVER_LIVE_${Date.now()}`
    const processTelemetry = createProcessObservability({ serviceName: 'actiondriver-live-test' })
    const recorder = createInteractionLogRecorder({
      ids: { eventId: () => 'live:event-1', correlationId: () => 'live:correlation-1' },
      logger: processTelemetry.logger,
      tracer: processTelemetry.tracer,
      meter: processTelemetry.meter
    })
    const finish = await recorder.start({
      transport: 'ipc', direction: 'renderer->service', operation: 'live.acceptance',
      taskId: 'live-task', request: { kind: 'json', value: { secret: `${marker}_REQUEST` } }
    })
    await finish({ outcome: 'ok', response: { kind: 'text', text: `${marker}_RESPONSE` } })

    const model = new PhoenixModelObservability(processTelemetry.tracer)
    await model.start({
      id: 'live-model', sessionId: 'live-session', taskId: 'live-task',
      requestId: 'live-request', correlationId: 'live-correlation',
      model: { connectionId: 'live-connection', modelId: 'acceptance-model' },
      startedAt: new Date().toISOString(),
      input: { prompt: `${marker}_MODEL_INPUT` }
    })
    await model.finish('live-model', {
      completedAt: new Date().toISOString(), output: { text: `${marker}_MODEL_OUTPUT` }
    })
    await processTelemetry.close()
    expect(processTelemetry.status().exportFailures).toBe(0)
    console.log(`ACCEPTANCE_MARKER=${marker}`)
  })
})
