import { describe, expect, it } from 'vitest'
import { ToolInvocationStateMachine } from '../src/tool-invocation-state-machine'

describe('ToolInvocationStateMachine', () => {
  it('accepts only the automatic lifecycle path for new calls', () => {
    const automatic = new ToolInvocationStateMachine()
    expect(automatic.transition('queued')).toBe('queued')
    expect(automatic.transition('running')).toBe('running')
    expect(automatic.transition('completed')).toBe('completed')

    const newCall = new ToolInvocationStateMachine()
    expect(() => newCall.transition('waiting_approval')).toThrow('INVALID_TOOL_TRANSITION')
  })

  it('rejects skipped and terminal transitions', () => {
    const machine = new ToolInvocationStateMachine()
    expect(() => machine.transition('completed')).toThrow(
      'INVALID_TOOL_TRANSITION: proposed -> completed'
    )
    machine.transition('queued')
    machine.transition('running')
    machine.transition('failed')
    expect(() => machine.transition('running')).toThrow(
      'INVALID_TOOL_TRANSITION: failed -> running'
    )
  })
})
