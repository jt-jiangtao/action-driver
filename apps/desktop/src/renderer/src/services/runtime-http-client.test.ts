import { describe, expect, it, vi } from 'vitest'
import { RuntimeHttpClient } from './runtime-http-client'

describe('RuntimeHttpClient', () => {
  it('sends the Runtime token and rejects a failed envelope', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false, error: { code: 'CONFLICT', message: 'changed' }
    }), { status: 409 }))
    const client = new RuntimeHttpClient(
      async () => ({ wsUrl: 'ws://127.0.0.1:45123/stream', accessToken: 'secret',
        protocol: 'actiondriver.stream.v2' }),
      fetcher
    )
    await expect(client.request('/agent-files/file', { method: 'POST', body: { path: 'x' } }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: 'changed' })
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:45123/agent-files/file',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret' })
      }))
  })
})
