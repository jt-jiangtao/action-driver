import { describe, expect, it, vi } from 'vitest'
import { createComputerUseTools } from './tools'

describe('Computer Use tools', () => {
  it('exposes typed observe and act calls through the Tool executor contract', async () => {
    const invoke = vi.fn(async (input: unknown) => ({ echoed: input }))
    const tools = createComputerUseTools(invoke)
    expect(tools.map((tool) => tool.definition.modelName)).toEqual([
      'computer_permissions', 'computer_observe', 'computer_capture', 'computer_act'
    ])
    const observe = tools[1]!
    const events = []
    for await (const event of observe.executor.execute({
      callId: 'call-1', providerCallId: 'provider-1', modelName: 'computer_observe',
      arguments: { maxElements: 50, maxDepth: 5 }
    })) events.push(event)
    expect(invoke).toHaveBeenCalledWith({ operation: 'observe', maxElements: 50, maxDepth: 5 }, undefined)
    expect(events).toEqual([{ kind: 'result', output: { echoed: { operation: 'observe', maxElements: 50, maxDepth: 5 } } }])
  })

  it('rejects malformed actions before invoking the provider', async () => {
    const invoke = vi.fn(async () => ({}))
    const act = createComputerUseTools(invoke)[3]!
    const stream = act.executor.execute({
      callId: 'call-2', providerCallId: 'provider-2', modelName: 'computer_act',
      arguments: { observationId: 'obs', action: { type: 'click', x: 'bad', y: 2 } }
    })
    await expect((async () => { for await (const _event of stream) { /* drain */ } })())
      .rejects.toThrow('TOOL_INPUT_INVALID')
    expect(invoke).not.toHaveBeenCalled()
  })
})
