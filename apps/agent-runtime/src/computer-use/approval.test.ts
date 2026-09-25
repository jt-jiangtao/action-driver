import { describe, expect, it, vi } from 'vitest'
import type { ModelGateway } from '../ports'
import { LangGraphRunner } from '../agent-graph'
import { MockSkillRegistry } from '../mock-adapters'
import { RuntimeToolRegistry } from '../tool-registry'
import { RuntimeToolPolicy } from '../tool-policy'
import { ToolInvocationService } from '../tool-invocation-service'
import { createComputerUseTools } from './tools'

function harness() {
  const invoke = vi.fn(async () => ({ executed: true }))
  const registry = new RuntimeToolRegistry()
  for (const tool of createComputerUseTools(invoke)) registry.register(tool.definition, tool.executor)
  const policy = new RuntimeToolPolicy()
  const invocations = new ToolInvocationService({ registry, policy,
    persistence: { async commitToolInvocationWithEvent(_invocation, event) {
      return { ...event, cursor: 1 }
    } }, clock: { now: () => new Date().toISOString() } })
  let round = 0
  const model: ModelGateway = { async complete(request) {
    if (round++ === 0) return { kind: 'tool-calls', calls: [{
      providerCallId: 'act-1', modelName: 'computer_act',
      arguments: { observationId: 'obs-1', action: { type: 'click', x: 20, y: 30 } }
    }] }
    expect(request.messages.at(-1)?.role).toBe('tool')
    return { kind: 'finish', content: 'done' }
  } }
  return { runner: new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
    registry, policy, invocations, grants: ['computer.act@1']
  }), invoke }
}

describe('Computer Use action approval', () => {
  it('holds a click before provider execution and drops it when denied', async () => {
    const { runner, invoke } = harness()
    const waiting = await runner.run({ taskId: 'approval-denied', goal: 'click',
      model: { connectionId: 'one', modelId: 'two' } })
    expect(waiting).toMatchObject({ status: 'waiting-user', output: {
      reason: 'computer-action-approval', providerCallId: 'act-1',
      action: { type: 'click', x: 20, y: 30 }
    } })
    expect(invoke).not.toHaveBeenCalled()
    const completed = await runner.provideInput('approval-denied', {
      approved: false, providerCallId: 'act-1'
    })
    expect(completed.status).toBe('completed')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('executes only after approval for the matching call ID', async () => {
    const { runner, invoke } = harness()
    await runner.run({ taskId: 'approval-yes', goal: 'click',
      model: { connectionId: 'one', modelId: 'two' } })
    const completed = await runner.provideInput('approval-yes', {
      approved: true, providerCallId: 'act-1'
    })
    expect(completed.status).toBe('completed')
    expect(invoke).toHaveBeenCalledOnce()
  })
})
