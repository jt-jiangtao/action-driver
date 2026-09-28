import { describe, expect, it } from 'vitest'
import { LangGraphRunner, MockSkillRegistry } from '../src/index'
import { RuntimeToolPolicy } from '../src/tool-policy'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { ToolInvocationService } from '../src/tool-invocation-service'
import { createSearxngSearchTool } from '../src/searxng/search-tool'
import { createWebOpenTool } from '../src/web-open/tool'
import { extractPageText } from '../src/web-open/extract'
import type { ModelGateway } from '../src/ports'

describe('search-to-tools_local_web_open agent loop', () => {
  it('searches, reads the returned URL, and gives the model sourced text', async () => {
    let turn = 0
    const model: ModelGateway = {
      async complete(request) {
        turn += 1
        if (turn === 1) {
          expect(request.tools?.map((tool) => tool.modelName)).toEqual(['tools_local_web_search', 'tools_local_web_open'])
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'search-1',
                modelName: 'tools_local_web_search',
                arguments: { query: 'ActionDriver' }
              }
            ]
          }
        }
        if (turn === 2) {
          expect(JSON.stringify(request.messages.at(-1))).toContain('https://example.com/article')
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: 'open-1',
                modelName: 'tools_local_web_open',
                arguments: { url: 'https://example.com/article' }
              }
            ]
          }
        }
        expect(JSON.stringify(request.messages.at(-1))).toContain('正文证据')
        expect(JSON.stringify(request.messages.at(-1))).toContain('https://example.com/article')
        return { kind: 'finish', content: '已读取来源' }
      }
    }
    const search = createSearxngSearchTool({
      endpoint: 'http://127.0.0.1:8080',
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Article',
                url: 'https://example.com/article',
                content: 'Summary'
              }
            ]
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    })
    const open = createWebOpenTool({
      extract: async (html, url) => extractPageText(html, url),
      read: async (url) => ({
        html: '<html><head><title>Article</title></head><body><main>正文证据</main></body></html>',
        url
      })
    })
    const registry = new RuntimeToolRegistry()
    registry.register(search.definition, search.executor)
    registry.register(open.definition, open.executor)
    const policy = new RuntimeToolPolicy()
    let cursor = 0
    const invocations = new ToolInvocationService({
      registry,
      policy,
      persistence: {
        async commitToolInvocationWithEvent(_invocation, event) {
          return { ...event, cursor: ++cursor }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry,
      policy,
      invocations,
      grants: ['tools/local/web/search@1', 'tools/local/web/open@1']
    })
    const result = await runner.run({
      taskId: 'task-search-open',
      goal: '读取资料',
      model: { connectionId: 'connection-1', modelId: 'model-1' }
    })
    expect(result).toMatchObject({ status: 'completed', output: '已读取来源' })
    expect(turn).toBe(3)
  })
})
