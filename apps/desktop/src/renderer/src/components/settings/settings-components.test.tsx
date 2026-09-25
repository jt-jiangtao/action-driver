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
import { ModelStatusPill } from '../ModelStatusPill'

const connection: ModelConnection = {
  id: 'gateway',
  name: '公司模型网关',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKeyHint: '••••test',
  expanded: true,
  models: [{ id: 'gpt-5.2', name: 'gpt-5.2', enabled: true, testState: 'untested' }]
}

describe('settings components', () => {
  it('renders the unsupported-text state distinctly from failures', () => {
    render(
      <>
        <ModelStatusPill state="unsupported" />
        <ModelStatusPill state="failed" />
      </>
    )

    expect(screen.getByText('不支持文本')).toBeVisible()
    expect(screen.getByText('失败')).toBeVisible()
  })

  it('runs the reusable page title and model library row actions', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onTestModel = vi.fn()
    const onToggleModel = vi.fn()
    render(
      <>
        <SettingsPageTitle hasConnections onAdd={onAdd} />
        <ModelLibrary
          connection={connection}
          onTestModel={onTestModel}
          onToggleModel={onToggleModel}
        />
      </>
    )

    expect(screen.getByRole('heading', { name: '模型连接' })).toBeVisible()
    expect(screen.getByText('gpt-5.2')).toBeVisible()
    expect(screen.getByText('待测试')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '添加模型集' }))
    await user.click(screen.getByRole('button', { name: '测试gpt-5.2' }))
    await user.click(screen.getByRole('switch', { name: '启用gpt-5.2' }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onTestModel).toHaveBeenCalledWith('gpt-5.2')
    expect(onToggleModel).toHaveBeenCalledWith('gpt-5.2', false)
  })

  it('keeps draft, models, and results when the wizard goes back', () => {
    const draft: ModelConnectionDraft = {
      name: '研发网关',
      protocol: 'openai-compatible',
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

  it('runs controlled manual model row actions', async () => {
    const user = userEvent.setup()
    const onChangeName = vi.fn()
    const onTest = vi.fn()
    const onToggle = vi.fn()
    render(
      <ManualModelRow
        model={{ id: 'custom-model', name: 'custom-model', enabled: true, testState: 'untested' }}
        onChangeName={onChangeName}
        onTest={onTest}
        onToggle={onToggle}
      />
    )

    expect(screen.getByLabelText('手动模型名称')).toHaveValue('custom-model')
    expect(screen.getByRole('switch', { name: '选择custom-model' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await user.type(screen.getByLabelText('手动模型名称'), '-v2')
    await user.click(screen.getByRole('button', { name: '测试custom-model' }))
    await user.click(screen.getByRole('switch', { name: '选择custom-model' }))
    expect(onChangeName).toHaveBeenCalled()
    expect(onChangeName).toHaveBeenLastCalledWith('custom-model2')
    expect(onTest).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('runs picker model row actions', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn()
    const onToggle = vi.fn()
    render(
      <ModelPickerRow
        model={{ id: 'gpt-5.2', name: 'gpt-5.2', enabled: true, testState: 'success', capabilities: { text: { state: 'success', source: 'probe' }, vision: { state: 'unsupported', source: 'probe' } } }}
        onTest={onTest}
        onToggle={onToggle}
      />
    )

    expect(screen.getByText('gpt-5.2')).toBeVisible()
    expect(screen.getByText('文本 · 通过')).toBeVisible()
    expect(screen.getByText('视觉 · 不支持')).toBeVisible()
    expect(screen.getByRole('switch', { name: '选择gpt-5.2' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await user.click(screen.getByRole('button', { name: '测试gpt-5.2' }))
    await user.click(screen.getByRole('switch', { name: '选择gpt-5.2' }))
    expect(onTest).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('prevents duplicate refreshes while a connection refresh is pending', async () => {
    const user = userEvent.setup()
    let finish: (() => void) | undefined
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
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
