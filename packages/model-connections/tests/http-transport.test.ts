import { describe, expect, it, vi } from 'vitest'
import { HttpTransportError, createFetchHttpTransport } from '../src'

function response(status: number, body: string) {
  return {
    status,
    text: async () => body
  } as Response
}

describe('fetch HTTP transport', () => {
  it('passes method, headers and JSON body through and parses the response', async () => {
    const fetchImpl = vi.fn(async () => response(200, '{"data":[{"id":"qwen3.7-plus"}]}'))
    const transport = createFetchHttpTransport(fetchImpl)

    const result = await transport.request({
      url: 'https://api.example.com/v1/chat/completions',
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: { model: 'qwen3.7-plus' },
      timeoutMs: 1_000
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'qwen3.7-plus' })
      })
    )
    expect(result).toMatchObject({ status: 200, body: { data: [{ id: 'qwen3.7-plus' }] } })
  })

  it('normalises transport failures into network errors and keeps non-JSON bodies readable', async () => {
    const failing = createFetchHttpTransport(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    await expect(
      failing.request({ url: 'https://api.example.com', method: 'GET', headers: {}, timeoutMs: 10 })
    ).rejects.toMatchObject({ code: 'network' })

    const htmlError = createFetchHttpTransport(async () => response(502, '<html>bad gateway</html>'))
    await expect(
      htmlError.request({ url: 'https://api.example.com', method: 'GET', headers: {}, timeoutMs: 10 })
    ).resolves.toMatchObject({ status: 502, body: null, text: '<html>bad gateway</html>' })
  })

  it('aborts requests that exceed their deadline', async () => {
    const transport = createFetchHttpTransport(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('The operation was aborted'))
          )
        })
    )

    await expect(
      transport.request({
        url: 'https://api.example.com',
        method: 'GET',
        headers: {},
        timeoutMs: 5
      })
    ).rejects.toBeInstanceOf(HttpTransportError)
  })

  it('retries without a signal when the fetch implementation rejects a foreign AbortSignal', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal) {
        throw new TypeError('Expected signal ("AbortSignal {}") to be an instance of AbortSignal.')
      }
      return response(200, '{"data":[]}')
    })

    const result = await createFetchHttpTransport(fetchImpl).request({
      url: 'https://api.example.com/v1/models',
      method: 'GET',
      headers: {},
      timeoutMs: 50
    })

    expect(result.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
