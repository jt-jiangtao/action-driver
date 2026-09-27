import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
  readPublicHtml,
  requestOptionsForAddress,
  requestPage,
  type PageResponse
} from '../src/web-open/http'

function page(
  statusCode: number,
  body = '<html><body>Article</body></html>',
  headers = {}
): PageResponse {
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    body: Readable.from([Buffer.from(body)]),
    remoteAddress: '8.8.8.8',
    close: vi.fn()
  }
}

describe('tools_local_web_open bounded public HTTP', () => {
  it('uses the pinned address in a real Node HTTP connection', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html')
      response.end('<html><body>connected</body></html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server port')
      const response = await requestPage(
        new URL(`http://example.com:${address.port}/page`),
        { address: '127.0.0.1', family: 4 },
        new AbortController().signal
      )
      try {
        const chunks: Buffer[] = []
        for await (const chunk of response.body) chunks.push(Buffer.from(chunk))
        expect(Buffer.concat(chunks).toString()).toContain('connected')
        expect(response.remoteAddress).toBe('127.0.0.1')
      } finally {
        response.close()
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('pins the vetted address while preserving URL host and HTTPS identity', async () => {
    const url = new URL('https://example.com/article')
    const options = requestOptionsForAddress(url, { address: '8.8.8.8', family: 4 })
    expect(options.hostname).toBe('example.com')
    expect(options.servername).toBe('example.com')
    expect(options.agent).toBe(false)
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options.lookup?.('example.com', {}, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address: address as string, family: family as number })
      })
    })
    expect(result).toEqual({ address: '8.8.8.8', family: 4 })
    const allResult = await new Promise<Array<{ address: string; family: number }>>(
      (resolve, reject) => {
        options.lookup?.('example.com', { all: true }, (error, addresses) => {
          if (error) reject(error)
          else resolve(addresses as Array<{ address: string; family: number }>)
        })
      }
    )
    expect(allResult).toEqual([{ address: '8.8.8.8', family: 4 }])
  })

  it('revalidates each redirect and never requests a private destination', async () => {
    const request = vi.fn(async (url: URL) =>
      page(302, '', { location: url.hostname === 'example.com' ? 'http://127.0.0.1/secret' : '/' })
    )
    await expect(
      readPublicHtml('https://example.com', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request
      })
    ).rejects.toThrow('WEB_OPEN_URL_DENIED')
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects DNS rebinding without connecting to the changed address', async () => {
    const request = vi.fn(async () => page(200))
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 as const }])
    await readPublicHtml('https://example.com', { lookup, request })
    expect(lookup).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(
      expect.any(URL),
      { address: '8.8.8.8', family: 4 },
      expect.any(AbortSignal)
    )
  })

  it('rejects a mismatched remote socket address', async () => {
    const request = vi.fn(async () => ({ ...page(200), remoteAddress: '127.0.0.1' }))
    await expect(
      readPublicHtml('https://example.com', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request
      })
    ).rejects.toThrow('WEB_OPEN_URL_DENIED')
  })

  it('limits redirects to three hops', async () => {
    const request = vi.fn(async () => page(302, '', { location: '/next' }))
    await expect(
      readPublicHtml('https://example.com', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request
      })
    ).rejects.toThrow('WEB_OPEN_REDIRECT_LIMIT')
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('rejects non-HTML, HTTP errors and oversized transfer', async () => {
    const lookup = async () => [{ address: '8.8.8.8', family: 4 as const }]
    await expect(
      readPublicHtml('https://example.com', {
        lookup,
        request: async () => page(200, '{}', { 'content-type': 'application/json' })
      })
    ).rejects.toThrow('WEB_OPEN_CONTENT_UNSUPPORTED')
    await expect(
      readPublicHtml('https://example.com', {
        lookup,
        request: async () => page(503)
      })
    ).rejects.toThrow('WEB_OPEN_HTTP_503')
    await expect(
      readPublicHtml('https://example.com', {
        lookup,
        maxTransferBytes: 10,
        request: async () => page(200, 'A'.repeat(30))
      })
    ).rejects.toThrow('WEB_OPEN_RESPONSE_LIMIT')
  })

  it('limits decompressed bytes and supports gzip HTML', async () => {
    const html = '<html><body>' + 'X'.repeat(2_000) + '</body></html>'
    const compressed = gzipSync(html)
    const response = (): PageResponse => ({
      ...page(200),
      headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      body: Readable.from([compressed])
    })
    const lookup = async () => [{ address: '8.8.8.8', family: 4 as const }]
    await expect(
      readPublicHtml('https://example.com', {
        lookup,
        request: async () => response(),
        maxDecodedBytes: 100
      })
    ).rejects.toThrow('WEB_OPEN_RESPONSE_LIMIT')
    const result = await readPublicHtml('https://example.com', {
      lookup,
      request: async () => response()
    })
    expect(result.html).toBe(html)
  })

  it('reports malformed compressed HTML as a stable response error', async () => {
    await expect(
      readPublicHtml('https://example.com', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => ({
          ...page(200),
          headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
          body: Readable.from([Buffer.from('not gzip')])
        })
      })
    ).rejects.toThrow('WEB_OPEN_RESPONSE_INVALID')
  })

  it('decodes a page charset declared in HTML when HTTP omits it', async () => {
    const html = Buffer.concat([
      Buffer.from('<html><head><meta charset="gbk"></head><body>'),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
      Buffer.from('</body></html>')
    ])
    const response = (): PageResponse => ({
      ...page(200),
      headers: { 'content-type': 'text/html' },
      body: Readable.from([html])
    })
    const result = await readPublicHtml('https://example.com', {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => response()
    })
    expect(result.html).toContain('中文')
  })

  it('cancels a pending request', async () => {
    const controller = new AbortController()
    const request = vi.fn(
      async (_url: URL, _address: unknown, signal: AbortSignal) =>
        new Promise<PageResponse>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        })
    )
    const pending = readPublicHtml('https://example.com', {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request,
      signal: controller.signal
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    controller.abort(new Error('USER_CANCELLED'))
    await expect(pending).rejects.toThrow('USER_CANCELLED')
  })

  it('reports a timeout while a response body stalls and closes it', async () => {
    const response = page(200)
    response.body = new Readable({ read() {} })
    await expect(
      readPublicHtml('https://example.com', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => response,
        timeoutMs: 10
      })
    ).rejects.toThrow('WEB_OPEN_TIMEOUT')
    expect(response.close).toHaveBeenCalledOnce()
  })
})
