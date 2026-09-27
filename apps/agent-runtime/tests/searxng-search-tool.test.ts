import { describe, expect, it, vi } from 'vitest'
import { createSearxngSearchTool, parseSearxngEndpoint } from '../src/searxng/search-tool'

describe('SearXNG search tool', () => {
  it('accepts only literal loopback endpoint origins', () => {
    expect(parseSearxngEndpoint('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(parseSearxngEndpoint('http://[::1]:8080')).toBe('http://[::1]:8080')
    for (const endpoint of [
      'https://127.0.0.1:8080',
      'http://localhost:8080',
      'http://192.168.1.2:8080',
      'http://127.0.0.1',
      'http://127.0.0.1:8080/prefix',
      'http://user@127.0.0.1:8080'
    ]) {
      expect(() => parseSearxngEndpoint(endpoint)).toThrow('SEARXNG_ENDPOINT_INVALID')
    }
  })

  it('requests only the JSON search endpoint and returns bounded normalized results', async () => {
    const fetch = vi.fn(async (input: URL | string) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8080/search?q=ActionDriver&format=json&categories=general&language=zh-CN&safesearch=1&pageno=2'
      )
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'First result',
              url: 'https://example.test/one',
              content: 'A short result summary',
              engines: ['brave'],
              category: 'general'
            },
            {
              title: 'Second result',
              url: 'https://example.test/two',
              content: 'This result must be excluded by maxResults'
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    const tool = createSearxngSearchTool({ endpoint: 'http://127.0.0.1:8080', fetch })
    const events = await collect(
      tool.executor.execute({
        callId: 'call-1',
        providerCallId: 'provider-1',
        modelName: 'tools_local_web_search',
        arguments: {
          query: 'ActionDriver',
          categories: 'general',
          language: 'zh-CN',
          safesearch: 1,
          pageno: 2,
          maxResults: 1
        }
      })
    )

    expect(tool.definition).toMatchObject({
      id: 'tools.local.web.search',
      modelName: 'tools_local_web_search',
      sideEffects: { network: true }
    })
    expect(events.at(-1)).toEqual({
      kind: 'result',
      output: {
        results: [
          {
            title: 'First result',
            url: 'https://example.test/one',
            snippet: 'A short result summary',
            engines: ['brave'],
            category: 'general'
          }
        ],
        truncated: true,
        totalResults: 2
      }
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual' })
    )
  })

  it('rejects an upstream JSON response that exceeds the configured byte limit', async () => {
    const tool = createSearxngSearchTool({
      endpoint: 'http://127.0.0.1:8080',
      maxResponseBytes: 32,
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [{ title: 'result', url: 'https://example.test', content: 'x'.repeat(100) }]
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    })
    await expect(
      collect(
        tool.executor.execute({
          callId: 'call-1',
          providerCallId: 'provider-1',
          modelName: 'tools_local_web_search',
          arguments: { query: 'ActionDriver' }
        })
      )
    ).rejects.toThrow('SEARXNG_RESPONSE_LIMIT')
  })

  it('bounds individual fields and rejects malformed, failed, redirected, and timed-out responses', async () => {
    const long = 'x'.repeat(3_000)
    const bounded = createSearxngSearchTool({
      endpoint: 'http://127.0.0.1:8080',
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: long,
                url: `https://example.test/${long}`,
                content: long,
                engines: [long],
                category: long
              }
            ]
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    })
    const [event] = await collect(bounded.executor.execute(call()))
    expect(event).toMatchObject({
      kind: 'result',
      output: {
        truncated: true,
        results: [
          {
            title: expect.stringMatching(/…$/),
            url: expect.stringMatching(/…$/),
            snippet: expect.stringMatching(/…$/),
            engines: [expect.stringMatching(/…$/)],
            category: expect.stringMatching(/…$/)
          }
        ]
      }
    })

    for (const response of [
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } }),
      new Response('{}', { status: 302, headers: { location: 'http://127.0.0.1:9999/search' } })
    ]) {
      const tool = createSearxngSearchTool({
        endpoint: 'http://127.0.0.1:8080',
        fetch: async () => response
      })
      await expect(collect(tool.executor.execute(call()))).rejects.toThrow(
        /SEARXNG_(RESPONSE_INVALID|HTTP_502|REDIRECT_DENIED)/
      )
    }

    const timedOut = createSearxngSearchTool({
      endpoint: 'http://127.0.0.1:8080',
      timeoutMs: 5,
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        )
    })
    await expect(collect(timedOut.executor.execute(call()))).rejects.toThrow('SEARXNG_TIMEOUT')
  })
})

function call() {
  return {
    callId: 'call-1',
    providerCallId: 'provider-1',
    modelName: 'tools_local_web_search',
    arguments: { query: 'ActionDriver' }
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = []
  for await (const event of iterable) events.push(event)
  return events
}
