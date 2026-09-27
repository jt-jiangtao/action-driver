import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTavilySearchTool } from './search/tavily'
import { createJinaReaderTool } from './reader/jina'
import type { Json, ToolExecutor } from '@actiondriver/plugin-sdk'

const lookup = async () => [{ address: '93.184.216.34', family: 4 as const }]
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
async function run(executor: ToolExecutor, args: Record<string, Json>, signal?: AbortSignal) {
  const events = []
  for await (const event of executor.execute(
    { callId: 'call', providerCallId: 'provider', modelName: 'web', arguments: args },
    signal
  ))
    events.push(event)
  return events.at(-1)
}
afterEach(() => vi.useRealTimers())

describe('Tavily Search', () => {
  it('sends a bounded basic search and returns sourced snippets without exposing credentials', async () => {
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.tavily.com/search')
      expect(init?.redirect).toBe('manual')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer search-secret')
      expect(JSON.parse(String(init?.body))).toEqual({
        query: 'ActionDriver',
        max_results: 5,
        search_depth: 'basic',
        auto_parameters: false,
        include_answer: false,
        include_raw_content: false
      })
      return response({
        results: [{ title: 'Article', url: 'https://example.com/article', content: 'Evidence' }]
      })
    })
    const tool = createTavilySearchTool({ apiKey: 'search-secret', fetch })
    const result = await run(tool.executor, { query: ' ActionDriver ' })
    expect(result).toEqual({
      kind: 'result',
      output: {
        results: [{ title: 'Article', url: 'https://example.com/article', snippet: 'Evidence' }],
        totalResults: 1,
        truncated: false
      }
    })
    expect(JSON.stringify(result)).not.toContain('search-secret')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    { query: '' },
    { query: 'q', pageno: 1 },
    { query: 'q', maxResults: 11 },
    { query: 'q', maxResults: 0 },
    { query: 'x'.repeat(513) }
  ])('rejects invalid input before networking: %j', async (args) => {
    const fetch = vi.fn()
    await expect(
      run(createTavilySearchTool({ apiKey: 'key', fetch }).executor, args)
    ).rejects.toThrow('TOOL_INPUT_INVALID')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('filters unsafe URLs, preserves order, and marks output truncation', async () => {
    const tool = createTavilySearchTool({
      apiKey: 'key',
      fetch: async () =>
        response({
          results: [
            { title: 'Private', url: 'http://127.0.0.1/', content: 'private' },
            { title: 'Credentials', url: 'https://user:pass@example.com/' },
            { title: 'a'.repeat(300), url: 'https://example.com/', content: 'x'.repeat(1200) },
            { title: 'Second', url: 'https://example.org/' }
          ]
        })
    })
    const result = await run(tool.executor, { query: 'q', maxResults: 1 })
    expect(result).toMatchObject({
      output: { totalResults: 2, truncated: true, results: [{ url: 'https://example.com/' }] }
    })
    expect(JSON.stringify(result).length).toBeLessThan(2000)
  })
  it('returns an empty successful result distinctly from malformed data', async () => {
    expect(
      await run(
        createTavilySearchTool({ apiKey: 'key', fetch: async () => response({ results: [] }) })
          .executor,
        { query: 'q' }
      )
    ).toMatchObject({ output: { results: [], totalResults: 0 } })
    await expect(
      run(
        createTavilySearchTool({ apiKey: 'key', fetch: async () => response({ results: 'bad' }) })
          .executor,
        { query: 'q' }
      )
    ).rejects.toThrow('WEB_SEARCH_RESPONSE_INVALID')
  })
})

describe('Jina Reader', () => {
  it('reads one validated URL and maps JSON to the existing page result', async () => {
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://r.jina.ai/https://example.com/article')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer reader-secret')
      expect(new Headers(init?.headers).get('cookie')).toBeNull()
      expect(init?.redirect).toBe('manual')
      return response({
        data: {
          title: 'Article',
          url: 'https://example.com/article',
          content: '# Article\nEvidence'
        }
      })
    })
    const result = await run(
      createJinaReaderTool({ apiKey: 'reader-secret', fetch, lookup }).executor,
      { url: 'https://example.com/article#fragment' }
    )
    expect(result).toEqual({
      kind: 'result',
      output: {
        title: 'Article',
        url: 'https://example.com/article',
        text: '# Article\nEvidence',
        truncated: false
      }
    })
    expect(JSON.stringify(result)).not.toContain('reader-secret')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    'http://localhost/',
    'http://10.0.0.1/',
    'http://[::ffff:127.0.0.1]/',
    'https://user:pass@example.com/',
    'file:///tmp/test'
  ])('refuses private or credential-bearing input %s', async (url) => {
    const fetch = vi.fn()
    await expect(
      run(createJinaReaderTool({ apiKey: 'key', fetch, lookup }).executor, { url })
    ).rejects.toThrow('WEB_OPEN_URL_DENIED')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses a hostname resolving to private addresses before forwarding to Jina', async () => {
    const fetch = vi.fn()
    await expect(
      run(
        createJinaReaderTool({
          apiKey: 'key',
          fetch,
          lookup: async () => [{ address: '192.168.1.1', family: 4 }]
        }).executor,
        { url: 'https://example.com/' }
      )
    ).rejects.toThrow('WEB_OPEN_URL_DENIED')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses unsafe returned sources and falls back to input only when source is absent', async () => {
    await expect(
      run(
        createJinaReaderTool({
          apiKey: 'key',
          lookup,
          fetch: async () =>
            response({ data: { title: 'Private', url: 'http://10.0.0.1/', content: 'text' } })
        }).executor,
        { url: 'https://example.com/' }
      )
    ).rejects.toThrow('WEB_OPEN_URL_DENIED')
    expect(
      await run(
        createJinaReaderTool({
          apiKey: 'key',
          lookup,
          fetch: async () => response({ data: { content: 'text' } })
        }).executor,
        { url: 'https://example.com/' }
      )
    ).toMatchObject({ output: { title: 'example.com', url: 'https://example.com/', text: 'text' } })
  })
  it('truncates Unicode by characters without splitting pairs', async () => {
    const result = await run(
      createJinaReaderTool({
        apiKey: 'key',
        lookup,
        fetch: async () =>
          response({ data: { title: '😀'.repeat(300), content: '😀'.repeat(12001) } })
      }).executor,
      { url: 'https://example.com/' }
    )
    expect(result).toMatchObject({
      output: { title: '😀'.repeat(256), text: '😀'.repeat(12000), truncated: true }
    })
  })
  it.each(['', 'Verify you are human', 'Sign in to continue', 'Just a moment...'])(
    'rejects empty or obvious challenge content %j',
    async (content) => {
      await expect(
        run(
          createJinaReaderTool({
            apiKey: 'key',
            lookup,
            fetch: async () => response({ data: { content } })
          }).executor,
          { url: 'https://example.com/' }
        )
      ).rejects.toThrow(content ? 'WEB_OPEN_UNREADABLE' : 'WEB_OPEN_EMPTY_CONTENT')
    }
  )
})

describe.each(['search', 'reader'] as const)('%s provider failures and lifecycle', (kind) => {
  const prefix = kind === 'search' ? 'WEB_SEARCH' : 'WEB_OPEN'
  const args = kind === 'search' ? { query: 'q' } : { url: 'https://example.com/' }
  const tool = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
    kind === 'search'
      ? createTavilySearchTool({
          apiKey: 'do-not-leak',
          fetch,
          ...(timeoutMs ? { timeoutMs } : {})
        })
      : createJinaReaderTool({
          apiKey: 'do-not-leak',
          fetch,
          lookup,
          ...(timeoutMs ? { timeoutMs } : {})
        })
  it.each([
    [401, 'AUTH_FAILED'],
    [403, 'ACCESS_DENIED'],
    [429, 'RATE_LIMITED'],
    [432, 'QUOTA_EXCEEDED'],
    [433, 'QUOTA_EXCEEDED'],
    [500, 'HTTP_500'],
    [302, 'REDIRECT_DENIED']
  ])('maps HTTP %i without exposing the body', async (status, code) => {
    await expect(
      run(tool(async () => response({ error: 'do-not-leak' }, Number(status))).executor, args)
    ).rejects.toThrow(`${prefix}_${code}`)
  })
  it('sanitizes network exceptions', async () => {
    await expect(
      run(
        tool(async () => {
          throw new Error('do-not-leak')
        }).executor,
        args
      )
    ).rejects.toThrow(`${prefix}_NETWORK_FAILED`)
  })
  it('rejects non-JSON, malformed JSON and oversized responses', async () => {
    for (const value of [
      new Response('<html>secret</html>'),
      new Response('{', { headers: { 'content-type': 'application/json' } })
    ]) {
      await expect(run(tool(async () => value).executor, args)).rejects.toThrow(
        `${prefix}_RESPONSE_INVALID`
      )
    }
    await expect(
      run(tool(async () => response({ content: 'x'.repeat(1100000) })).executor, args)
    ).rejects.toThrow(`${prefix}_RESPONSE_LIMIT`)
  })
  it('rejects pre-cancelled calls without starting a request', async () => {
    const fetch = vi.fn(),
      controller = new AbortController()
    controller.abort(new Error('do-not-leak'))
    await expect(run(tool(fetch).executor, args, controller.signal)).rejects.toThrow(
      `${prefix}_CANCELLED`
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('enforces timeout and user cancellation even when a dependency ignores abort', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<Response>(() => {})),
      controller = new AbortController()
    const timed = expect(run(tool(fetch, 20).executor, args)).rejects.toThrow(`${prefix}_TIMEOUT`)
    await vi.advanceTimersByTimeAsync(21)
    await timed
    const cancelled = expect(run(tool(fetch).executor, args, controller.signal)).rejects.toThrow(
      `${prefix}_CANCELLED`
    )
    controller.abort(new Error('do-not-leak'))
    await cancelled
  })
})

describe('provider credential echoes in source URLs', () => {
  it.each(['search-secret', '%73earch-secret'])(
    'filters search URL containing %s',
    async (echo) => {
      const tool = createTavilySearchTool({
        apiKey: 'search-secret',
        fetch: async () =>
          response({ results: [{ title: 'Echo', url: `https://example.com/?echo=${echo}` }] })
      })
      expect(await run(tool.executor, { query: 'q' })).toMatchObject({ output: { results: [] } })
    }
  )
  it.each(['reader-secret', '%72eader-secret'])(
    'rejects reader source URL containing %s',
    async (echo) => {
      const tool = createJinaReaderTool({
        apiKey: 'reader-secret',
        lookup,
        fetch: async () =>
          response({ data: { url: `https://example.com/?echo=${echo}`, content: 'Article' } })
      })
      await expect(run(tool.executor, { url: 'https://example.com/' })).rejects.toThrow(
        'WEB_OPEN_RESPONSE_INVALID'
      )
    }
  )
})

it('rejects Markdown login headings and padded challenge titles', async () => {
  for (const data of [
    { content: '# Sign in to continue' },
    { content: 'Challenge', title: 'Just a moment...   ' }
  ]) {
    const tool = createJinaReaderTool({
      apiKey: 'reader-secret',
      lookup,
      fetch: async () => response({ data })
    })
    await expect(run(tool.executor, { url: 'https://example.com/' })).rejects.toThrow(
      'WEB_OPEN_UNREADABLE'
    )
  }
})
