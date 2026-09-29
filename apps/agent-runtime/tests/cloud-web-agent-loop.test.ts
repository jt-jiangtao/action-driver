import { describe, expect, it, vi } from 'vitest'
import { LangGraphRunner, MockSkillRegistry } from '../src/index'
import { RuntimeToolPolicy } from '../src/tool-policy'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { ToolInvocationService } from '../src/tool-invocation-service'
import { createTavilySearchTool } from '../../../plugins/web/src/search/tavily'
import { createJinaReaderTool } from '../../../plugins/web/src/reader/jina'
import type { ModelGateway } from '../src/ports'

describe('Tavily-to-Jina agent loop', () => {
  it('does not contact a provider when grants are absent or the schema is invalid', async () => {
    const fetch = vi.fn(),
      tool = createTavilySearchTool({ apiKey: 'fixture-secret', fetch })
    const registry = new RuntimeToolRegistry()
    registry.register(tool.definition, tool.executor)
    const service = new ToolInvocationService({
      registry,
      policy: new RuntimeToolPolicy(),
      persistence: {
        async commitToolInvocationWithEvent(_invocation, event) {
          return { ...event, cursor: 1 }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    for (const [grants, args, code] of [
      [[], { query: 'q' }, 'TOOL_DENIED'],
      [['tools.local.web.search@1'], { query: 'q', pageno: 1 }, 'TOOL_INPUT_INVALID']
    ] as const) {
      const events = []
      for await (const event of service.execute(
        { callId: code, providerCallId: 'p', modelName: 'tools_local_web_search', arguments: args },
        { taskId: 't', threadId: 't', checkpointId: 'c', requestId: 'r', grants: [...grants] }
      ))
        events.push(event)
      expect(events.at(-1)).toMatchObject({ type: 'tool.failed', error: { code } })
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('searches, reads the returned URL, and gives the model sourced text', async () => {
    let turn = 0
    const model: ModelGateway = {
      async complete(request) {
        turn += 1
        if (turn === 1) {
          expect(request.tools?.map((tool) => tool.modelName)).toEqual([
            'tools_local_web_search',
            'tools_local_web_open'
          ])
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
    const search = createTavilySearchTool({
      apiKey: 'fixture-search-key',
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
    const open = createJinaReaderTool({
      apiKey: 'fixture-reader-key',
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: { title: 'Article', url: 'https://example.com/article', content: '正文证据' }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    })
    const registry = new RuntimeToolRegistry()
    registry.register(search.definition, search.executor)
    registry.register(open.definition, open.executor)
    const policy = new RuntimeToolPolicy()
    const stored: unknown[] = []
    let cursor = 0
    const invocations = new ToolInvocationService({
      registry,
      policy,
      persistence: {
        async commitToolInvocationWithEvent(invocation, event) {
          stored.push(structuredClone(invocation))
          return { ...event, cursor: ++cursor }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry,
      policy,
      invocations,
      grants: ['tools.local.web.search@1', 'tools.local.web.open@1']
    })
    const result = await runner.run({
      taskId: 'task-search-open',
      goal: '读取资料',
      model: { connectionId: 'connection-1', modelId: 'model-1' }
    })
    expect(result).toMatchObject({ status: 'completed', output: '已读取来源' })
    expect(turn).toBe(3)
    expect(JSON.stringify(stored)).toContain('正文证据')
    expect(JSON.stringify(stored)).not.toContain('fixture-search-key')
    expect(JSON.stringify(stored)).not.toContain('fixture-reader-key')
  })
})
