import {
  ModelServiceError,
  type ModelConnectionDto,
  type ModelConnectionService
} from '@actiondriver/model-connections'
import {
  createInteractionLogRecorder,
  MemoryInteractionLogStore,
  type InteractionLogRecorder
} from '@actiondriver/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServiceHttpServer, type ServiceHttpServer } from '../src/service/http-service'

const connection: ModelConnectionDto = {
  id: 'company-gateway',
  name: '公司模型网关',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKeyHint: '••••alue',
  expanded: true,
  models: [{ id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' }]
}

let server: ServiceHttpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

function serviceStub(overrides: Record<string, unknown> = {}) {
  const base = {
    list: () => [connection],
    testConnection: vi.fn(async () => ({ ok: true })),
    discover: vi.fn(async () => connection.models),
    refresh: vi.fn(async () => connection.models),
    testModels: vi.fn(async () => [{ modelId: 'qwen3.7-plus', state: 'success' }]),
    testConnectionModels: vi.fn(async () => [{ modelId: 'qwen3.7-plus', state: 'unsupported' }]),
    setModelEnabled: vi.fn(async () => undefined),
    add: vi.fn(async () => connection),
    delete: vi.fn(async () => undefined),
    ...overrides
  }
  return base as unknown as ModelConnectionService & typeof base
}

async function startService(
  overrides: Record<string, unknown> = {},
  interactions?: InteractionLogRecorder
) {
  const service = serviceStub(overrides)
  server = await startServiceHttpServer({
    service,
    token: 'service-token',
    runtimeVersion: '0.1.0',
    ...(interactions ? { interactions } : {})
  })
  return { service, url: server.url }
}

function recordingInteractions() {
  const store = new MemoryInteractionLogStore()
  let sequence = 0
  const interactions = createInteractionLogRecorder({
    store,
    ids: {
      eventId: () => `service:event-${++sequence}`,
      correlationId: () => `correlation-${sequence}`
    },
    clock: Date.now
  })
  return { interactions, store }
}

function authorized(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${server!.url}${path}`, {
    ...init,
    headers: { authorization: 'Bearer service-token', ...(init.headers ?? {}) }
  })
}

describe('service HTTP surface', () => {
  it('answers health probes without a credential', async () => {
    await startService()

    const response = await fetch(`${server!.url}/readyz`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('rejects browser origins so a rendered page cannot drive the service', async () => {
    await startService()

    const response = await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer service-token', origin: 'http://localhost:5173' }
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it('requires the service credential for business routes', async () => {
    await startService()

    const anonymous = await fetch(`${server!.url}/model-connections`)
    expect(anonymous.status).toBe(401)

    const wrong = await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer wrong-token' }
    })
    expect(wrong.status).toBe(401)
  })

  it('serves configuration over the authorized HTTP surface', async () => {
    const { service } = await startService()

    await expect(authorized('/version').then((r) => r.json())).resolves.toEqual({
      ok: true,
      value: { runtimeVersion: '0.1.0', protocolVersion: 1 }
    })
    await expect(authorized('/model-connections').then((r) => r.json())).resolves.toEqual({
      ok: true,
      value: [connection]
    })

    await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-value'
      })
    })
    expect(service.testConnection).toHaveBeenCalledOnce()
  })

  it('routes connection scoped operations', async () => {
    const { service } = await startService()

    await authorized('/model-connections/company-gateway/refresh', { method: 'POST' })
    expect(service.refresh).toHaveBeenCalledWith('company-gateway')

    await authorized('/model-connections/company-gateway/test-models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelIds: ['qwen3.7-plus'] })
    })
    expect(service.testConnectionModels).toHaveBeenCalledWith({
      connectionId: 'company-gateway',
      modelIds: ['qwen3.7-plus']
    })

    await authorized('/model-connections/company-gateway/models/qwen3.7-plus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    })
    expect(service.setModelEnabled).toHaveBeenCalledWith({
      connectionId: 'company-gateway',
      modelId: 'qwen3.7-plus',
      enabled: false
    })

    await authorized('/model-connections/company-gateway', { method: 'DELETE' })
    expect(service.delete).toHaveBeenCalledWith('company-gateway')
  })

  it('returns structured errors and rejects unknown routes', async () => {
    await startService({
      list: () => {
        throw new Error('storage exploded')
      }
    })

    const failed = await authorized('/model-connections')
    await expect(failed.json()).resolves.toMatchObject({ ok: false, error: { code: 'unknown' } })

    const missing = await authorized('/unknown')
    expect(missing.status).toBe(404)
  })

  it('rejects malformed request bodies', async () => {
    await startService()

    const response = await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json'
    })

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
  })

  it('records HTTP request/response pairs without credentials and excludes log queries', async () => {
    const { interactions, store } = recordingInteractions()
    await startService({}, interactions)

    await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer wrong-token' }
    })
    await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-value'
      })
    })
    await authorized('/logs')

    const records = (await store.list({ limit: 20 })).records
    expect(records.map((record) => record.operation).sort()).toEqual([
      'GET /model-connections',
      'POST /model-connections/test'
    ])
    const details = await Promise.all(records.map((record) => store.getDetail(record.id)))
    expect(JSON.stringify(details)).toContain('公司模型网关')
    expect(JSON.stringify(details)).not.toContain('service-token')
    expect(JSON.stringify(details)).not.toContain('wrong-token')
    expect(JSON.stringify(details)).not.toContain('sk-secret-value')
    expect(details.every((detail) => detail?.responseAvailable)).toBe(true)
  })

  it('records a pending HTTP event before the service completes and includes service duration', async () => {
    const { interactions, store } = recordingInteractions()
    let release!: () => void
    const waiting = new Promise<ModelConnectionDto[]>((resolve) => {
      release = () => resolve([connection])
    })
    await startService({ list: () => waiting }, interactions)

    const responsePromise = authorized('/model-connections')
    await vi.waitFor(async () => {
      expect((await store.list({ limit: 20 })).records[0]?.state).toBe('pending')
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    expect((await responsePromise).status).toBe(200)

    expect((await store.list({ limit: 20 })).records[0]).toMatchObject({
      state: 'completed',
      outcome: 'ok'
    })
    expect((await store.list({ limit: 20 })).records[0]!.durationMs).toBeGreaterThanOrEqual(10)
  })

  it('does not persist an API key reflected by a provider error', async () => {
    const { interactions, store } = recordingInteractions()
    await startService(
      {
        testConnection: () => {
          throw new ModelServiceError('provider-error', 'Invalid API key: sk-secret-value')
        }
      },
      interactions
    )

    await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-value'
      })
    })

    const record = (await store.list({ limit: 20 })).records[0]!
    expect(JSON.stringify(await store.getDetail(record.id))).not.toContain('sk-secret-value')
  })

  it('keeps HTTP business responses successful when interaction storage fails', async () => {
    let calls = 0
    const interactions: InteractionLogRecorder = {
      async start() {
        calls += 1
        if (calls === 1) throw new Error('disk unavailable')
        return async () => {
          throw new Error('disk full')
        }
      },
      async recordOneWay() {
        throw new Error('disk unavailable')
      }
    }
    await startService({}, interactions)

    expect((await authorized('/model-connections')).status).toBe(200)
    expect((await authorized('/model-connections')).status).toBe(200)
  })
})
