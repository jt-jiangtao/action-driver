import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { defaultModelSelection } from '../../models/model-selection'
import { ModelSelector } from './ModelSelector'

describe('ModelSelector', () => {
  it('expands connections and selects a model', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ModelSelector
        projection={defaultModelSelection}
        onSelect={onSelect}
        onOpenChange={onOpenChange}
      />
    )

    const trigger = screen.getByRole('button', { name: /当前模型/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: '选择模型' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Anthropic 生产连接' }))
    expect(screen.getByRole('option', { name: 'claude-sonnet-4' })).toBeVisible()
    await user.click(screen.getByRole('option', { name: 'claude-sonnet-4' }))
    expect(onSelect).toHaveBeenCalledWith('claude-sonnet-4')
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('supports arrow navigation, Enter selection, Escape, and outside click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ModelSelector projection={defaultModelSelection} onSelect={onSelect} />)

    const trigger = screen.getByRole('button', { name: /当前模型/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('gpt-5.2-mini')

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    await user.click(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
