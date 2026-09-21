import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../src/index'

describe('process logger', () => {
  it('writes json lines to the configured file so interactions stay inspectable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actiondriver-logger-'))
    const filePath = join(directory, 'renderer-service.log')
    const logging = createLogger({ name: 'test-main', pretty: false, filePath })

    logging.logger.info(
      {
        transport: 'ipc',
        direction: 'renderer->service',
        operation: 'actiondriver:agent:submit',
        outcome: 'ok'
      },
      'renderer->service actiondriver:agent:submit ok'
    )
    await logging.close()

    const persisted = readFileSync(filePath, 'utf8').trim().split('\n')
    expect(persisted).toHaveLength(1)
    expect(JSON.parse(persisted[0]!)).toMatchObject({
      transport: 'ipc',
      operation: 'actiondriver:agent:submit',
      outcome: 'ok'
    })
  })

  it('rotates the log file once it exceeds the configured size', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actiondriver-logger-rotate-'))
    const filePath = join(directory, 'service.log')
    writeFileSync(filePath, 'x'.repeat(64))

    const logging = createLogger({ name: 'test-service', pretty: false, filePath, maxFileBytes: 32 })
    logging.logger.info({ operation: 'after-rotation' }, 'service response')
    await logging.close()

    expect(existsSync(`${filePath}.1`)).toBe(true)
    expect(readFileSync(`${filePath}.1`, 'utf8')).toHaveLength(64)
    expect(readFileSync(filePath, 'utf8')).toContain('after-rotation')
  })
})
