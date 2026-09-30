import { describe, expect, it } from 'vitest'
import { mergeSubmittedTask } from '../../../../../src/renderer/src/models/recent-task-submission'

describe('mergeSubmittedTask', () => {
  const existing = [
    { id: 'old', sessionId: 'session-1', title: '保留的标题', state: 'default' as const, pinned: true },
    { id: 'other', sessionId: 'session-2', title: '其他', state: 'default' as const, pinned: false }
  ]

  it('keeps the pin and one sidebar row when continuing a visible session', () => {
    expect(mergeSubmittedTask(existing, {
      id: 'new', sessionId: 'session-1', title: '新任务标题', status: 'running'
    }, 'old')).toEqual([
      { ...existing[0], id: 'new', state: 'loading' },
      existing[1]
    ])
  })

  it('does not bring an archived session back into the active list on continuation', () => {
    expect(mergeSubmittedTask(existing, {
      id: 'archived-new', sessionId: 'archived-session', title: '已归档', status: 'running'
    }, 'archived-old')).toEqual(existing)
  })
})
