import type { ToolDefinition, ToolExecutor } from '@action-driver/plugin-sdk'
import { parsePublicUrl, type AddressLookup } from './address.js'
import {
  boundedText,
  containsCredential,
  record,
  requestProviderJson,
  WebProviderError,
  withProviderBudget,
  type FetchLike
} from '../provider-http.js'
import { resolveReaderAddress } from './public-address.js'
import { definition } from './catalog.js'

export function createJinaReaderTool(options: {
  apiKey: string
  fetch?: FetchLike
  lookup?: AddressLookup
  timeoutMs?: number
}): { definition: ToolDefinition; executor: ToolExecutor } {
  const timeoutMs = options.timeoutMs ?? 30_000
  return {
    definition: { ...definition, timeoutMs },
    executor: {
      async *execute(call, signal) {
        if (
          typeof call.arguments.url !== 'string' ||
          Object.keys(call.arguments).some((key) => key !== 'url')
        )
          throw new Error('TOOL_INPUT_INVALID')
        const input = parsePublicUrl(call.arguments.url)
        if (!options.apiKey.trim()) throw new WebProviderError('WEB_OPEN', 'NOT_CONFIGURED')
        const output = await withProviderBudget(
          'WEB_OPEN',
          timeoutMs,
          signal,
          async (activeSignal) => {
            try {
              await resolveReaderAddress(
                input,
                activeSignal,
                options.fetch ?? globalThis.fetch,
                options.lookup
              )
            } catch (error) {
              throw new WebProviderError(
                'WEB_OPEN',
                error instanceof Error && error.message === 'WEB_OPEN_URL_DENIED'
                  ? 'URL_DENIED'
                  : 'DNS_FAILED'
              )
            }
            if (activeSignal.aborted) throw activeSignal.reason
            const raw = await requestProviderJson(
              options.fetch ?? globalThis.fetch,
              `https://r.jina.ai/${input.href}`,
              {
                method: 'GET',
                signal: activeSignal,
                headers: {
                  Authorization: `Bearer ${options.apiKey}`,
                  Accept: 'application/json',
                  'X-With-Generated-Alt': 'false'
                }
              },
              'WEB_OPEN',
              1024 * 1024
            )
            const data = record(record(raw)?.data)
            if (
              !data ||
              typeof data.content !== 'string' ||
              (data.url !== undefined && typeof data.url !== 'string')
            )
              throw new WebProviderError('WEB_OPEN', 'RESPONSE_INVALID')
            if (typeof data.url === 'string' && containsCredential(data.url, options.apiKey))
              throw new WebProviderError('WEB_OPEN', 'RESPONSE_INVALID')
            let source: URL
            try {
              source = data.url === undefined ? input : parsePublicUrl(data.url as string)
              if (source.href !== input.href)
                await resolveReaderAddress(
                  source,
                  activeSignal,
                  options.fetch ?? globalThis.fetch,
                  options.lookup
                )
            } catch {
              throw new WebProviderError('WEB_OPEN', 'URL_DENIED')
            }
            const content = data.content.trim().replaceAll(options.apiKey, '[redacted]')
            if (!content) throw new WebProviderError('WEB_OPEN', 'EMPTY_CONTENT')
            const titleValue =
              typeof data.title === 'string'
                ? data.title.trim().replaceAll(options.apiKey, '[redacted]')
                : ''
            // Detect common short gate pages; ordinary articles discussing authentication remain readable.
            if (
              (content.length < 1500 &&
                /^(?:#\s*)?(?:verify you are human|checking your browser|just a moment|sign in to continue|log in to continue|access denied|captcha|请完成验证|请登录后继续)/iu.test(
                  content
                )) ||
              /^(?:just a moment|verify you are human|access denied)[.!…\s]*$/iu.test(titleValue)
            )
              throw new WebProviderError('WEB_OPEN', 'UNREADABLE')
            const text = boundedText(content, 12_000),
              title = boundedText(titleValue || source.hostname, 256)
            return {
              title: title.text,
              url: source.href,
              text: text.text,
              truncated: text.truncated || title.truncated
            }
          }
        )
        yield { kind: 'result', output }
      }
    }
  }
}
