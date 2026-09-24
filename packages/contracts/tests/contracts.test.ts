import { describe, expect, it } from 'vitest'
import {
  SKILL_IDS,
  isSerializableContract,
  type BrowserSkillInvocation,
  type ComputerUseSkillInvocation,
  type BrowserSkillProjection,
  type AgentGoalRequest,
  type RecentTaskProjection,
  type SkillExecutionEvent,
  type TaskProjection
} from '../src/index'

describe('agent skill contracts', () => {
  it('keeps Browser Use and Computer Use as separate skills', () => {
    expect(SKILL_IDS.browser).not.toBe(SKILL_IDS.computer)
    expect(SKILL_IDS).toEqual({ browser: 'browser-use', computer: 'computer-use' })
  })

  it('uses discriminated inputs for Browser and Computer capability invocations', () => {
    const browserInvocation: BrowserSkillInvocation = {
      id: 'browser-invocation',
      taskId: 'task-1',
      skillId: SKILL_IDS.browser,
      input: { action: 'click', nodeHandle: 'date-picker' }
    }
    const computerInvocation: ComputerUseSkillInvocation = {
      id: 'computer-invocation',
      taskId: 'task-1',
      skillId: SKILL_IDS.computer,
      input: { action: 'activate-app', bundleId: 'com.apple.Safari' }
    }

    expect(browserInvocation.skillId).toBe('browser-use')
    expect(computerInvocation.skillId).toBe('computer-use')
    expect(isSerializableContract(browserInvocation)).toBe(true)
    expect(isSerializableContract(computerInvocation)).toBe(true)
  })

  it('accepts serializable task, skill event, and browser projection data', () => {
    const event: SkillExecutionEvent = {
      id: 'event-1',
      invocationId: 'invocation-1',
      skillId: SKILL_IDS.browser,
      state: 'running',
      occurredAt: '2026-09-20T12:00:00.000Z'
    }
    const browser: BrowserSkillProjection = {
      title: '杭州酒店 · 携程旅行',
      url: 'https://hotels.ctrip.com/hotels/list',
      status: 'running',
      target: { label: '选择入住日期', x: 146, y: 150, width: 220, height: 52 }
    }
    const task: TaskProjection = {
      id: 'task-1',
      sessionId: 'session-1',
      title: '预订周末去杭州的酒店',
      status: 'running',
      model: { connectionId: 'connection-a', modelId: 'shared-model' },
      messages: [],
      steps: [],
      browser
    }

    expect(isSerializableContract(event)).toBe(true)
    expect(isSerializableContract(task)).toBe(true)
    expect(isSerializableContract({ ...event, invalid: () => undefined })).toBe(false)
  })

  it('identifies an Agent model by both connection and model id', () => {
    const request: AgentGoalRequest = {
      goal: '总结本周进展',
      model: { connectionId: 'connection-a', modelId: 'shared-model' }
    }

    expect(request.model).toEqual({ connectionId: 'connection-a', modelId: 'shared-model' })
    expect(isSerializableContract(request)).toBe(true)

    const continuation: AgentGoalRequest = {
      goal: '继续解释',
      sessionId: 'session-1'
    }
    expect(continuation).toEqual({ goal: '继续解释', sessionId: 'session-1' })
    expect(isSerializableContract(continuation)).toBe(true)
  })

  it('keeps recent task data serializable', () => {
    const recent: RecentTaskProjection = {
      id: 'task-1',
      sessionId: 'thread-1',
      title: '总结本周进展',
      status: 'succeeded',
      model: { connectionId: 'connection-a', modelId: 'shared-model' },
      createdAt: '2026-09-23T01:00:00.000Z',
      updatedAt: '2026-09-23T01:00:01.000Z'
    }
    expect(recent).toMatchObject({ id: 'task-1', sessionId: 'thread-1' })
    expect(isSerializableContract(recent)).toBe(true)
  })
})
