import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolExecutorEvent
} from '@action-driver/plugin-sdk'
import { parsePublicUrl } from './address.js'
import type { ExtractedPage } from './extract.js'
import { definition } from './catalog.js'
import { readPublicHtml } from './http.js'
export { createJinaReaderTool } from './jina.js'

type HtmlReader = (url: string, signal?: AbortSignal) => Promise<{ html: string; url: string }>

export function createWebOpenTool(
  options: {
    read?: HtmlReader
    extract: (html: string, url: string, signal?: AbortSignal) => Promise<ExtractedPage>
  }
): {
  definition: ToolDefinition
  executor: ToolExecutor
} {
  const read =
    options.read ??
    ((url: string, signal?: AbortSignal) => readPublicHtml(url, signal ? { signal } : {}))
  return {
    definition,
    executor: {
      async *execute(call: ToolCall, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent> {
        const input = call.arguments.url
        if (typeof input !== 'string') throw new Error('WEB_OPEN_URL_DENIED')
        const url = parsePublicUrl(input)
        const page = await read(url.href, signal)
        yield { kind: 'result', output: await options.extract(page.html, page.url, signal) }
      }
    }
  }
}
