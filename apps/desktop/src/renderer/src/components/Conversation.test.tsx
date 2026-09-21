import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationMessages, TaskHeader } from './Conversation'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'
import { mockTaskFixture } from '../services/mock-task-fixture'

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

    expect(screen.getByTestId('user-message')).toHaveTextContent(mockTaskFixture.messages[0]!.content)
    expect(screen.getByTestId('agent-response')).toHaveTextContent(mockTaskFixture.messages[1]!.content)
  })
})
