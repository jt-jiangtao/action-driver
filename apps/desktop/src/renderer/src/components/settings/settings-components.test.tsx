import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ModelConnection, ModelConnectionDraft } from '../../models/model-connections'
import { addModelSetReducer, initialAddModelSetState } from '../../models/add-model-set-state'
import { ModelLibrary } from './ModelLibrary'
import { SettingsPageTitle } from './SettingsPageTitle'
import { ManualModelRow } from './ManualModelRow'
import { ModelPickerRow } from './ModelPickerRow'
import { ModelConnectionCard } from '../ModelConnectionCard'

const connection: ModelConnection = {
  id: 'gateway',
  name: '公司模型网关',
  protocol: 'OpenAI 兼容',
  baseUrl: 'https://api.example.com/v1',
  expanded: true,
  models: [{ id: 'gpt-5.2', name: 'gpt-5.2', enabled: true, testState: 'untested' }]
}

describe('settings components', () => {
  it('renders the reusable page title and model library rows', () => {
    render(
      <>
        <SettingsPageTitle hasConnections onAdd={vi.fn()} />
        <ModelLibrary
          connection={connection}
          onTestModel={vi.fn()}
          onToggleModel={vi.fn()}
        />
      </>
    )

    expect(screen.getByRole('heading', { name: '模型连接' })).toBeVisible()
    expect(screen.getByText('gpt-5.2')).toBeVisible()
    expect(screen.getByText('未测试')).toBeVisible()
  })

  it('keeps draft, models, and results when the wizard goes back', () => {
    const draft: ModelConnectionDraft = {
      name: '研发网关',
      baseUrl: 'https://models.example.com/v1',
      apiKey: 'sk-test'
    }
    const model = { id: 'gpt-5.2', name: 'gpt-5.2', enabled: true, testState: 'success' as const }
    let state = addModelSetReducer(initialAddModelSetState, { type: 'update-draft', draft })
    state = addModelSetReducer(state, { type: 'connection-result', ok: true })
    state = addModelSetReducer(state, { type: 'enter-models' })
    state = addModelSetReducer(state, { type: 'models-discovered', models: [model] })
    state = addModelSetReducer(state, { type: 'back' })

    expect(state.step).toBe('connection')
    expect(state.draft).toEqual(draft)
    expect(state.models).toEqual([model])
    expect(state.connectionState).toBe('success')
  })

  it('renders a controlled manual model row', () => {
    const onChangeName = vi.fn()
    render(
      <ManualModelRow
        model={{ id: 'custom-model', name: 'custom-model', enabled: true, testState: 'untested' }}
        onChangeName={onChangeName}
        onTest={vi.fn()}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByLabelText('手动模型名称')).toHaveValue('custom-model')
    expect(screen.getByRole('switch', { name: '选择custom-model' })).toHaveAttribute('aria-checked', 'true')
  })

  it('renders the picker model row states as a reusable component', () => {
    render(
      <ModelPickerRow
        model={{ id: 'gpt-5.2', name: 'gpt-5.2', enabled: true, testState: 'success' }}
        onTest={vi.fn()}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByText('gpt-5.2')).toBeVisible()
    expect(screen.getByText('成功')).toBeVisible()
    expect(screen.getByRole('switch', { name: '选择gpt-5.2' })).toHaveAttribute('aria-checked', 'true')
  })

  it('prevents duplicate refreshes while a connection refresh is pending', async () => {
    const user = userEvent.setup()
    let finish: (() => void) | undefined
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(
      <ModelConnectionCard
        connection={connection}
        expanded
        menuOpen={false}
        onDelete={vi.fn()}
        onRefresh={onRefresh}
        onTestModel={vi.fn()}
        onToggleExpanded={vi.fn()}
        onToggleMenu={vi.fn()}
        onToggleModel={vi.fn()}
      />
    )

    await user.dblClick(screen.getByRole('button', { name: '刷新公司模型网关' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '刷新公司模型网关' })).toBeDisabled()
    finish?.()
  })
})
