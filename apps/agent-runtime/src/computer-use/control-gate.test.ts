import { describe, expect, it } from 'vitest'
import { ComputerUseControlGate } from './control-gate'

describe('Computer Use control gate', () => {
  it('blocks actions during pause and takeover until explicit resume', () => {
    const gate = new ComputerUseControlGate()
    expect(() => gate.assertRunning('task-1')).not.toThrow()
    gate.set('task-1', 'paused')
    expect(() => gate.assertRunning('task-1')).toThrow('COMPUTER_USE_PAUSED')
    gate.set('task-1', 'taken-over')
    expect(() => gate.assertRunning('task-1')).toThrow('COMPUTER_USE_TAKEN_OVER')
    gate.set('task-1', 'running')
    expect(() => gate.assertRunning('task-1')).not.toThrow()
  })
})
