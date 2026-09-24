import { pino } from 'pino'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServiceLogger, REDACTED_LOG_PATHS } from '../src/service/logger'
import { startServiceHttpServer, type ServiceHttpServer } from '../src/service/http-service'

let server: ServiceHttpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.unstubAllEnvs()
})

function capturingLogger() {
  const lines: string[] = []
  const stream = {
    write: (line: string) => {
      lines.push(line)
      return true
    }
  }
  const logger = pino(
    { level: 'debug', redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' } },
    stream
  )
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line)) }
}

const serviceStub = {
  list: () => [],
  testConnection: vi.fn(async () => ({ ok: true as const })),
  discover: vi.fn(async () => []),
  refresh: vi.fn(async () => []),
  testModels: vi.fn(async () => []),
  testConnectionModels: vi.fn(async () => []),
  setModelEnabled: vi.fn(async () => undefined),
  add: vi.fn(async () => ({
    id: 'connection-1',
    name: '连接',
    protocol: 'openai-compatible' as const,
    baseUrl: 'https://api.example.com/v1',
    apiKeyHint: '••••alue',
    expanded: true,
    models: []
  })),
  delete: vi.fn(async () => undefined)
}

async function start(logger: ReturnType<typeof capturingLogger>['logger']) {
  server = await startServiceHttpServer({
    service: serviceStub as never,
    token: 'service-token',
    runtimeVersion: '0.1.0',
    logger
  })
  return server
}

describe('service interaction logging', () => {
  it('logs the renderer to service HTTP interactions with status and duration', async () => {
    const { logger, records } = capturingLogger()
    await start(logger)

    await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer service-token' }
    })

    const responses = records().filter((record) => record.msg === 'service response')
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({
      transport: 'http',
      method: 'GET',
      path: '/model-connections',
      status: 200
    })
    expect(typeof responses[0].durationMs).toBe('number')
  })

  it('logs rejections with a reason instead of a status code', async () => {
    const { logger, records } = capturingLogger()
    await start(logger)

    await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer service-token', origin: 'http://localhost:5173' }
    })
    await fetch(`${server!.url}/model-connections`)

    const reasons = records()
      .filter((record) => record.msg === 'service request rejected')
      .map((record) => record.reason)
    expect(reasons).toEqual(['origin-rejected', 'unauthorized'])
  })

  it('never writes the service credential or a model API key into the log', async () => {
    const { logger, lines } = capturingLogger()
    await start(logger)

    await fetch(`${server!.url}/model-connections/test`, {
      method: 'POST',
      headers: { authorization: 'Bearer service-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-super-secret-value'
      })
    })

    const text = lines.join('\n')
    expect(text).toContain('service response')
    expect(text).not.toContain('sk-super-secret-value')
    expect(text).not.toContain('service-token')
  })

  it('does not create a local operational log next to the database', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ACTIONDRIVER_LOG_PRETTY', '0')
    const dataDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-logs-'))
    const databasePath = join(dataDirectory, 'data', 'actiondriver.db')

    const serviceLogger = createServiceLogger({ databasePath, pretty: false, level: 'info' })
    serviceLogger.logger.info({ transport: 'http', path: '/model-connections' }, 'service response')
    await serviceLogger.close()

    const logPath = join(dataDirectory, 'logs', 'service.log')
    expect(existsSync(logPath)).toBe(false)
  })
})
