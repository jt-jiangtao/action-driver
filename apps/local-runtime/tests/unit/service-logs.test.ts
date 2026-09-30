import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServiceHttpServer, type ServiceHttpServer } from '../../src/service/http-service'

let server: ServiceHttpServer | undefined
afterEach(async () => { await server?.close(); server = undefined })

describe('service log endpoint', () => {
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
