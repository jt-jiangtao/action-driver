import type { ToolCall, ToolDefinition, ToolExecutor, ToolExecutorEvent } from '@actiondriver/runtime-contracts'

const MAX_RESULTS = 10
const MAX_TITLE_LENGTH = 256
const MAX_URL_LENGTH = 2_048
const MAX_SNIPPET_LENGTH = 1_024
const MAX_METADATA_LENGTH = 128
const MAX_ENGINES = 8

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

type SearxngResult = {
  title?: unknown
  url?: unknown
  content?: unknown
  engines?: unknown
  category?: unknown
}

export function parseSearxngEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('SEARXNG_ENDPOINT_INVALID')
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('SEARXNG_ENDPOINT_INVALID')
  }
  return url.origin
}

export function createSearxngSearchTool(options: {
  endpoint: string
  fetch?: FetchLike
  timeoutMs?: number
  maxResponseBytes?: number
}): { definition: ToolDefinition; executor: ToolExecutor } {
  const endpoint = parseSearxngEndpoint(options.endpoint)
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024
  const fetch = options.fetch ?? globalThis.fetch
  const definition: ToolDefinition = {
    id: 'web.search',
    version: 1,
    modelName: 'web_search',
    description: 'Search the public web through a local SearXNG service',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 512 },
        categories: { type: 'string', maxLength: 128 },
        language: { type: 'string', maxLength: 32 },
        safesearch: { type: 'integer', minimum: 0, maximum: 2 },
        pageno: { type: 'integer', minimum: 1, maximum: 10 },
        maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS }
      },
      required: ['query'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffects: { filesystem: 'none', network: true },
    timeoutMs
  }
  return {
    definition,
    executor: {
      async *execute(call: ToolCall, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent> {
        const query = String(call.arguments.query ?? '').trim()
        if (!query) throw new Error('SEARXNG_QUERY_INVALID')
        const url = new URL('/search', endpoint)
        url.searchParams.set('q', query)
        url.searchParams.set('format', 'json')
        for (const key of ['categories', 'language', 'safesearch', 'pageno'] as const) {
          const value = call.arguments[key]
          if (value !== undefined) url.searchParams.set(key, String(value))
        }
        const maxResults = readMaxResults(call.arguments.maxResults)
        const controller = new AbortController()
        const abort = () => controller.abort(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        const timeout = setTimeout(() => controller.abort(new Error('SEARXNG_TIMEOUT')), timeoutMs)
        try {
          const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal })
          if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
            throw new Error('SEARXNG_REDIRECT_DENIED')
          }
          if (!response.ok) throw new Error(`SEARXNG_HTTP_${response.status}`)
          if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
            throw new Error('SEARXNG_RESPONSE_INVALID')
          }
          const body = readJson(await readResponse(response, maxResponseBytes)) as { results?: unknown }
          if (!Array.isArray(body.results)) throw new Error('SEARXNG_RESPONSE_INVALID')
          const normalized = body.results
            .map(normalizeResult)
            .filter((result): result is NonNullable<typeof result> => result !== null)
          yield {
            kind: 'result',
            output: {
              results: normalized.slice(0, maxResults).map(({ result }) => result),
              truncated: normalized.length > maxResults || normalized.some(({ truncated }) => truncated),
              totalResults: normalized.length
            }
          }
        } finally {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
        }
      }
    }
  }
}

async function readResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error('SEARXNG_RESPONSE_INVALID')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new Error('SEARXNG_RESPONSE_LIMIT')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const combined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

function readJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('SEARXNG_RESPONSE_INVALID')
  }
}

function readMaxResults(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_RESULTS
    ? value
    : MAX_RESULTS
}

function normalizeResult(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as SearxngResult
  if (typeof result.title !== 'string' || typeof result.url !== 'string') return null
  const title = truncate(result.title, MAX_TITLE_LENGTH)
  const url = truncate(result.url, MAX_URL_LENGTH)
  const snippet = typeof result.content === 'string' ? truncate(result.content, MAX_SNIPPET_LENGTH) : undefined
  const engines = Array.isArray(result.engines) && result.engines.every((engine) => typeof engine === 'string')
    ? result.engines.slice(0, MAX_ENGINES).map((engine) => truncate(engine, MAX_METADATA_LENGTH))
    : undefined
  const category = typeof result.category === 'string' ? truncate(result.category, MAX_METADATA_LENGTH) : undefined
  const sourceEngines = Array.isArray(result.engines) && result.engines.every((engine) => typeof engine === 'string')
    ? result.engines
    : undefined
  return {
    result: {
      title,
      url,
      ...(snippet !== undefined ? { snippet } : {}),
      ...(engines !== undefined ? { engines } : {}),
      ...(category !== undefined ? { category } : {})
    },
    truncated:
      title !== result.title ||
      url !== result.url ||
      (snippet !== undefined && snippet !== result.content) ||
      (engines !== undefined && sourceEngines !== undefined && engines.length !== sourceEngines.length) ||
      (engines !== undefined && sourceEngines !== undefined && engines.some((engine, index) => engine !== sourceEngines[index])) ||
      (category !== undefined && category !== result.category)
  }
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value)
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : value
}

