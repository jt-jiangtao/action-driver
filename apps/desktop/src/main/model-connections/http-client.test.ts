import {
  ModelServiceError,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport
} from '@actiondriver/model-connections'
import { describe, expect, it } from 'vitest'
import { ModelConnectionHttpClient } from './http-client'

function transportWith(handler: (request: HttpRequest) => HttpResponse) {
  const requests: HttpRequest[] = []
  const transport: HttpTransport = {
    async request(request) {
      requests.push(request)
      return handler(request)
    }
  }
  return { transport, requests }
}

describe('ModelConnectionHttpClient', () => {
  it('maps each operation to the service HTTP surface with the bearer token', async () => {
    const { transport, requests } = transportWith(() => ({
      status: 200,
      body: { ok: true, value: [] },
      text: ''
    }))
    const client = new ModelConnectionHttpClient({
      baseUrl: 'http://127.0.0.1:45123',
      token: 'service-token',
      transport
    })

    await client.list()
    await client.refresh('company-gateway')
    await client.delete('company-gateway')

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'http://127.0.0.1:45123/model-connections'],
      ['POST', 'http://127.0.0.1:45123/model-connections/company-gateway/refresh'],
      ['DELETE', 'http://127.0.0.1:45123/model-connections/company-gateway']
    ])
    expect(requests[0]?.headers.authorization).toBe('Bearer service-token')
  })

  it('turns a failed envelope into a domain error', async () => {
    const transport: HttpTransport = {
      async request() {
        return {
          status: 200,
          body: { ok: false, error: { code: 'unauthorized', message: 'bad key' } },
          text: ''
        }
      }
    }
    const client = new ModelConnectionHttpClient({ baseUrl: 'http://x', token: 't', transport })

    await expect(client.list()).rejects.toMatchObject({ code: 'unauthorized', message: 'bad key' })
  })

  it('rejects a malformed service response', async () => {
    const transport: HttpTransport = {
      async request() {
        return { status: 200, body: {}, text: '' }
      }
    }
    const client = new ModelConnectionHttpClient({ baseUrl: 'http://x', token: 't', transport })

    await expect(client.list()).rejects.toBeInstanceOf(ModelServiceError)
  })
})
