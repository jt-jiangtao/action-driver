import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgentComposer } from '../../../../../src/renderer/src/components/AgentComposer'
import { mockModelSelection } from '../../../../../src/renderer/src/testing/model-selection-fixture'
import agentStyles from '../../../../../src/renderer/src/styles/agent.css?raw'

describe('AgentComposer', () => {
  it('keeps the full wide image visible with a separate file action row', async () => {
    const user = userEvent.setup()
    const previousCreate = URL.createObjectURL
    const previousRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:wide-preview')
    URL.revokeObjectURL = vi.fn()
    let view: ReturnType<typeof render> | undefined
    try {
      view = render(<AgentComposer onSubmit={() => undefined} />)
      const image = new File(['wide screenshot'], 'wide-screenshot.png', { type: 'image/png' })
      await user.upload(screen.getByLabelText('添加图片'), image)
      const preview = screen.getByText('wide-screenshot.png').closest('.composer-image-preview')
      expect(preview).toBeInTheDocument()
      expect(
        screen.getByLabelText('任务描述').compareDocumentPosition(preview!) &
          Node.DOCUMENT_POSITION_PRECEDING
      ).toBeTruthy()
      expect(preview?.querySelector('.composer-image-preview-frame')).not.toBeNull()
      expect(preview?.querySelector('.composer-image-preview-meta')).not.toBeNull()
      expect(preview?.querySelector('img')).toHaveAttribute('alt', 'wide-screenshot.png')
      expect(agentStyles).toMatch(/\.composer-image-preview img\s*\{[^}]*object-fit:\s*contain/s)
      const previewSource = () =>
        document.querySelector('.image-preview img')?.getAttribute('src') ?? null
      await user.click(screen.getByRole('button', { name: '放大 wide-screenshot.png' }))
      expect(previewSource()).toBe(preview?.querySelector('img')?.getAttribute('src'))
      expect(screen.getByRole('button', { name: 'flipX' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(previewSource()).toBeNull()
      screen.getByRole('button', { name: '放大 wide-screenshot.png' }).focus()
      await user.keyboard('{Enter}')
      expect(previewSource()).not.toBeNull()
      await user.click(screen.getByLabelText('关闭图片预览'))
      expect(previewSource()).toBeNull()
      view.unmount()
      view = undefined
    } finally {
      view?.unmount()
      URL.createObjectURL = previousCreate
      URL.revokeObjectURL = previousRevoke
    }
  })
  it('uses the plus and send actions and submits Slate text', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onAdd = vi.fn()
    render(<AgentComposer initialText="预订杭州酒店" onSubmit={onSubmit} onAdd={onAdd} />)

    expect(screen.getByLabelText('添加')).toBeVisible()
    await user.click(screen.getByLabelText('添加'))
    expect(onAdd).toHaveBeenCalledOnce()
    await user.click(screen.getByLabelText('发送'))
    expect(onSubmit).toHaveBeenCalledWith('预订杭州酒店')
  })

  it('shows an attached document, removes it by keyboard, and submits it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AgentComposer onSubmit={onSubmit} />)
    const document = new File(['%PDF-1.7'], '季度报告.pdf', { type: 'application/pdf' })

    await user.upload(screen.getByLabelText('选择文档'), document)

    const preview = screen.getByText('季度报告.pdf').closest('.composer-document-preview')
    expect(preview).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '待发送文件' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).toHaveBeenCalledWith('', { images: [], documents: [document] })

    onSubmit.mockClear()
    const other = new File(['doc'], 'notes.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
    await user.upload(screen.getByLabelText('选择文档'), other)
    const remove = screen.getByRole('button', { name: '移除 notes.docx' })
    remove.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('notes.docx')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).toHaveBeenCalledWith('', { images: [], documents: [document] })
  })

  it('reports unsupported and oversized documents before sending', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<AgentComposer onSubmit={() => undefined} />)

    await user.upload(
      screen.getByLabelText('选择文档'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' })
    )
    expect(screen.getByRole('alert')).toHaveTextContent('仅支持不超过 50 MiB')
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()

    const oversized = new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'huge.pdf', {
      type: 'application/pdf'
    })
    await user.upload(screen.getByLabelText('选择文档'), oversized)
    expect(screen.getByRole('alert')).toHaveTextContent('仅支持不超过 50 MiB')
    expect(screen.queryByText('huge.pdf')).not.toBeInTheDocument()
  })

  it('protects against submitting an empty goal', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AgentComposer onSubmit={onSubmit} />)

    expect(screen.getByLabelText('发送')).toBeDisabled()
    await user.click(screen.getByLabelText('发送'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the Codex-style stop button and interrupts a running task', async () => {
    const user = userEvent.setup()
    const onInterrupt = vi.fn()
    render(<AgentComposer running onSubmit={vi.fn()} onInterrupt={onInterrupt} />)
    expect(screen.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
      'data-state',
      'running'
    )
    expect(screen.getByLabelText('任务描述')).toHaveAttribute('contenteditable', 'false')
    expect(screen.getByLabelText('中断任务')).toBeVisible()
    expect(screen.queryByLabelText('发送')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('中断任务'))
    expect(onInterrupt).toHaveBeenCalledOnce()
  })

  it('keeps unsupported non-running task input read-only instead of silently submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AgentComposer disabled onSubmit={onSubmit} />)

    expect(screen.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
      'data-state',
      'disabled'
    )

    const editor = screen.getByLabelText('任务描述')
    expect(editor).toHaveAttribute('contenteditable', 'false')
    await user.click(screen.getByLabelText('发送'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('selects a model without clearing the Slate draft', async () => {
    const user = userEvent.setup()
    const onSelectModel = vi.fn()
    render(
      <AgentComposer
        initialText="保留这段文字"
        modelSelection={mockModelSelection}
        onSelectModel={onSelectModel}
        onSubmit={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /当前模型/ }))
    await user.click(screen.getByRole('option', { name: 'gpt-4.1' }))

    expect(onSelectModel).toHaveBeenCalledWith({
      connectionId: 'company-gateway',
      modelId: 'gpt-4.1'
    })
    expect(screen.getByLabelText('任务描述')).toHaveTextContent('保留这段文字')
  })

  it('accepts an image-only message and keeps the image after submission fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {
      throw new Error('上传失败')
    })
    render(<AgentComposer onSubmit={onSubmit} />)
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('添加图片'), image)
    expect(screen.getByText('photo.png')).toBeVisible()
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).toHaveBeenCalledWith('', { images: [image], documents: [] })
    expect(await screen.findByRole('alert')).toHaveTextContent('上传失败')
    expect(screen.getByText('photo.png')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '移除 photo.png' }))
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })
})
