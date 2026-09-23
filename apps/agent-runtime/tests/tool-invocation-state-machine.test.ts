import { describe, expect, it } from 'vitest'
import { ToolInvocationStateMachine } from '../src/tool-invocation-state-machine'

describe('ToolInvocationStateMachine', () => {
  it('accepts the automatic and approval lifecycle paths', () => {
    const automatic = new ToolInvocationStateMachine()
    expect(automatic.transition('queued')).toBe('queued')
    expect(automatic.transition('running')).toBe('running')
    expect(automatic.transition('completed')).toBe('completed')

    const approval = new ToolInvocationStateMachine()
    expect(approval.transition('waiting_approval')).toBe('waiting_approval')
    expect(approval.transition('queued')).toBe('queued')
    expect(approval.transition('cancelled')).toBe('cancelled')
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
