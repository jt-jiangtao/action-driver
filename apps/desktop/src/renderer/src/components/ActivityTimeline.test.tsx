import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TaskProjection } from '@actiondriver/contracts'
import { ActivityTimeline } from './ActivityTimeline'

const task = (status: TaskProjection['status']): TaskProjection => ({
  id: 'task-1',
  sessionId: 'session-1',
  title: '任务',
  status,
  model: { connectionId: 'connection-1', modelId: 'model-1' },
  messages: [],
  steps: [],
  browser: null,
  activityDurationMs: 2_800,
  activityTimeline: [{ id: 'activity:research', kind: 'activity', activityId: 'research' }],
  activities: [
    {
      activityId: 'research',
      title: '调研实现',
      titleRevision: 1,
      status: status === 'running' ? 'running' : 'completed',
      items: [{ id: 'tool:read', kind: 'tool', callId: 'read' }]
    }
  ],
  tools: [
    {
      callId: 'read',
      toolId: 'sandbox.fs.read',
      modelName: 'sandbox_fs_read',
      summary: '读取 README',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed',
      rawInput: '{"path":"README.md"}',
      rawOutput: '内容',
      rawOutputTruncated: false
    }
  ]
})

describe('ActivityTimeline', () => {
  it('shows raw I/O in an expandable item and a thinking tail while running', () => {
    render(<ActivityTimeline task={task('running')} />)
    expect(screen.getByText('正在思考')).toBeVisible()
    screen.getByText('输入与输出').click()
    expect(screen.getByText('{"path":"README.md"}')).toBeVisible()
    expect(screen.getByText('内容')).toBeVisible()
  })

  it('archives completed process closed under an elapsed-time summary', () => {
    render(<ActivityTimeline task={task('succeeded')} />)
    const archive = screen.getByText('用时 2.8 秒').closest('details')
    expect(archive).not.toHaveAttribute('open')
    expect(screen.queryByText('正在思考')).toBeNull()
  })
})
