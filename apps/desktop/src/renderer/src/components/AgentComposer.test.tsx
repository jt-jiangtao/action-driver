import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgentComposer } from './AgentComposer'
import { defaultModelSelection } from '../models/model-selection'

describe('AgentComposer', () => {
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

  it('protects against submitting an empty goal', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AgentComposer onSubmit={onSubmit} />)

    expect(screen.getByLabelText('发送')).toBeDisabled()
    await user.click(screen.getByLabelText('发送'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the Codex-style stop button while running', () => {
    render(<AgentComposer running onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('中断任务')).toBeVisible()
    expect(screen.queryByLabelText('发送')).not.toBeInTheDocument()
  })

  it('keeps unsupported non-running task input read-only instead of silently submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AgentComposer disabled onSubmit={onSubmit} />)

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
        modelSelection={defaultModelSelection}
        onSelectModel={onSelectModel}
        onSubmit={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /当前模型/ }))
    await user.click(screen.getByRole('option', { name: 'gpt-4.1' }))

    expect(onSelectModel).toHaveBeenCalledWith('gpt-4.1')
    expect(screen.getByLabelText('任务描述')).toHaveTextContent('保留这段文字')
  })
})
