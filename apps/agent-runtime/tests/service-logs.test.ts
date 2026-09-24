import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOG_LEVELS, isLogControlPlaneOperation, readRecentLogRecords } from '../src/service/logs'
import { startServiceHttpServer, type ServiceHttpServer } from '../src/service/http-service'

let server: ServiceHttpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

function logFile(lines: object[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-logs-'))
  const filePath = join(directory, 'service.log')
  writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return filePath
}

const records = [
  {
    level: LOG_LEVELS.info!,
    time: 1,
    transport: 'http',
    operation: 'GET /model-connections',
    outcome: 'ok'
  },
  {
    level: LOG_LEVELS.warn!,
    time: 2,
    transport: 'http',
    operation: 'GET /model-connections',
    outcome: 'rejected'
  },
  {
    level: LOG_LEVELS.error!,
    time: 3,
    transport: 'http',
    operation: 'POST /model-connections/test',
    outcome: 'error'
  }
]

describe('service log records', () => {
  it('excludes interaction-log queries from recursive recording', () => {
    expect(isLogControlPlaneOperation('actiondriver:log:list')).toBe(true)
    expect(isLogControlPlaneOperation('actiondriver:log:get-detail')).toBe(true)
    expect(isLogControlPlaneOperation('sandbox.fs.read')).toBe(false)
  })
  it('returns the newest records and filters by level', () => {
    const filePath = logFile(records)

    expect(readRecentLogRecords({ filePath }).map((record) => record.time)).toEqual([1, 2, 3])
    expect(
      readRecentLogRecords({ filePath, minLevel: LOG_LEVELS.warn! }).map((record) => record.time)
    ).toEqual([2, 3])
    expect(readRecentLogRecords({ filePath, limit: 2 }).map((record) => record.time)).toEqual([2, 3])
  })

  it('tolerates missing files and partially written lines', () => {
    expect(readRecentLogRecords({ filePath: '/tmp/does-not-exist.log' })).toEqual([])

    const directory = mkdtempSync(join(tmpdir(), 'actiondriver-logs-'))
    const filePath = join(directory, 'service.log')
    writeFileSync(filePath, '{"level":30,"time":1}\n{"level":30,"time"\n')
    expect(readRecentLogRecords({ filePath }).map((record) => record.time)).toEqual([1])
  })

  it('does not serve local log records over HTTP', async () => {
    server = await startServiceHttpServer({
      service: {
        list: () => [],
        testConnection: vi.fn(),
        discover: vi.fn(),
        refresh: vi.fn(),
        testModels: vi.fn(),
        testConnectionModels: vi.fn(),
        setModelEnabled: vi.fn(),
        add: vi.fn(),
        delete: vi.fn()
      } as never,
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })

    const response = await fetch(`${server.url}/logs?level=warn&limit=1`, {
      headers: { authorization: 'Bearer service-token' }
    })
    const payload = (await response.json()) as { ok: boolean; value: { records: { time: number }[] } }

    expect(response.status).toBe(404)
    expect(payload.ok).toBe(false)
  })
})
