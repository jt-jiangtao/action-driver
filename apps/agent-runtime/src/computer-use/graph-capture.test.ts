import { describe, expect, it } from 'vitest'
import type { ModelGateway } from '../ports'
import { LangGraphRunner } from '../agent-graph'
import { MockSkillRegistry } from '../mock-adapters'
import { RuntimeToolRegistry } from '../tool-registry'
import { RuntimeToolPolicy } from '../tool-policy'
import { ToolInvocationService } from '../tool-invocation-service'

describe('Computer Use screenshot graph boundary', () => {
  it('shows a js screenshot to the next model request only, keeping just its handle', async () => {
    const asset = {
      assetId: 'volatile-computer:one',
      sessionId: 'session-1',
      source: 'upload' as const,
      mimeType: 'image/png' as const,
      width: 10,
      height: 5,
      byteLength: 12
    }
    const registry = new RuntimeToolRegistry()
    registry.register(
      {
        id: 'computer.js',
        version: 1,
        modelName: 'js',
        description: 'Run JavaScript',
        inputSchema: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code'],
          additionalProperties: false
        },
        risk: 'high',
        sideEffects: { filesystem: 'none', network: false },
        timeoutMs: 10_000
      },
      {
        async *execute() {
          yield { kind: 'asset', index: 0, asset }
          yield { kind: 'result', output: { output: 'captured' } }
        }
      }
    )
    const policy = new RuntimeToolPolicy()
    const persisted: unknown[] = []
    const invocations = new ToolInvocationService({
      registry,
      policy,
      persistence: {
        async commitToolInvocationWithEvent(invocation, event) {
          persisted.push({ invocation, event })
          return { ...event, cursor: persisted.length }
        }
      },
      clock: { now: () => new Date().toISOString() }
    })
    const hasScreenshot = (messages: Parameters<ModelGateway['complete']>[0]['messages']) =>
      messages.some(
        (message) =>
          message.role === 'user' &&
          Array.isArray(message.content) &&
          message.content.some(
            (part) => part.kind === 'image' && part.asset.assetId === 'volatile-computer:one'
          )
      )
    let round = 0
    const seen: boolean[] = []
    const model: ModelGateway = {
      async complete(request) {
        round += 1
        seen.push(hasScreenshot(request.messages))
        if (round === 2)
          expect(request.messages.at(-1)).toMatchObject({
            role: 'user',
            content: [{ kind: 'text' }, { kind: 'image', asset }]
          })
        if (round < 3)
          return {
            kind: 'tool-calls',
            calls: [
              {
                providerCallId: `js-${round}`,
                modelName: 'js',
                arguments: { code: round === 1 ? 'await app.getScreenshot()' : '1' }
              }
            ]
          }
        return { kind: 'finish', content: 'done' }
      }
    }
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry,
      policy,
      invocations,
      grants: ['computer.js@1']
    })
    const result = await runner.run({
      taskId: 'capture-test',
      sessionId: 'session-1',
      goal: 'See desktop',
      model: { connectionId: 'one', modelId: 'two' }
    })
    expect(result.status, JSON.stringify(result)).toBe('completed')
    // Round 2 sees the screenshot; round 3 (after another js call) sees only the new results.
    expect(seen.slice(0, 2)).toEqual([false, true])
    expect(JSON.stringify(persisted)).toContain('volatile-computer:one')
    expect(JSON.stringify(persisted)).not.toContain('base64')
  })
})
