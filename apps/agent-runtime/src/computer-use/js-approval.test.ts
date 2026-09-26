import { describe, expect, it, vi } from 'vitest'
import { parseToolDefinition } from '@actiondriver/runtime-contracts'
import type { ModelGateway, RuntimeMessage } from '../ports'
import { LangGraphRunner } from '../agent-graph'
import { MockSkillRegistry } from '../mock-adapters'
import { RuntimeToolRegistry } from '../tool-registry'
import { RuntimeToolPolicy } from '../tool-policy'
import { ToolInvocationService } from '../tool-invocation-service'

/**
 * A stand-in for the real `js` tool: the graph decides whether a cell needs confirmation, so the
 * approval path can be tested without spawning the sandboxed child.
 */
function harness(code: string, title?: string) {
  const executed: Array<Record<string, unknown>> = []
  const results: RuntimeMessage[] = []
  const registry = new RuntimeToolRegistry()
  registry.register(parseToolDefinition({
    id: 'computer.js', version: 1, modelName: 'js', description: 'js entry',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
    risk: 'high', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1_000
  }), {
    async *execute(call) {
      executed.push(call.arguments as Record<string, unknown>)
      yield { kind: 'result', output: { output: 'ran' } }
    }
  })
  const policy = new RuntimeToolPolicy()
  const invocations = new ToolInvocationService({
    registry, policy,
    persistence: { async commitToolInvocationWithEvent(_invocation, event) {
      return { ...event, cursor: 1 }
    } },
    clock: { now: () => new Date().toISOString() }
  })
  let round = 0
  const model: ModelGateway = { async complete(request) {
    if (round++ === 0) {
      return { kind: 'tool-calls', calls: [{
        providerCallId: 'js-1', modelName: 'js',
        arguments: { code, ...(title === undefined ? {} : { title }) }
      }] }
    }
    results.push(request.messages.at(-1)!)
    return { kind: 'finish', content: 'done' }
  } }
  const runner = new LangGraphRunner(model, new MockSkillRegistry(), undefined, {
    registry, policy, invocations, grants: ['computer.js@1']
  })
  return { runner, executed, results }
}

const actingCode = 'await sky.click({ app: "TextEdit", element_index: 2 })'
const readingCode = 'const state = await sky.get_app_state({ app: "TextEdit" });\n' +
  'nodeRepl.write(state.text)'

describe('JavaScript cell approval', () => {
  it('asks before running a cell that can change the desktop', async () => {
    const { runner, executed } = harness(actingCode, '点击保存按钮')
    const waiting = await runner.run({ taskId: 'js-approval', goal: 'click save',
      model: { connectionId: 'one', modelId: 'two' } })
    expect(waiting).toMatchObject({ status: 'waiting-user', output: {
      reason: 'computer-action-approval', providerCallId: 'js-1',
      cell: { title: '点击保存按钮', code: actingCode, codeLength: actingCode.length,
        actions: ['click'] }
    } })
    expect(executed).toHaveLength(0)
  })

  it('runs the cell once after approval', async () => {
    const { runner, executed } = harness(actingCode)
    await runner.run({ taskId: 'js-approved', goal: 'click save',
      model: { connectionId: 'one', modelId: 'two' } })
    const completed = await runner.provideInput('js-approved', {
      approved: true, providerCallId: 'js-1'
    })
    expect(completed.status).toBe('completed')
    expect(executed).toHaveLength(1)
  })

  it('drops the cell and tells the model when the user declines', async () => {
    const { runner, executed, results } = harness(actingCode)
    await runner.run({ taskId: 'js-denied', goal: 'click save',
      model: { connectionId: 'one', modelId: 'two' } })
    const completed = await runner.provideInput('js-denied', {
      approved: false, providerCallId: 'js-1'
    })
    expect(completed.status).toBe('completed')
    expect(executed).toHaveLength(0)
    expect(JSON.stringify(results.at(-1))).toContain('USER_DENIED')
  })

  it('runs an observation-only cell without asking', async () => {
    const { runner, executed } = harness(readingCode)
    const completed = await runner.run({ taskId: 'js-read', goal: 'read the window',
      model: { connectionId: 'one', modelId: 'two' } })
    expect(completed.status).toBe('completed')
    expect(executed).toHaveLength(1)
  })

  it('fails the batch when a confirmed cell shares a round with another tool', async () => {
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
        { providerCallId: 'js-batch', modelName: 'js', arguments: { code: actingCode } },
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
