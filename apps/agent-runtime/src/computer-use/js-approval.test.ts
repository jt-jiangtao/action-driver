import { describe, expect, it, vi } from 'vitest'
import { parseToolDefinition } from '@actiondriver/runtime-contracts'
import type { ModelGateway, RuntimeMessage } from '../ports'
import { LangGraphRunner } from '../agent-graph'
import { MockSkillRegistry } from '../mock-adapters'
import { RuntimeToolRegistry } from '../tool-registry'
import { RuntimeToolPolicy } from '../tool-policy'
import { ToolInvocationService } from '../tool-invocation-service'
import { ToolApprovalRequired } from './tool-approval'

const clickAction = { index: 0, method: 'click', args: { app: 'TextEdit', element_index: 2 } }
const typeAction = { index: 1, method: 'type_text', args: { app: 'TextEdit', text: 'hi' } }

/**
 * Stands in for the real `js` tool: it stops on the actions the test scripted, and records the
 * decisions it was resumed with, so the graph's approval loop can be tested without a sandbox.
 */
function harness(options: {
  actions?: Array<{ index: number; method: string; args: Record<string, unknown> }>
  code?: string
}) {
  const code = options.code ?? 'await sky.click({ app: "TextEdit", element_index: 2 })'
  const actions = options.actions ?? []
  const performed: Array<Record<string, unknown>> = []
  const seen: Array<{ actionIndex: number; approved: boolean }> = []
  const results: RuntimeMessage[] = []
  const registry = new RuntimeToolRegistry()
  registry.register(parseToolDefinition({
    id: 'computer.js', version: 1, modelName: 'js', description: 'js entry',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
    risk: 'high', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1_000
  }), {
    async *execute(_call, _signal, execution) {
      const decisions = execution?.continuation?.decisions ?? []
      if (decisions.length === 0) {
        const first = actions[0]
        if (first) throw new ToolApprovalRequired(first)
        yield { kind: 'result', output: { output: 'observed' } }
        return
      }
      // The list is replayed in full, so only the newest decision is new work for this call.
      const decision = decisions[decisions.length - 1]!
      seen.push(decision)
      const action = actions[decision.actionIndex]
      if (decision.approved && action) performed.push(action.args)
      const next = actions[decision.actionIndex + 1]
      if (next && !decisions.some((entry) => entry.actionIndex === next.index)) {
        throw new ToolApprovalRequired(next)
      }
      yield { kind: 'result', output: { output: decision.approved ? 'acted' : 'skipped' } }
    }
  })
  const policy = new RuntimeToolPolicy()
  const invocations = new ToolInvocationService({
    registry, policy,
    persistence: { async commitToolInvocationWithEvent(_invocation, event) {
      return { ...event, cursor: 1 }
    } },
    clock: { now: () => new Date().toISOString() },
    // The continuation rides on the execution context, exactly as it does in the runtime.
    executionContext: async (taskId) => ({
      taskId, sessionId: 'session-1',
      workspace: { root: '/tmp/session-1', input: '/tmp/session-1/input',
        output: '/tmp/session-1/output' }
    })
  })
  let round = 0
  const model: ModelGateway = { async complete(request) {
    if (round++ === 0) {
      return { kind: 'tool-calls', calls: [{ providerCallId: 'js-1', modelName: 'js',
        arguments: { code } }] }
    }
    results.push(request.messages.at(-1)!)
    return { kind: 'finish', content: 'done' }
  } }
  const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
    registry, policy, invocations, grants: ['computer.js@1']
  })
  return { runner, performed, decisions: seen, results }
}

describe('per-action confirmation inside a JavaScript cell', () => {
  it('asks for the first action, then runs the cell once the user approves it', async () => {
    const { runner, performed, decisions } = harness({ actions: [clickAction] })
    const waiting = await runner.run({ taskId: 'js-one', goal: 'click',
      model: { connectionId: 'one', modelId: 'two' } })
    expect(waiting).toMatchObject({ status: 'waiting-user', output: {
      reason: 'computer-action-approval', providerCallId: 'js-1', jsAction: clickAction
    } })
    expect(performed).toEqual([])
    const completed = await runner.provideInput('js-one', {
      approved: true, providerCallId: 'js-1'
    })
    expect(completed.status).toBe('completed')
    expect(decisions).toEqual([{ actionIndex: 0, approved: true }])
    expect(performed).toEqual([clickAction.args])
  })

  it('delivers a denial to the cell and still finishes the call', async () => {
    const { runner, decisions, performed } = harness({ actions: [clickAction] })
    await runner.run({ taskId: 'js-deny', goal: 'click',
      model: { connectionId: 'one', modelId: 'two' } })
    const completed = await runner.provideInput('js-deny', { approved: false, providerCallId: 'js-1' })
    expect(completed.status).toBe('completed')
    expect(decisions).toEqual([{ actionIndex: 0, approved: false }])
    expect(performed).toEqual([])
  })

  it('refuses a cell that asks for a second action, instead of confirming it blindly', async () => {
    const { runner, performed, results } = harness({ actions: [clickAction, typeAction] })
    await runner.run({ taskId: 'js-two', goal: 'click then type',
      model: { connectionId: 'one', modelId: 'two' } })
    const completed = await runner.provideInput('js-two', { approved: true, providerCallId: 'js-1' })
    expect(completed.status).toBe('completed')
    // The first action ran once; the second one was refused with an instruction to split the call.
    expect(performed).toEqual([clickAction.args])
    expect(completed.status).toBe('completed')
    expect(JSON.stringify(results.at(-1))).toContain('COMPUTER_ACTION_SPLIT_REQUIRED')
  })

  it('runs an observation-only cell without asking', async () => {
    const { runner } = harness({ code: 'nodeRepl.write("reading")' })
    const completed = await runner.run({ taskId: 'js-read', goal: 'read the window',
      model: { connectionId: 'one', modelId: 'two' } })
    expect(completed.status).toBe('completed')
  })

  it('rejects an acting cell that shares its round with another tool', async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(parseToolDefinition({
      id: 'computer.js', version: 1, modelName: 'js', description: 'js entry',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      risk: 'high', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1_000
    }), { async *execute() { yield { kind: 'result', output: { output: 'ran' } } } })
    registry.register(parseToolDefinition({
      id: 'computer.observe', version: 1, modelName: 'computer_observe', description: 'observe',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'medium', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1_000
    }), { async *execute() { yield { kind: 'result', output: { observationId: 'obs' } } } })
    const policy = new RuntimeToolPolicy()
    const invocations = new ToolInvocationService({
      registry, policy,
      persistence: { async commitToolInvocationWithEvent(_invocation, event) {
        return { ...event, cursor: 1 }
      } },
      clock: { now: () => new Date().toISOString() }
    })
    const model: ModelGateway = { async complete() {
      return { kind: 'tool-calls', calls: [
        { providerCallId: 'js-batch', modelName: 'js',
          arguments: { code: 'await sky.click({ app: "TextEdit", element_index: 1 })' } },
        { providerCallId: 'obs-batch', modelName: 'computer_observe', arguments: {} }
      ] }
    } }
    const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
      registry, policy, invocations, grants: ['computer.js@1', 'computer.observe@1']
    })
    await expect(runner.run({ taskId: 'js-batch', goal: 'click',
      model: { connectionId: 'one', modelId: 'two' } }))
      .rejects.toThrow('COMPUTER_ACTION_BATCH_UNSUPPORTED')
  })
})

void vi
