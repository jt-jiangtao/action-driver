import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationMessages, TaskHeader } from './Conversation'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'
import { mockTaskFixture } from '../services/mock-task-fixture'
import agentStyles from '../styles/agent.css?raw'

describe('conversation components', () => {
  it('renders the task title without extra time, skill, or more controls', () => {
    render(<TaskHeader title={mockTaskFixture.title} browserCollapsed onExpandBrowser={vi.fn()} />)

    expect(screen.getByText(mockTaskFixture.title)).toBeVisible()
    expect(screen.getByLabelText('展开浏览器')).toBeVisible()
    expect(screen.queryByText('Skill')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('更多')).not.toBeInTheDocument()
  })

  it('renders user and agent copy without an ActionDriver speaker label', () => {
    render(<ConversationMessages messages={mockTaskFixture.messages} />)

    expect(screen.getByText(mockTaskFixture.messages[0]!.content)).toBeVisible()
    expect(screen.getByText(mockTaskFixture.messages[1]!.content)).toBeVisible()
    expect(screen.queryByText('ActionDriver')).not.toBeInTheDocument()
  })

  it('keeps message roles in dedicated presentational components', () => {
    render(
      <>
        <UserMessage message={mockTaskFixture.messages[0]!} />
        <AgentResponse message={mockTaskFixture.messages[1]!} />
      </>
    )

    expect(screen.getByText(mockTaskFixture.messages[0]!.content)).toHaveClass('user-message')
    expect(screen.getByTestId('e2e/tasks/detail/markdown#section')).toHaveClass('agent-message')
  })

  it('lets short user messages hug their content instead of forcing a fixed bubble', () => {
    const style = document.createElement('style')
    style.textContent = agentStyles
    document.head.append(style)

    render(
      <UserMessage
        message={{ id: 'short-user-message', role: 'user', content: '帮我生成一个表格' }}
      />
    )

    const computedStyle = getComputedStyle(screen.getByText('帮我生成一个表格'))
    expect(computedStyle.width).toBe('fit-content')
    expect(computedStyle.maxWidth).toBe('78%')
    expect(computedStyle.minHeight).toBe('0')
    expect(computedStyle.whiteSpace).toBe('pre-wrap')

    style.remove()
  })

  it('renders model Markdown while escaping raw HTML', () => {
    render(
      <AgentResponse
        message={{
          id: 'markdown-response',
          role: 'agent',
          content: '## 结果\n\n- 第一项\n- 第二项\n\n<script>alert(1)</script>'
        }}
      />
    )

    expect(screen.getByRole('heading', { name: '结果' })).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>alert(1)</script>')).toBeVisible()
  })

  it('announces an empty running response until the first stream content arrives', () => {
    const { rerender } = render(
      <AgentResponse message={{ id: 'live', role: 'agent', content: '' }} generating />
    )

    expect(screen.getByRole('status')).toHaveTextContent('正在生成')
    rerender(
      <AgentResponse message={{ id: 'live', role: 'agent', content: '**完成**' }} generating />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('完成')).toBeVisible()
  })
})
