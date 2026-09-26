import { describe, expect, it, vi } from 'vitest'
import { assertPersistablePayload } from '../persistence-guard'
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

  it('accepts the Codex-parity actions and forwards them to the provider', async () => {
    const invoke = vi.fn(async (input: unknown) => ({ echoed: input }))
    const act = createComputerUseTools(invoke)[3]!
    const cases = [
      { type: 'set-value', elementRef: 'ref-1', value: 'hello' },
      { type: 'paste', text: 'hello', format: 'md' },
      { type: 'select-text', elementRef: 'ref-1', text: 'hello', selectionType: 'cursor-after' },
      { type: 'drag', fromX: 1, fromY: 2, toX: 30, toY: 40 },
      { type: 'secondary-action', elementRef: 'ref-1', action: 'Show Menu' }
    ]
    for (const [index, action] of cases.entries()) {
      const events = []
      for await (const event of act.executor.execute({
        callId: `call-${index}`, providerCallId: `provider-${index}`, modelName: 'computer_act',
        arguments: { observationId: 'obs-1', action }
      })) events.push(event)
      expect(events).toHaveLength(1)
    }
    expect(invoke).toHaveBeenCalledTimes(cases.length)
    expect(invoke).toHaveBeenLastCalledWith({
      operation: 'act', observationId: 'obs-1',
      action: { type: 'secondary-action', elementRef: 'ref-1', action: 'Show Menu' }
    }, undefined)
  })

  it('persists only safe summaries of screen data, element trees, and coordinates', () => {
    const [permissions, observe, capture, act] = createComputerUseTools(vi.fn())
    const tree = {
      ref: 'root', role: 'AXApplication', frame: { x: 0, y: 25, width: 1440, height: 875 },
      children: [{ ref: 'button', role: 'AXButton', title: '提交',
        frame: { x: 10, y: 20, width: 80, height: 24 } }]
    }
    const observed = observe!.executor.redactForPersistence!('output', {
      observationId: 'obs-1', application: { name: 'Finder', pid: 42 }, windowId: 7,
      tree, truncated: false
    })
    expect(observed).toEqual({ observationId: 'obs-1', application: { name: 'Finder' },
      elementCount: 2, truncated: false })

    const captured = capture!.executor.redactForPersistence!('output', {
      observationId: 'obs-1', pid: 42, windowId: 7, displayId: 1,
      displayFrame: { x: 0, y: 0, width: 1440, height: 900 },
      mimeType: 'image/jpeg', width: 1440, height: 900,
      screenshot: { assetId: 'volatile-computer:1', mimeType: 'image/jpeg' }
    })
    expect(captured).toEqual({ observationId: 'obs-1', mimeType: 'image/jpeg', width: 1440,
      height: 900, screenshot: { assetId: 'volatile-computer:1', mimeType: 'image/jpeg' } })

    const clicked = act!.executor.redactForPersistence!('input', {
      observationId: 'obs-1', action: { type: 'click', x: 120, y: 80 }
    })
    expect(clicked).toEqual({ observationId: 'obs-1', action: { type: 'click' } })
    const typed = act!.executor.redactForPersistence!('input', {
      observationId: 'obs-1', action: { type: 'type', text: 'secret' }
    })
    expect(typed).toEqual({ observationId: 'obs-1', action: { type: 'type', textLength: 6 } })
    const acted = act!.executor.redactForPersistence!('output', {
      executed: true, application: 'Finder', pid: 42
    })
    expect(acted).toEqual({ executed: true, application: 'Finder' })

    for (const value of [observed, captured, clicked, typed, acted,
      permissions!.executor.redactForPersistence!('output', { accessibility: true })]) {
      expect(() => assertPersistablePayload(value)).not.toThrow()
    }
    expect(JSON.stringify([observed, captured, clicked, typed])).not.toContain('提交')
  })
})
