import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ModelConnection, ModelConnectionDraft } from '../../models/model-connections'
import { addModelSetReducer, initialAddModelSetState } from '../../models/add-model-set-state'
import { ModelLibrary } from './ModelLibrary'
import { SettingsPageTitle } from './SettingsPageTitle'
import { ManualModelRow } from './ManualModelRow'
import { ModelPickerRow } from './ModelPickerRow'
import { ModelCapabilityResults } from './ModelCapabilityResults'
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

  it('invalidates discovered models and probes when the connection identity changes', () => {
    const draft: ModelConnectionDraft = {
      name: 'Gateway',
      protocol: 'openai-compatible',
      baseUrl: 'https://models.example.com/v1',
      apiKey: 'sk-original'
    }
    let state = addModelSetReducer(initialAddModelSetState, { type: 'update-draft', draft })
    state = addModelSetReducer(state, {
      type: 'models-discovered',
      models: [
        {
          id: 'vision',
          name: 'vision',
          enabled: true,
          testState: 'success',
          capabilities: {
            text: { state: 'success', source: 'probe' },
            vision: { state: 'success', source: 'probe' }
          }
        }
      ]
    })
    const renamed = addModelSetReducer(state, {
      type: 'update-draft',
      draft: { ...draft, name: 'Renamed' }
    })
    expect(renamed.models).toHaveLength(1)
    const changedKey = addModelSetReducer(renamed, {
      type: 'update-draft',
      draft: { ...renamed.draft, apiKey: 'sk-new' }
    })
    expect(changedKey.models).toEqual([])
    expect(
      addModelSetReducer(state, {
        type: 'update-draft',
        draft: { ...draft, baseUrl: 'https://other.example.com/v1' }
      }).models
    ).toEqual([])
  })

  it('replaces stale wizard probe results and marks a request failure for every candidate', () => {
    const model = {
      id: 'chat',
      name: 'chat',
      enabled: true,
      testState: 'success' as const,
      probeCandidates: ['text', 'vision'] as ('text' | 'vision')[],
      capabilities: {
        text: { state: 'success' as const, source: 'probe' as const },
        vision: { state: 'success' as const, source: 'probe' as const }
      }
    }
    const discovered = addModelSetReducer(initialAddModelSetState, {
      type: 'models-discovered',
      models: [model]
    })
    const partial = addModelSetReducer(discovered, {
      type: 'model-result',
      results: [
        {
          modelId: 'chat',
          state: 'failed',
          capabilities: { text: { state: 'failed', source: 'probe' } }
        }
      ]
    })
    expect(partial.models[0]?.capabilities?.vision).toBeUndefined()

    const failed = addModelSetReducer(discovered, {
      type: 'model-result',
      results: [{ modelId: 'chat', state: 'failed' }]
    })
    expect(failed.models[0]?.capabilities?.text?.state).toBe('failed')
    expect(failed.models[0]?.capabilities?.vision?.state).toBe('failed')
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
        model={{
          id: 'gpt-5.2',
          name: 'gpt-5.2',
          enabled: true,
          testState: 'success',
          capabilities: {
            text: { state: 'success', source: 'probe' },
            vision: { state: 'unsupported', source: 'probe' }
          }
        }}
        onTest={onTest}
        onToggle={onToggle}
      />
    )

    expect(screen.getByText('gpt-5.2')).toBeVisible()
    expect(screen.getByText('文本 · 成功')).toBeVisible()
    expect(screen.getByText('视觉 · 失败')).toBeVisible()
    expect(screen.getByRole('switch', { name: '选择gpt-5.2' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await user.click(screen.getByRole('button', { name: '测试gpt-5.2' }))
    await user.click(screen.getByRole('switch', { name: '选择gpt-5.2' }))
    expect(onTest).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('distinguishes migrated results from new untested capabilities', () => {
    render(
      <ModelCapabilityResults
        capabilities={{
          text: { state: 'untested', source: 'legacy' },
          vision: { state: 'untested', source: 'probe' }
        }}
      />
    )

    expect(screen.getByText('文本 · 待测试')).toBeVisible()
    expect(screen.getByText('视觉 · 待测试')).toBeVisible()
  })

  it('shows each running capability and only binary terminal labels without failure details', () => {
    const { rerender } = render(
      <ModelCapabilityResults probeCandidates={['text', 'vision']} testing />
    )
    expect(screen.getByText('文本 · 测试中')).toBeVisible()
    expect(screen.getByText('视觉 · 测试中')).toBeVisible()
    rerender(
      <ModelCapabilityResults
        capabilities={{
          text: { state: 'success', source: 'probe' },
          vision: {
            state: 'unsupported',
            source: 'probe',
            failure: { code: 'provider-error', message: 'secret provider detail' }
          }
        }}
        catalogLabels={['speech_recognition']}
      />
    )
    expect(screen.getByText('文本 · 成功')).toBeVisible()
    expect(screen.getByText('视觉 · 失败')).toBeVisible()
    expect(screen.queryByText(/语音识别/)).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('secret provider detail')
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

    await user.dblClick(screen.getByRole('button', { name: '刷新并测试公司模型网关' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '刷新并测试公司模型网关' })).toBeDisabled()
    finish?.()
  })
})
