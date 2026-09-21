import type { ModelConnectionDto, ModelConnectionService } from '@actiondriver/model-connections'
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

async function startService(overrides: Record<string, unknown> = {}) {
  const service = serviceStub(overrides)
  server = await startServiceHttpServer({
    service,
    token: 'service-token',
    runtimeVersion: '0.1.0'
  })
  return { service, url: server.url }
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
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } })
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
})
