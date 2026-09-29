import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMainLogging, startIpcInteraction } from '../../../src/main/logging'
import { startLocalOtelCollector } from '../../../../../tests/otel-collector'

afterEach(() => vi.unstubAllEnvs())

describe('Main process interaction logging', () => {
  it('records an IPC summary without creating a local log directory', async () => {
    const collector = await startLocalOtelCollector()
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', collector.endpoint)
    const userDataPath = mkdtempSync(join(tmpdir(), 'actiondriver-main-otel-'))
    const logging = await createMainLogging()
    try {
      const finish = await startIpcInteraction(
        logging.interactions,
        'actiondriver:agent:submit',
        { requestId: 'request-1', body: 'MODEL_INPUT_MARKER' }
      )
      expect(finish).not.toBeNull()
      await finish!({ outcome: 'ok' })
    } finally {
      await logging.logger.close()
      await collector.close()
    }
    expect(existsSync(join(userDataPath, 'logs'))).toBe(false)
  })
})
