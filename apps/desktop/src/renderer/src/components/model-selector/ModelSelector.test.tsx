import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { loadingModelSelection, toModelSelectionProjection } from '../../models/model-selection'
import { mockModelSelection } from '../../testing/model-selection-fixture'
import { ModelSelector } from './ModelSelector'

describe('ModelSelector', () => {
  it('projects each tested capability into a readable state without changing chat eligibility', () => {
    const projection = toModelSelectionProjection(
      [
        {
          id: 'gateway',
          name: 'Gateway',
          protocol: 'openai-compatible',
          baseUrl: 'https://example.com/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models: [
            {
              id: 'chat',
              name: 'chat',
              enabled: true,
              testState: 'failed',
              chatCandidate: true,
              capabilities: {
                text: { state: 'success', source: 'probe' },
                reasoning: { state: 'inconclusive', source: 'probe' },
                vision: { state: 'unsupported', source: 'probe' }
              }
            }
          ]
        }
      ],
      null
    )
    expect(projection.connections[0]?.models[0]?.capabilityStates).toEqual({
      text: 'success',
      reasoning: 'failed',
      vision: 'failed',
      image_generation: 'untested'
    })
    expect(projection.selected?.modelId).toBe('chat')
  })

  it('shows four capability states from an icon on hover and keyboard navigation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const projection = toModelSelectionProjection(
      [
        {
          id: 'gateway',
          name: 'Gateway',
          protocol: 'openai-compatible',
          baseUrl: 'https://example.com/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models: [
            {
              id: 'chat',
              name: 'chat',
              enabled: true,
              testState: 'success',
              chatCandidate: true,
              capabilities: {
                text: { state: 'success', source: 'probe' },
                reasoning: { state: 'failed', source: 'probe' },
                image_generation: { state: 'success', source: 'probe' }
              }
            }
          ]
        }
      ],
      { connectionId: 'gateway', modelId: 'chat' }
    )
    render(<ModelSelector projection={projection} onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /当前模型/ }))
    const option = screen.getByRole('option', { name: 'chat' })
    const icon = within(option).getByRole('img', { name: '查看能力状态' })
    expect(icon.previousElementSibling).toHaveTextContent('chat')
    expect(option.querySelector('.model-option-check')).toBe(option.lastElementChild)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.hover(icon)
    expect(screen.getByRole('tooltip')).toHaveTextContent('文本：成功')
    expect(screen.getByRole('tooltip')).toHaveTextContent('推理：失败')
    expect(screen.getByRole('tooltip')).toHaveTextContent('视觉：待测试')
    expect(screen.getByRole('tooltip')).toHaveTextContent('生图：成功')
    await user.unhover(icon)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('tooltip')).toBeVisible()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ connectionId: 'gateway', modelId: 'chat' })
  })

  it('does not treat universal probe coverage as permission to chat', () => {
    const projection = toModelSelectionProjection(
      [
        {
          id: 'gateway',
          name: 'Gateway',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models: [
            {
              id: 'chat',
              name: 'chat',
              enabled: true,
              testState: 'untested',
              probeCandidates: ['text', 'reasoning', 'vision'],
              chatCandidate: true
            },
            {
              id: 'image',
              name: 'image',
              enabled: true,
              testState: 'untested',
              probeCandidates: ['text', 'reasoning', 'vision', 'image_generation'],
              chatCandidate: false
            },
            {
              id: 'audio',
              name: 'audio',
              enabled: true,
              testState: 'untested',
              probeCandidates: ['text', 'reasoning', 'vision'],
              chatCandidate: false,
              catalogLabels: ['speech_recognition']
            }
          ]
        }
      ],
      null
    )
    expect(projection.connections[0]?.models.map((model) => model.id)).toEqual(['chat'])
  })

  it('offers untested and failed chat candidates without a selection warning', () => {
    const projection = toModelSelectionProjection(
      [
        {
          id: 'gateway',
          name: 'Gateway',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models: [
            {
              id: 'untested',
              name: 'untested',
              enabled: true,
              testState: 'untested',
              probeCandidates: ['text', 'vision']
            },
            {
              id: 'failed',
              name: 'failed',
              enabled: true,
              testState: 'failed',
              probeCandidates: ['text'],
              capabilities: { text: { state: 'failed', source: 'probe' } }
            },
            {
              id: 'image',
              name: 'image',
              enabled: true,
              testState: 'untested',
              probeCandidates: ['image_generation']
            },
            {
              id: 'legacy-image',
              name: 'legacy-image',
              kind: 'image',
              enabled: true,
              testState: 'untested',
              probeCandidates: ['text']
            },
            {
              id: 'audio',
              name: 'audio',
              enabled: true,
              testState: 'untested',
              probeCandidates: [],
              catalogLabels: ['speech_recognition']
            },
            {
              id: 'disabled',
              name: 'disabled',
              enabled: false,
              testState: 'untested',
              probeCandidates: ['text']
            }
          ]
        }
      ],
      null
    )
    expect(projection.connections[0]?.models.map((model) => model.id)).toEqual([
      'untested',
      'failed',
      'legacy-image'
    ])
    expect(
      projection.connections[0]?.models.every((model) => !model.disabled && !model.disabledReason)
    ).toBe(true)
  })

  it('marks the trigger selected only when a model is selected', () => {
    const view = render(
      <ModelSelector projection={{ ...mockModelSelection, selected: null }} onSelect={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveAttribute(
      'data-selected',
      'false'
    )

    view.rerender(<ModelSelector projection={mockModelSelection} onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /当前模型/ })).toHaveAttribute(
      'data-selected',
      'true'
    )
  })

  it('expands the selected connection after an asynchronous model load', async () => {
    const user = userEvent.setup()
    const view = render(<ModelSelector projection={loadingModelSelection} onSelect={vi.fn()} />)
    view.rerender(<ModelSelector projection={mockModelSelection} onSelect={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /当前模型/ }))
    expect(screen.getByRole('option', { name: 'gpt-4.1' })).toBeVisible()
  })

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
    const anthropic = screen.getByRole('option', { name: 'claude-sonnet-4' })
    expect(anthropic).toBeDisabled()
    expect(screen.queryByText('Agent 调用暂未接入')).not.toBeInTheDocument()
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
          models: [
            {
              id: 'same-model',
              name: 'same-model',
              enabled: true,
              testState: 'success',
              capabilities: { text: { state: 'success', source: 'probe' } }
            }
          ]
        },
        {
          id: 'openai-b',
          name: 'OpenAI B',
          protocol: 'openai-compatible',
          baseUrl: 'https://b.example/v1',
          apiKeyHint: '••••b',
          expanded: true,
          models: [
            {
              id: 'same-model',
              name: 'same-model',
              enabled: false,
              testState: 'success',
              capabilities: { text: { state: 'success', source: 'probe' } }
            }
          ]
        }
      ],
      { connectionId: 'openai-b', modelId: 'same-model' }
    )

    expect(projection.selected).toBeNull()
    expect(projection.connections[0]?.models[0]?.ref).toEqual({
      connectionId: 'openai-a',
      modelId: 'same-model'
    })
    expect(projection.connections[1]).toBeUndefined()
  })

  it('leaves image generation models out of the chat model picker', () => {
    const projection = toModelSelectionProjection(
      [
        {
          id: 'mixed',
          name: '混合连接',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models: [
            {
              id: 'chat',
              name: 'chat',
              enabled: true,
              testState: 'success',
              capabilities: { text: { state: 'success', source: 'probe' } }
            },
            {
              id: 'image',
              name: 'image',
              enabled: true,
              testState: 'success',
              capabilities: { image_generation: { state: 'success', source: 'probe' } }
            }
          ]
        }
      ],
      null
    )
    expect(projection.connections[0]?.models.map((model) => model.id)).toEqual(['chat'])
    expect(projection.selected?.modelId).toBe('chat')
  })

  it('keeps a dual-capability model and an untested legacy chat candidate selectable', () => {
    const projection = toModelSelectionProjection(
      [
        {
          id: 'mixed',
          name: '混合连接',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models: [
            {
              id: 'dual',
              name: 'dual',
              enabled: true,
              testState: 'success',
              capabilities: {
                text: { state: 'success', source: 'probe' },
                image_generation: { state: 'success', source: 'probe' },
                vision: { state: 'success', source: 'probe' }
              }
            },
            { id: 'legacy', name: 'legacy', enabled: true, testState: 'success' }
          ]
        }
      ],
      null
    )
    expect(projection.selected?.modelId).toBe('dual')
    expect(projection.connections[0]?.models[0]).toMatchObject({
      disabled: false,
      visionVerified: true
    })
    expect(projection.connections[0]?.models[1]).toMatchObject({
      disabled: false,
      disabledReason: null
    })
  })
})
