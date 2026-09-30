import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExecutionTimeline } from '../../../../../src/renderer/src/components/ExecutionTimeline'
import { mockTaskFixture } from '../../../../../src/renderer/src/services/task-catalog/mock-task-fixture'

describe('ExecutionTimeline', () => {
  it('renders the four vertical steps and progress from the task projection', () => {
    render(<ExecutionTimeline steps={mockTaskFixture.steps} />)

    expect(screen.getByText('执行进度')).toBeVisible()
    expect(screen.getByText('3 / 4')).toBeVisible()
    expect(screen.getByText('观察页面')).toBeVisible()
    expect(screen.getByText('填写入住日期')).toBeVisible()
    expect(screen.getByText('等待用户确认')).toBeVisible()
  })
})
