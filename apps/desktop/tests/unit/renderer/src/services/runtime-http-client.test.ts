import { describe, expect, it, vi } from 'vitest'
import { RuntimeHttpClient } from '../../../../../src/renderer/src/services/runtime-http-client'

describe('RuntimeHttpClient', () => {
  it('stages a document upload with its encoded file name', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            fileId: 'file-1',
            name: '季度报告.pdf',
            mimeType: 'application/pdf',
            byteLength: 12
          }
        }),
        { status: 200 }
      )
    )
    const client = new RuntimeHttpClient(
      async () => ({
        wsUrl: 'ws://127.0.0.1:45123/stream',
        accessToken: 'secret',
        protocol: 'actiondriver.stream.v2'
      }),
      fetcher
    )
    const file = new File(['%PDF-1.7'], '季度报告.pdf', { type: 'application/pdf' })

    await expect(client.uploadInputFile(file)).resolves.toMatchObject({ fileId: 'file-1' })
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:45123/input-files/staged',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret',
          'content-type': 'application/pdf',
          'x-actiondriver-file-name': encodeURIComponent('季度报告.pdf')
        })
      })
    )
  })

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
