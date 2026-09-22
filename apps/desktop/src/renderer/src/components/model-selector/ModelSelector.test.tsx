import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toModelSelectionProjection } from '../../models/model-selection'
import { mockModelSelection } from '../../testing/model-selection-fixture'
import { ModelSelector } from './ModelSelector'

describe('ModelSelector', () => {
  it('expands connections and selects a model', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ModelSelector
        projection={mockModelSelection}
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
    const anthropic = screen.getByRole('option', {
      name: 'claude-sonnet-4，Agent 调用暂未接入'
    })
    expect(anthropic).toBeDisabled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('supports arrow navigation, Enter selection, Escape, and outside click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ModelSelector projection={mockModelSelection} onSelect={onSelect} />)

    const trigger = screen.getByRole('button', { name: /当前模型/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith({
      connectionId: 'company-gateway',
      modelId: 'gpt-5.2-mini'
    })

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    await user.click(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps duplicate model ids distinct by connection and clears an unavailable selection', () => {
    const projection = toModelSelectionProjection(
      [
        {
          id: 'openai-a',
          name: 'OpenAI A',
          protocol: 'openai-compatible',
          baseUrl: 'https://a.example/v1',
          apiKeyHint: '••••a',
          expanded: true,
          models: [{ id: 'same-model', name: 'same-model', enabled: true, testState: 'success' }]
        },
        {
          id: 'openai-b',
          name: 'OpenAI B',
          protocol: 'openai-compatible',
          baseUrl: 'https://b.example/v1',
          apiKeyHint: '••••b',
          expanded: true,
          models: [{ id: 'same-model', name: 'same-model', enabled: false, testState: 'success' }]
        }
      ],
      { connectionId: 'openai-b', modelId: 'same-model' }
    )

    expect(projection.selected).toBeNull()
    expect(projection.connections[0]?.models[0]?.ref).toEqual({
      connectionId: 'openai-a',
      modelId: 'same-model'
    })
    expect(projection.connections[1]?.models[0]?.disabledReason).toBe('模型已停用')
  })
})
