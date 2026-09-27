import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConversationMessages, TaskHeader } from './Conversation'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'
import { mockTaskFixture } from '../services/mock-task-fixture'
import agentStyles from '../styles/agent.css?raw'

/** The image the preview currently shows, or null while it is closed. */
function previewSource(): string | null {
  return document.querySelector('.image-preview img')?.getAttribute('src') ?? null
}

function imageAsset(assetId: string, source: 'generated' | 'upload' = 'generated') {
  return {
    assetId,
    sessionId: 'session-1',
    mimeType: 'image/png' as const,
    width: 1,
    height: 1,
    byteLength: 20,
    source
  }
}

/** Object URLs named after the asset they were read for, so a test can tell images apart. */
function stubObjectUrls() {
  const owners = new Map<Blob, string>()
  const previous = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:${owners.get(blob)}`)
  URL.revokeObjectURL = vi.fn()
  const readImage = vi.fn(async (_sessionId: string, assetId: string) => {
    const blob = new Blob(['png'], { type: 'image/png' })
    owners.set(blob, assetId)
    return blob
  })
  return {
    readImage,
    restore() {
      URL.createObjectURL = previous.create
      URL.revokeObjectURL = previous.revoke
    }
  }
}

function pressArrowRight() {
  act(() => {
    fireEvent.keyDown(window, { key: 'ArrowRight', keyCode: 39, which: 39 })
  })
}

describe('conversation components', () => {
  it('shows an attached document as a card with its format, name and size', () => {
    render(
      <UserMessage
        message={{
          id: 'user-file',
          role: 'user',
          content: '总结附件',
          parts: [
            { kind: 'text', text: '总结附件' },
            {
              kind: 'document',
              file: {
                fileId: 'file-1',
                sessionId: 'session-1',
                taskId: 'task-1',
                name: '季度报告.pdf',
                mimeType: 'application/pdf',
                byteLength: 2048
              }
            }
          ]
        }}
      />
    )

    const card = screen.getByTestId('e2e/tasks/detail/user-message/file#section')
    expect(card).toHaveTextContent('季度报告.pdf')
    expect(screen.getByAltText('PDF')).toHaveAttribute('src', expect.stringContaining('file-pdf'))
    expect(card).toHaveTextContent('2 KiB')
    expect(screen.getByText('总结附件')).toBeVisible()
  })

  it('renders two anchored batches in call order before final text despite completion order', () => {
    const asset = (assetId: string) => ({
      assetId, sessionId: 'session-1', mimeType: 'image/png' as const,
      width: 1, height: 1, byteLength: 20, source: 'generated' as const
    })
    const tools = [
      { callId: 'a', toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate', summary: 'A', argumentsHash: '', status: 'running' as const, imageCount: 2 },
      { callId: 'b', toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate', summary: 'B', argumentsHash: '', status: 'completed' as const, imageCount: 1 }
    ]
    const message = { id: 'a', role: 'agent' as const, content: '完成', parts: [
      { kind: 'image-batch' as const, callId: 'a', imageCount: 2 },
      { kind: 'image-batch' as const, callId: 'b', imageCount: 1 },
      { kind: 'image' as const, asset: asset('b-0'), generation: { callId: 'b', index: 0 } },
      { kind: 'text' as const, text: '完成' }
    ] }
    const view = render(<AgentResponse message={message} tools={tools} readImage={() => new Promise<Blob>(() => {})} />)
    const root = view.container.querySelector('.agent-message')!
    expect([...root.children].map((node) => node.classList.contains('image-gallery') ? 'gallery' : 'text'))
      .toEqual(['gallery', 'gallery', 'text'])
    expect(root.children[0]?.querySelectorAll('.image-gallery-slot')).toHaveLength(2)
    expect(root.children[1]?.querySelectorAll('.image-gallery-slot')).toHaveLength(1)
    expect(root.children[1]?.querySelector('.conversation-image-loading')).toBeInTheDocument()
    expect(root.lastElementChild).toHaveTextContent('完成')
  })
  it('keeps legacy saved image and text order without an anchor', () => {
    const asset = { assetId: 'old', sessionId: 'session-1', mimeType: 'image/png' as const,
      width: 1, height: 1, byteLength: 20, source: 'generated' as const }
    const view = render(<AgentResponse message={{ id: 'a', role: 'agent', content: '旧文字', parts: [
      { kind: 'image', asset }, { kind: 'text', text: '旧文字' }
    ] }} readImage={() => new Promise<Blob>(() => {})} />)
    const root = view.container.querySelector('.agent-message')!
    expect([...root.children].map((node) => node.classList.contains('image-gallery') ? 'gallery' : 'text'))
      .toEqual(['gallery', 'text'])
  })
  it('does not move a later legacy image across intervening text', () => {
    const asset = (assetId: string) => ({ assetId, sessionId: 'session-1', mimeType: 'image/png' as const,
      width: 1, height: 1, byteLength: 20, source: 'generated' as const })
    const view = render(<AgentResponse message={{ id: 'a', role: 'agent', content: '中间', parts: [
      { kind: 'image', asset: asset('first'), generation: { callId: 'old', index: 0 } },
      { kind: 'text', text: '中间' },
      { kind: 'image', asset: asset('second'), generation: { callId: 'old', index: 1 } }
    ] }} readImage={() => new Promise<Blob>(() => {})} />)
    const root = view.container.querySelector('.agent-message')!
    expect([...root.children].map((node) => node.classList.contains('image-gallery') ? 'gallery' : 'text'))
      .toEqual(['gallery', 'text', 'gallery'])
  })
  it('keeps assistant text above stable image slots while individual images complete', () => {
    const asset = {
      assetId: 'generated-2', sessionId: 'session-1', mimeType: 'image/png' as const,
      width: 1, height: 1, byteLength: 20, source: 'generated' as const
    }
    const tools = [{
      callId: 'call-gallery', toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate',
      summary: '生成图片', argumentsHash: '', status: 'running' as const, imageCount: 3
    }]
    const readImage = () => new Promise<Blob>(() => {})
    const view = render(<AgentResponse message={{ id: 'a', role: 'agent', content: '准备好了' }} tools={tools} readImage={readImage} />)
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(3)
    expect(view.container.querySelector('.agent-message')?.firstElementChild).toHaveTextContent('准备好了')
    view.rerender(<AgentResponse message={{ id: 'a', role: 'agent', content: '准备好了', parts: [
      { kind: 'text', text: '准备好了' },
      { kind: 'image-batch', callId: 'call-gallery', imageCount: 3 },
      { kind: 'image', asset, generation: { callId: 'call-gallery', index: 2 } }
    ] }} tools={tools} readImage={readImage} />)
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(3)
    expect(view.container.querySelectorAll('.image-gallery-slot')[2]).toContainElement(view.container.querySelector('.conversation-image-loading'))
  })
  it('keeps all four slots after partial failure or cancellation', () => {
    const base = { callId: 'four', toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate', summary: '生成图片', argumentsHash: '', imageCount: 4 }
    const view = render(<AgentResponse message={{ id: 'a', role: 'agent', content: '四张' }} tools={[{ ...base, status: 'running' }]} />)
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(4)
    expect(screen.getAllByRole('status', { name: '正在生成图片' })).toHaveLength(4)
    view.rerender(<AgentResponse message={{ id: 'a', role: 'agent', content: '四张' }} tools={[{ ...base, status: 'completed' }]} />)
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(4)
    expect(screen.getAllByRole('status', { name: '图片生成失败' })).toHaveLength(4)
    view.rerender(<AgentResponse message={{ id: 'a', role: 'agent', content: '四张' }} tools={[{ ...base, status: 'cancelled' }]} />)
    expect(screen.getAllByRole('status', { name: '图片生成已取消' })).toHaveLength(4)
    expect(agentStyles).toMatch(/prefers-reduced-motion:\s*reduce/)
  })

  it('starts a separate dot-cloud animation for each pending image slot', () => {
    const cancel = vi.fn()
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 282, height: 282 } as DOMRect)
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    try {
      const view = render(<AgentResponse message={{ id: 'animated', role: 'agent', content: '', parts: [
        { kind: 'image-batch', callId: 'animated-call', imageCount: 4 }
      ] }} tools={[{
        callId: 'animated-call', toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate',
        summary: '生成图片', argumentsHash: '', status: 'running', imageCount: 4
      }]} />)
      expect(animate).toHaveBeenCalledTimes(4)
      expect(view.container.querySelectorAll('.image-gallery-dots')).toHaveLength(4)
      const asset = { assetId: 'generated-0', sessionId: 'session-1', mimeType: 'image/png' as const,
        width: 1, height: 1, byteLength: 20, source: 'generated' as const }
      view.rerender(<AgentResponse message={{ id: 'animated', role: 'agent', content: '', parts: [
        { kind: 'image-batch', callId: 'animated-call', imageCount: 4 },
        { kind: 'image', asset, generation: { callId: 'animated-call', index: 0 } }
      ] }} tools={[{
        callId: 'animated-call', toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate',
        summary: '生成图片', argumentsHash: '', status: 'running', imageCount: 4
      }]} readImage={() => new Promise<Blob>(() => {})} />)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(view.container.querySelectorAll('.image-gallery-dots')).toHaveLength(3)
      view.unmount()
      expect(cancel).toHaveBeenCalledTimes(4)
    } finally {
      rect.mockRestore()
      delete (HTMLElement.prototype as { animate?: unknown }).animate
      vi.unstubAllGlobals()
    }
  })

  it.each([5, 16])('keeps %i generated image slots in input order through completion and cancellation', (count) => {
    const tool = {
      callId: `batch-${count}`, toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate',
      summary: '生成图片', argumentsHash: '', status: 'running' as const, imageCount: count
    }
    const asset = {
      assetId: `generated-${count - 1}`, sessionId: 'session-1', mimeType: 'image/png' as const,
      width: 1, height: 1, byteLength: 20, source: 'generated' as const
    }
    const text = '先说明，再展示图片'
    const readImage = () => new Promise<Blob>(() => {})
    const view = render(<AgentResponse message={{ id: 'a', role: 'agent', content: text }} tools={[tool]} readImage={readImage} />)
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(count)
    expect(view.container.querySelector('.agent-message')?.firstElementChild).toHaveTextContent(text)
    expect(screen.getAllByRole('status', { name: '正在生成图片' })).toHaveLength(count)

    const message = {
      id: 'a', role: 'agent' as const, content: text,
      parts: [
        { kind: 'text' as const, text },
        { kind: 'image-batch' as const, callId: tool.callId, imageCount: count },
        { kind: 'image' as const, asset, generation: { callId: tool.callId, index: count - 1 } }
      ]
    }
    view.rerender(<AgentResponse message={message} tools={[tool]} readImage={readImage} />)
    const slots = view.container.querySelectorAll('.image-gallery-slot')
    expect(slots).toHaveLength(count)
    expect(slots[count - 1]).toContainElement(view.container.querySelector('.conversation-image-loading'))
    expect(slots[0]).toHaveAttribute('class', expect.stringContaining('is-pending'))

    view.rerender(<AgentResponse message={message} tools={[{ ...tool, status: 'completed' }]} readImage={readImage} />)
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(count)
    expect(screen.getAllByRole('status', { name: '图片生成失败' })).toHaveLength(count - 1)
    view.rerender(<AgentResponse message={message} tools={[{ ...tool, status: 'cancelled' }]} readImage={readImage} />)
    expect(screen.getAllByRole('status', { name: '图片生成已取消' })).toHaveLength(count - 1)
    expect(agentStyles).toMatch(/\.image-gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/)
    expect(agentStyles).toMatch(/@media \(max-width:\s*560px\)\s*\{\s*\.image-gallery-grid\s*\{\s*grid-template-columns:\s*1fr/)
    expect(agentStyles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/)
  })

  it('uses one column for a single generated image', () => {
    const view = render(<AgentResponse message={{ id: 'a', role: 'agent', content: '' }} tools={[{
      callId: 'single', toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate',
      summary: '生成图片', argumentsHash: '', status: 'running', imageCount: 1
    }]} />)
    expect(view.container.querySelector('.image-gallery-grid')).toHaveClass('is-single')
  })
  it('places uploaded images above the text inside one user bubble', () => {
    const asset = {
      assetId: 'asset-above-text',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 100,
      height: 100,
      byteLength: 32,
      source: 'upload' as const
    }
    const view = render(
      <UserMessage
        message={{
          id: 'u',
          role: 'user',
          content: '这是什么',
          parts: [
            { kind: 'text', text: '这是什么' },
            { kind: 'image', asset }
          ]
        }}
        readImage={async () => new Blob(['png'], { type: 'image/png' })}
      />
    )
    const bubble = view.container.querySelector('.user-message-with-images')
    expect(bubble?.children).toHaveLength(2)
    expect(bubble?.firstElementChild?.className).toMatch(/^conversation-image-/)
    expect(bubble?.lastElementChild).toHaveTextContent('这是什么')
  })

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
      expect(agentStyles).toMatch(
        /\.user-message-with-images \.conversation-image-open\s*\{[^}]*width:\s*104px;[^}]*height:\s*104px/s
      )
      expect(agentStyles).toMatch(
        /\.user-message-with-images \.conversation-image-open img\s*\{[^}]*object-fit:\s*contain/s
      )
      view.unmount()
      view = undefined
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wide-image')
    } finally {
      view?.unmount()
      URL.createObjectURL = previousCreate
      URL.revokeObjectURL = previousRevoke
    }
  })
  it('switches between the images of one generation call but not into another call', async () => {
    const urls = stubObjectUrls()
    let view: ReturnType<typeof render> | undefined
    try {
      view = render(
        <AgentResponse
          message={{
            id: 'a',
            role: 'agent',
            content: '',
            parts: [
              { kind: 'image-batch', callId: 'first', imageCount: 2, order: 1 },
              { kind: 'image', asset: imageAsset('a0'), generation: { callId: 'first', index: 0 }, order: 2 },
              { kind: 'image', asset: imageAsset('a1'), generation: { callId: 'first', index: 1 }, order: 3 },
              { kind: 'image-batch', callId: 'second', imageCount: 1, order: 4 },
              { kind: 'image', asset: imageAsset('b0'), generation: { callId: 'second', index: 0 }, order: 5 }
            ]
          }}
          readImage={urls.readImage}
        />
      )
      expect(await screen.findAllByRole('img', { name: '生成的图片' })).toHaveLength(3)
      fireEvent.click(screen.getByTestId('e2e/tasks/detail/images/a0/open#button'))
      expect(previewSource()).toBe('blob:a0')

      pressArrowRight()
      expect(previewSource()).toBe('blob:a1')
      pressArrowRight()
      expect(previewSource()).toBe('blob:a1')
    } finally {
      view?.unmount()
      urls.restore()
    }
  })

  it('switches between the images one user message uploaded', async () => {
    const urls = stubObjectUrls()
    let view: ReturnType<typeof render> | undefined
    try {
      view = render(
        <UserMessage
          message={{
            id: 'u',
            role: 'user',
            content: '看这两张',
            parts: [
              { kind: 'text', text: '看这两张' },
              { kind: 'image', asset: imageAsset('u0', 'upload') },
              { kind: 'image', asset: imageAsset('u1', 'upload') }
            ]
          }}
          readImage={urls.readImage}
        />
      )
      expect(await screen.findAllByRole('img', { name: '上传的图片' })).toHaveLength(2)
      fireEvent.click(screen.getByTestId('e2e/tasks/detail/images/u0/open#button'))
      pressArrowRight()
      expect(previewSource()).toBe('blob:u1')
    } finally {
      view?.unmount()
      urls.restore()
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
      expect(previewSource()).toBe('blob:conversation-image')
      expect(screen.getByRole('button', { name: 'rotateRight' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(previewSource()).toBeNull()
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

  it('leaves the running indicator to the activity area and renders no placeholder', () => {
    const { rerender } = render(
      <AgentResponse message={{ id: 'live', role: 'agent', content: '' }} />
    )

    // The activity area owns “正在思考”; the transcript must not add a second
    // status line of its own.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(<AgentResponse message={{ id: 'live', role: 'agent', content: '**完成**' }} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('完成')).toBeVisible()
  })
})
