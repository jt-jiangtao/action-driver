import { describe, expect, it, vi } from 'vitest'
import { SKILL_IDS } from '@actiondriver/contracts'
import { MockAgentRuntime } from './mock-agent-runtime'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from './mock-skill-capabilities'

const createRuntime = () => {
  const gateway = new MockSkillGateway({
    [SKILL_IDS.browser]: new MockBrowserSkillCapability(),
    [SKILL_IDS.computer]: new MockComputerUseSkillCapability()
  })
  return { runtime: new MockAgentRuntime(gateway), gateway }
}

describe('MockAgentRuntime', () => {
  it('creates the deterministic hotel task from a submitted goal', async () => {
    const { runtime } = createRuntime()
    const task = await runtime.submitGoal('帮我预订杭州酒店')

    expect(task.id).toBe('hotel-task')
    expect(task.messages[0]?.content).toBe('帮我预订杭州酒店')
    expect(task.steps).toHaveLength(4)
    expect(task.browser?.status).toBe('running')
  })

  it('projects pause, takeover, resume and interrupt to subscribers', async () => {
    const { runtime, gateway } = createRuntime()
    const listener = vi.fn()
    runtime.subscribe(listener)
    await gateway.pause('browser-invocation')
    await gateway.takeOver('browser-invocation')
    await gateway.resume('browser-invocation')
    await runtime.interrupt('hotel-task')

    expect(listener).toHaveBeenCalledTimes(5)
    expect(runtime.getTask('hotel-task')?.status).toBe('failed')
    expect(runtime.getTask('hotel-task')?.browser?.status).toBe('failed')
    expect(runtime.getTask('hotel-task')?.steps[2]).toMatchObject({
      state: 'failed',
      detail: '任务已中断'
    })
  })
})
