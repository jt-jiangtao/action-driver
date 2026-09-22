import { describe, expect, it } from 'vitest'
import { mockModelLogSessions } from './model-logs'

describe('mockModelLogSessions', () => {
  it('keeps deterministic session, task and dynamic call relationships', () => {
    const office = mockModelLogSessions.find((session) => session.id === 'office-assistant')
    const weather = office?.tasks.find((task) => task.id === 'weather-report')

    expect(office?.tasks.map((task) => task.name)).toEqual(['天气报告', '会议纪要', '竞品分析'])
    expect(weather?.calls.map((call) => call.id)).toEqual([
      'prepare',
      'system-prompt',
      'context',
      'model-first',
      'browser-open',
      'browser-return',
      'model-second',
      'output',
      'complete'
    ])
  })

  it('covers completed, running and failed states', () => {
    expect(new Set(mockModelLogSessions.map((session) => session.status))).toEqual(
      new Set(['completed', 'running', 'failed'])
    )
  })
})
