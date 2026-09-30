import type { ToolDefinition, ToolExecutor } from '@action-driver/plugin-sdk'
import { parsePublicUrl } from '../reader/address.js'
import {
  boundedText,
  containsCredential,
  record,
  requestProviderJson,
  WebProviderError,
  withProviderBudget,
  type FetchLike
} from '../provider-http.js'
import { createSearchDefinition } from './catalog.js'

export function createTavilySearchTool(options: {
  apiKey: string
  fetch?: FetchLike
  timeoutMs?: number
}): { definition: ToolDefinition; executor: ToolExecutor } {
  const timeoutMs = options.timeoutMs ?? 30_000
  return {
    definition: createSearchDefinition(timeoutMs),
    executor: {
      async *execute(call, signal) {
        const args = call.arguments,
          query = typeof args.query === 'string' ? args.query.trim() : ''
        const maxResults = args.maxResults ?? 5
        if (
          !query ||
          query.length > 512 ||
          Object.keys(args).some((key) => !['query', 'maxResults'].includes(key)) ||
          typeof maxResults !== 'number' ||
          !Number.isInteger(maxResults) ||
          maxResults < 1 ||
          maxResults > 10
        )
          throw new Error('TOOL_INPUT_INVALID')
        if (!options.apiKey.trim()) throw new WebProviderError('WEB_SEARCH', 'NOT_CONFIGURED')
        const output = await withProviderBudget(
          'WEB_SEARCH',
          timeoutMs,
          signal,
          async (activeSignal) => {
            const raw = await requestProviderJson(
              options.fetch ?? globalThis.fetch,
              'https://api.tavily.com/search',
              {
                method: 'POST',
                signal: activeSignal,
                headers: {
                  Authorization: `Bearer ${options.apiKey}`,
                  'Content-Type': 'application/json',
                  Accept: 'application/json'
                },
                body: JSON.stringify({
                  query,
                  max_results: maxResults,
                  search_depth: 'basic',
                  auto_parameters: false,
                  include_answer: false,
                  include_raw_content: false
                })
              },
              'WEB_SEARCH',
              256 * 1024
            )
            const body = record(raw)
            if (!body || !Array.isArray(body.results))
              throw new WebProviderError('WEB_SEARCH', 'RESPONSE_INVALID')
            let truncated = false
            const results: { title: string; url: string; snippet?: string }[] = []
            for (const value of body.results) {
              const item = record(value)
              if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') continue
              if (containsCredential(item.url, options.apiKey)) continue
              let url: string
              try {
                url = parsePublicUrl(item.url).href
              } catch {
                continue
              }
              const title = boundedText(item.title.replaceAll(options.apiKey, '[redacted]'), 256)
              const snippet =
                typeof item.content === 'string'
                  ? boundedText(item.content.replaceAll(options.apiKey, '[redacted]'), 1024)
                  : undefined
              truncated ||= title.truncated || Boolean(snippet?.truncated)
              results.push({
                title: title.text,
                url,
                ...(snippet ? { snippet: snippet.text } : {})
              })
            }
            return {
              results: results.slice(0, maxResults),
              totalResults: results.length,
              truncated: truncated || results.length > maxResults
            }
          }
        )
        yield { kind: 'result', output }
      }
    }
  }
}
