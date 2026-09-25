import { describe, expect, it } from 'vitest'
import type { ModelGateway } from '../ports'
import { LangGraphRunner } from '../agent-graph'
import { MockSkillRegistry } from '../mock-adapters'
import { RuntimeToolRegistry } from '../tool-registry'
import { RuntimeToolPolicy } from '../tool-policy'
import { ToolInvocationService } from '../tool-invocation-service'
import { createComputerUseTools } from './tools'

describe('Computer capture graph boundary', () => {
  it('keeps only the short lived image handle in persisted tool results and model history', async () => {
    const asset = { assetId: 'volatile-computer:one', sessionId: 'computer-use',
      source: 'upload' as const, mimeType: 'image/jpeg' as const,
      width: 10, height: 5, byteLength: 12 }
    const registry = new RuntimeToolRegistry()
    for (const tool of createComputerUseTools(async () => ({ screenshot: asset, observationId: 'obs-1' })))
      registry.register(tool.definition, tool.executor)
    const policy = new RuntimeToolPolicy()
    const persisted: unknown[] = []
    const invocations = new ToolInvocationService({ registry, policy,
      persistence: { async commitToolInvocationWithEvent(invocation, event) {
        persisted.push({ invocation, event })
        return { ...event, cursor: persisted.length }
      } }, clock: { now: () => new Date().toISOString() } })
    let round = 0
    const model: ModelGateway = { async complete(request) {
      if (round++ === 0) return { kind: 'tool-calls', calls: [{
        providerCallId: 'capture-call', modelName: 'computer_capture',
        arguments: { maxWidth: 10, maxHeight: 5 }
      }] }
      if (round === 2) expect(request.messages.at(-1)).toMatchObject({ role: 'user', content: [
        { kind: 'text' }, { kind: 'image', asset }
      ] })
      expect(JSON.stringify(request.messages)).not.toContain('base64')
      if (round === 2) return { kind: 'tool-calls', calls: [{
        providerCallId: 'permissions-call', modelName: 'computer_permissions', arguments: {}
      }] }
      expect(request.messages.some((message) => message.role === 'user' &&
        Array.isArray(message.content) && message.content.some((part) => part.kind === 'image' &&
          part.asset.assetId === 'volatile-computer:one'))).toBe(false)
      return { kind: 'finish', content: 'done' }
    } }
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry, policy, invocations, grants: ['computer.capture@1', 'computer.permissions@1']
    })
    const result = await runner.run({ taskId: 'capture-test', goal: 'See desktop',
      model: { connectionId: 'one', modelId: 'two' } })
    expect(result.status, JSON.stringify(result)).toBe('completed')
    expect(JSON.stringify(persisted)).toContain('volatile-computer:one')
    expect(JSON.stringify(persisted)).not.toContain('base64')
  })
})
