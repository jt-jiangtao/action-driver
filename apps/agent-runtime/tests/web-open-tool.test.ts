import { describe, expect, it, vi } from 'vitest'
import { createWebOpenTool, registerWebOpenTool } from '../src/web-open/tool'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { extractPageText } from '../src/web-open/extract'

function call(url: string) {
  return {
    callId: 'call-web-open',
    providerCallId: 'provider-web-open',
    modelName: 'tools_local_web_open',
    arguments: { url }
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('tools_local_web_open tool', () => {
  it('registers a separate network tool and grants it by default', () => {
    const runtime = { registry: new RuntimeToolRegistry(), grants: [] as string[] }
    registerWebOpenTool(runtime)
    expect(runtime.registry.list()).toMatchObject([
      {
        id: 'tools/local/web/open',
        version: 1,
        modelName: 'tools_local_web_open',
        sideEffects: { filesystem: 'none', network: true }
      }
    ])
    expect(runtime.grants).toEqual(['tools/local/web/open@1'])
  })

  it('returns only bounded extracted text and final source URL', async () => {
    const read = vi.fn(async () => ({
      html: '<html><head><title>最终页面</title></head><body><main>正文内容</main></body></html>',
      url: 'https://example.com/final'
    }))
    const tool = createWebOpenTool({
      read,
      extract: async (html, url) => extractPageText(html, url)
    })
    expect(tool.definition.inputSchema).toMatchObject({
      required: ['url'],
      additionalProperties: false
    })
    const events = await collect(tool.executor.execute(call('https://example.com/start')))
    expect(events).toEqual([
      {
        kind: 'result',
        output: {
          title: '最终页面',
          url: 'https://example.com/final',
          text: '正文内容',
          truncated: false
        }
      }
    ])
    expect(read).toHaveBeenCalledWith('https://example.com/start', undefined)
  })

  it('never calls the network reader for a private URL', async () => {
    const read = vi.fn()
    const tool = createWebOpenTool({ read })
    await expect(collect(tool.executor.execute(call('http://127.0.0.1/')))).rejects.toThrow(
      'WEB_OPEN_URL_DENIED'
    )
    expect(read).not.toHaveBeenCalled()
  })
})
