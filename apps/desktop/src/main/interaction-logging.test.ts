import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMainLogging, startIpcInteraction } from './logging'

describe('Main process interaction logging', () => {
  it('records an IPC summary without creating a local log directory', async () => {
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
    }
    expect(existsSync(join(userDataPath, 'logs'))).toBe(false)
  })
})
