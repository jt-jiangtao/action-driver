import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConversationMessages, TaskHeader } from './Conversation'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'
import { mockTaskFixture } from '../services/mock-task-fixture'
import agentStyles from '../styles/agent.css?raw'

describe('conversation components', () => {
  it('shows one complete uploaded image without an empty text fragment', async () => {
    const previousCreate = URL.createObjectURL
    const previousRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:wide-image')
    URL.revokeObjectURL = vi.fn()
    const asset = {
      assetId: 'asset-wide',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1600,
      height: 600,
      byteLength: 32,
      source: 'upload' as const
    }
    let view: ReturnType<typeof render> | undefined
    try {
      view = render(
        <UserMessage
          message={{
            id: 'u',
            role: 'user',
            content: '',
            parts: [
              { kind: 'text', text: '' },
              { kind: 'image', asset }
            ]
          }}
          readImage={async () => new Blob(['png'], { type: 'image/png' })}
        />
      )
      const image = await screen.findByRole('img', { name: '上传的图片' })
      expect(image).toHaveAttribute('src', 'blob:wide-image')
      expect(view.container.querySelectorAll('.conversation-image-item')).toHaveLength(1)
      expect(
        view.container.querySelector(
          '.user-message-with-images > span:not(.conversation-image-item)'
        )
      ).toBeNull()
      expect(agentStyles).toMatch(/\.conversation-image-open img\s*\{[^}]*object-fit:\s*contain/s)
      expect(agentStyles).toMatch(/\.conversation-image-open\s*\{[^}]*border:\s*1px/s)
      view.unmount()
      view = undefined
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wide-image')
    } finally {
      view?.unmount()
      URL.createObjectURL = previousCreate
      URL.revokeObjectURL = previousRevoke
    }
  })
  it('loads a generated image, opens it with the keyboard, and offers download', async () => {
    const previousCreate = URL.createObjectURL
    const previousRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:conversation-image')
    URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup()
    const asset = {
      assetId: 'asset-1',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'generated' as const
    }
    const readImage = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
    try {
      const view = render(
        <AgentResponse
          message={{ id: 'a', role: 'agent', content: '', parts: [{ kind: 'image', asset }] }}
          readImage={readImage}
        />
      )
      expect(await screen.findByRole('img', { name: '生成的图片' })).toBeVisible()
      expect(readImage).toHaveBeenCalledWith('session-1', 'asset-1')
      expect(screen.getByRole('link', { name: '保存图片' })).toHaveAttribute(
        'download',
        'asset-1.png'
      )
      await user.click(screen.getByRole('button', { name: '放大图片' }))
      expect(screen.getByRole('dialog', { name: '图片预览' })).toBeVisible()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      view.unmount()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:conversation-image')
    } finally {
      URL.createObjectURL = previousCreate
      URL.revokeObjectURL = previousRevoke
    }
  })

  it('shows a placeholder if an old image file is missing', async () => {
    const asset = {
      assetId: 'asset-missing',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'upload' as const
    }
    render(
      <UserMessage
        message={{ id: 'u', role: 'user', content: '', parts: [{ kind: 'image', asset }] }}
        readImage={async () => {
          throw new Error('missing')
        }}
      />
    )
    expect(await screen.findByText('图片无法读取')).toBeVisible()
  })
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
