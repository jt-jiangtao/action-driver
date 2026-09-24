import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolExecutorEvent
} from '@actiondriver/runtime-contracts'
import type { RuntimeToolRegistry } from '../tool-registry'
import { parsePublicUrl } from './address'
import type { ExtractedPage } from './extract'
import { extractPageTextIsolated } from './extract-isolated'
import { readPublicHtml } from './http'

type HtmlReader = (url: string, signal?: AbortSignal) => Promise<{ html: string; url: string }>

export function createWebOpenTool(
  options: {
    read?: HtmlReader
    extract?: (html: string, url: string, signal?: AbortSignal) => Promise<ExtractedPage>
  } = {}
): {
  definition: ToolDefinition
  executor: ToolExecutor
} {
  const read =
    options.read ??
    ((url: string, signal?: AbortSignal) => readPublicHtml(url, signal ? { signal } : {}))
  const definition: ToolDefinition = {
    id: 'web.open',
    version: 1,
    modelName: 'web_open',
    description:
      'Read the bounded plain-text content of one public HTTP(S) HTML page by URL. Does not execute JavaScript or follow page links.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', minLength: 1, maxLength: 2_048 } },
      required: ['url'],
      additionalProperties: false
    },
    risk: 'medium',
    sideEffects: { filesystem: 'none', network: true },
    timeoutMs: 15_000
  }
  return {
    definition,
    executor: {
      async *execute(call: ToolCall, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent> {
        const input = call.arguments.url
        if (typeof input !== 'string') throw new Error('WEB_OPEN_URL_DENIED')
        const url = parsePublicUrl(input)
        const page = await read(url.href, signal)
        const extract =
          options.extract ??
          ((html: string, url: string, signal?: AbortSignal) =>
            extractPageTextIsolated(html, url, signal ? { signal } : {}))
        yield { kind: 'result', output: await extract(page.html, page.url, signal) }
      }
    }
  }
}

export function registerWebOpenTool(runtime: {
  registry: RuntimeToolRegistry
  grants: string[]
}): void {
  const tool = createWebOpenTool()
  runtime.registry.register(tool.definition, tool.executor)
  runtime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
}
