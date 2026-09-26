import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageAssetRef } from '@actiondriver/contracts'
import type { ModelGateway, RuntimeMessage } from '../src/ports'
import { MemorySaver } from '@langchain/langgraph'
import { LangGraphRunner, threadIdForTask } from '../src/agent-graph'
import { MockSkillRegistry } from '../src/mock-adapters'
import { RuntimeSkillRegistry } from '../src/skill-registry'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { RuntimeToolPolicy } from '../src/tool-policy'
import { ToolInvocationService } from '../src/tool-invocation-service'
import { startServiceHttpServer, type ServiceHttpServer } from '../src/service/http-service'
import { SkillProviderHost } from '../../desktop/src/main/skill-provider-host'
import { connectLocalCapabilityHost } from '../../desktop/src/main/local-capability-client'
import { ComputerUseControlGate } from '../src/computer-use/control-gate'
import { createComputerUseTools } from '../src/computer-use/tools'
import { VolatileComputerImages } from '../src/computer-use/volatile-images'
import { assertPersistablePayload } from '../src/persistence-guard'

type NativeCall = { operation: string } & Record<string, unknown>

let server: ServiceHttpServer | undefined
let client: { close(): void } | undefined
afterEach(async () => { client?.close(); await server?.close(); client = undefined; server = undefined })

async function setup(options: { taskId: string; model: ModelGateway }) {
  const images = new VolatileComputerImages()
  const calls: NativeCall[] = []
  const jpeg = Buffer.from('integration jpeg payload')
  const host = new SkillProviderHost()
  host.register({
    skillId: 'computer-use',
    providerId: 'native.computer-use',
    providerVersion: '1.0.0',
    async execute(input) {
      const request = input as NativeCall
      calls.push(request)
      // Shaped like the native helper: element frames and the display frame carry coordinates.
      if (request.operation === 'observe') return {
        observationId: 'obs-1', application: { name: 'Finder', pid: 42 }, windowId: 7,
        tree: { ref: 'root', role: 'AXApplication', frame: { x: 0, y: 25, width: 800, height: 600 },
          children: [{ ref: 'button', role: 'AXButton', title: 'SENSITIVE-TITLE', actions: ['press'],
            frame: { x: 10, y: 20, width: 80, height: 24 } }] },
        truncated: false
      }
      if (request.operation === 'capture') return {
        displayFrame: { x: 0, y: 0, width: 800, height: 600 },
        mimeType: 'image/jpeg', width: 12, height: 8,
        base64: jpeg.toString('base64'), observationId: 'obs-1'
      }
      if (request.operation === 'act') return { observationId: request.observationId, executed: true }
      return { accessibility: true, screenRecording: true, eventPosting: true,
        permissionTarget: 'ActionDriver Computer Use' }
    }
  })
  const registry = new RuntimeSkillRegistry()
  server = await startServiceHttpServer({
    service: {} as never, token: 'local-secret', runtimeVersion: 'test',
    skillRegistry: registry, computerImages: images
  })
  client = await connectLocalCapabilityHost({ baseUrl: server.url, token: 'local-secret', host })
  await vi.waitFor(() => expect(() => registry.resolve('computer-use', 1)).not.toThrow())

  const persisted: unknown[] = []
  const gate = new ComputerUseControlGate()
  const tools = createComputerUseTools(async (input, signal) => {
    const result = await registry.resolve('computer-use', 1).execute(
      { invocationId: randomUUID(), input }, signal)
    return result.input
  }, gate)
  const toolRegistry = new RuntimeToolRegistry()
  for (const tool of tools) toolRegistry.register(tool.definition, tool.executor)
  const policy = new RuntimeToolPolicy()
  const invocations = new ToolInvocationService({
    registry: toolRegistry, policy,
    // Applies the storage guard like the SQLite repositories do.
    persistence: { async commitToolInvocationWithEvent(invocation, event) {
      assertPersistablePayload(invocation.input, 'toolInvocation.input')
      assertPersistablePayload(invocation.output, 'toolInvocation.output')
      assertPersistablePayload(event.payload, 'runtimeEvent.payload')
      persisted.push(structuredClone({ invocation, event }))
      return { ...event, cursor: 1 }
    } },
    clock: { now: () => new Date().toISOString() },
    executionContext: async (taskId) => ({ taskId, sessionId: taskId,
      workspace: { root: '/tmp', input: '/tmp/in', output: '/tmp/out' } })
  })
  const checkpointer = new MemorySaver()
  const runner = new LangGraphRunner(options.model, new MockSkillRegistry(), checkpointer, {
    registry: toolRegistry, policy, invocations,
    grants: tools.map((tool) => `${tool.definition.id}@${tool.definition.version}`)
  })
  const checkpoints = async (taskId: string): Promise<string> => {
    const tuples = []
    for await (const tuple of checkpointer.list({ configurable: { thread_id: threadIdForTask(taskId) } }))
      tuples.push(tuple)
    return JSON.stringify(tuples)
  }
  return { runner, gate, calls, images, jpeg, tools, persisted, checkpoints }
}

describe('Computer Use native integration', () => {
  it('runs observe, capture, and an approved action with only a volatile image handle', async () => {
    const requests: RuntimeMessage[][] = []
    let round = 0
    const model: ModelGateway = { async complete(request) {
      requests.push(request.messages)
      round += 1
      if (round === 1) return { kind: 'tool-calls', calls: [{ providerCallId: 'observe-1',
        modelName: 'computer_observe', arguments: { maxElements: 20, maxDepth: 4 } }] }
      if (round === 2) return { kind: 'tool-calls', calls: [{ providerCallId: 'capture-1',
        modelName: 'computer_capture', arguments: { maxWidth: 64, maxHeight: 64 } }] }
      if (round === 3) return { kind: 'tool-calls', calls: [{ providerCallId: 'act-1',
        modelName: 'computer_act', arguments: { observationId: 'obs-1',
          action: { type: 'click-element', elementRef: 'ref-1' } } }] }
      return { kind: 'finish', content: '已完成' }
    } }
    const { runner, calls, images, jpeg, persisted, checkpoints } =
      await setup({ taskId: 'integration-task', model })

    const waiting = await runner.run({ taskId: 'integration-task', goal: '提交表单',
      model: { connectionId: 'one', modelId: 'two' } })
    expect(waiting).toMatchObject({ status: 'waiting-user', output: {
      reason: 'computer-action-approval', providerCallId: 'act-1' } })
    expect(calls.map((entry) => entry.operation)).toEqual(['observe', 'capture'])

    const imagePart = requests.flat().flatMap((message) =>
      message.role === 'user' && Array.isArray(message.content) ? message.content : [])
      .find((part) => part.kind === 'image')
    expect(imagePart?.kind).toBe('image')
    const asset = (imagePart as { asset: ImageAssetRef }).asset
    expect(asset.assetId).toMatch(/^volatile-computer:/)
    expect(images.read(asset).bytes).toEqual(jpeg)
    expect(JSON.stringify(requests)).not.toContain(jpeg.toString('base64'))

    const completed = await runner.provideInput('integration-task', {
      approved: true, providerCallId: 'act-1'
    })
    expect(completed.status).toBe('completed')
    // The model saw the element tree, but history holds only safe summaries.
    expect(JSON.stringify(requests)).toContain('ref-1')
    const stored = JSON.stringify(persisted)
    // Only the safe summary is persisted: the AX tree text itself never reaches history.
    // AX text from the observed interface never reaches history; the goal text may of course.
    expect(stored).not.toContain('SENSITIVE-TITLE')
    expect(stored).not.toContain('displayFrame')
    expect(stored).not.toContain(jpeg.toString('base64'))
    // LangGraph checkpoints hold the same safe summaries, never the tree or display geometry.
    const graphState = await checkpoints('integration-task')
    expect(graphState).toContain('obs-1')
    expect(graphState).not.toContain('SENSITIVE-TITLE')
    expect(graphState).not.toContain('displayFrame')
    expect(calls.map((entry) => entry.operation)).toEqual(['observe', 'capture', 'act'])
    expect(requests.at(-1)?.some((message) => message.role === 'user' &&
      Array.isArray(message.content) && message.content.some((part) => part.kind === 'image')))
      .toBe(false)
  })

  it('blocks desktop actions during takeover and pause, then allows them after resume', async () => {
    const model: ModelGateway = { async complete() { return { kind: 'finish', content: 'done' } } }
    const { gate, calls, tools } = await setup({ taskId: 'takeover-task', model })
    const act = tools.find((tool) => tool.definition.modelName === 'computer_act')!
    const call = { callId: 'call-1', providerCallId: 'provider-1', modelName: 'computer_act',
      arguments: { observationId: 'obs-1', action: { type: 'click', x: 4, y: 5 } } }
    const context = { taskId: 'takeover-task', sessionId: 'takeover-task',
      workspace: { root: '/tmp', input: '/tmp/in', output: '/tmp/out' } }
    const drain = async () => {
      for await (const _event of act.executor.execute(call, undefined, context)) { /* drain */ }
    }

    gate.set('takeover-task', 'taken-over')
    await expect(drain()).rejects.toThrow('COMPUTER_USE_TAKEN_OVER')
    gate.set('takeover-task', 'paused')
    await expect(drain()).rejects.toThrow('COMPUTER_USE_PAUSED')
    expect(calls).toHaveLength(0)

    gate.set('takeover-task', 'running')
    await drain()
    expect(calls.map((entry) => entry.operation)).toEqual(['act'])
  })
})
