import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { TaskProjection } from '@actiondriver/contracts'
import { taskUsesComputerUse, useComputerUseGuidance } from './computer-use-guidance'

afterEach(() => { vi.unstubAllGlobals() })

function taskWith(id: string, toolId: string | null): TaskProjection {
  return {
    id,
    sessionId: `${id}-session`,
    title: '桌面任务',
    status: 'running',
    model: { connectionId: 'one', modelId: 'two' },
    messages: [],
    steps: [],
    browser: null,
    ...(toolId ? { tools: [{ callId: `${id}-call`, toolId, modelName: toolId.replace('.', '_'),
      summary: '桌面操作', argumentsHash: 'hash', status: 'running' as const }] } : {})
  }
}

describe('Computer Use guidance trigger', () => {
  it('only counts tasks that actually invoke Computer Use', () => {
    expect(taskUsesComputerUse(taskWith('t1', 'computer.observe'))).toBe(true)
    expect(taskUsesComputerUse(taskWith('t2', 'web.open'))).toBe(false)
    expect(taskUsesComputerUse(null)).toBe(false)
  })

  it('asks Main for the guidance once per task when Computer Use starts', async () => {
    const ensureGuidance = vi.fn(async () => true)
    vi.stubGlobal('actionDriverDesktop', { computerUse: { ensureGuidance } })
    const task = taskWith('task-1', 'computer.observe')
    const view = renderHook(({ value }) => useComputerUseGuidance(value.id, taskUsesComputerUse(value)), {
      initialProps: { value: task }
    })
    await waitFor(() => expect(ensureGuidance).toHaveBeenCalledOnce())

    view.rerender({ value: { ...task } })
    await Promise.resolve()
    expect(ensureGuidance).toHaveBeenCalledOnce()
  })

  it('stays quiet for tasks that never use Computer Use', async () => {
    const ensureGuidance = vi.fn(async () => true)
    vi.stubGlobal('actionDriverDesktop', { computerUse: { ensureGuidance } })
    renderHook(() => useComputerUseGuidance('task-2', false))
    await Promise.resolve()
    expect(ensureGuidance).not.toHaveBeenCalled()
  })
})
