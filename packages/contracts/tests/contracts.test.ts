import { describe, expect, it } from 'vitest'
import {
  SKILL_IDS,
  SERVICE_TYPES,
  isSerializableContract,
  type BrowserSkillInvocation,
  type ComputerUseSkillInvocation,
  type BrowserSkillProjection,
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

  it('uses stable dependency injection symbols', () => {
    expect(SERVICE_TYPES.agentCommandService).toBeTypeOf('symbol')
    expect(SERVICE_TYPES.agentSessionRepository).toBeTypeOf('symbol')
    expect(SERVICE_TYPES.skillGateway).toBeTypeOf('symbol')
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
      title: '预订周末去杭州的酒店',
      status: 'running',
      messages: [],
      steps: [],
      browser
    }

    expect(isSerializableContract(event)).toBe(true)
    expect(isSerializableContract(task)).toBe(true)
    expect(isSerializableContract({ ...event, invalid: () => undefined })).toBe(false)
  })
})
