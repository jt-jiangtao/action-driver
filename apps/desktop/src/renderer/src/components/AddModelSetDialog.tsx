import { useReducer, useRef, useState } from 'react'
import {
  addModelSetReducer,
  getAddModelSetViewState,
  initialAddModelSetState
} from '../models/add-model-set-state'
import { MODEL_PROTOCOLS } from '../models/model-connections'
import type {
  ModelConnectionsService,
  ModelConnectionDraft,
  ModelFailure,
  ModelProtocol
} from '../models/model-connections'
import { ManualModelRow } from './settings/ManualModelRow'
import { ModelPickerRow } from './settings/ModelPickerRow'
import { AppIcon } from './ui/AppIcon'
import { IconButton } from './ui/IconButton'

export function AddModelSetDialog({
  service,
  onClose,
  onSaved
}: {
  service: ModelConnectionsService
  onClose(): void
  onSaved(): void
}) {
  const [state, dispatch] = useReducer(addModelSetReducer, initialAddModelSetState)
  const [failure, setFailure] = useState<ModelFailure | null>(null)
  const operationToken = useRef(0)
  const modelTokens = useRef(new Map<string, number>())
  const pendingModelIds = useRef(new Set<string>())
  const savePending = useRef(false)
  const fieldsComplete = Boolean(
    state.draft.name.trim() && state.draft.baseUrl.trim() && state.draft.apiKey.trim()
  )

  const updateDraft = (key: keyof ModelConnectionDraft, value: string) => {
    setFailure(null)
    if (key !== 'name' && state.draft[key] !== value) {
      operationToken.current += 1
      modelTokens.current.clear()
      pendingModelIds.current.clear()
    }
    dispatch({ type: 'update-draft', draft: { ...state.draft, [key]: value } })
  }

  const testConnection = async () => {
    const token = ++operationToken.current
    setFailure(null)
    dispatch({ type: 'connection-testing' })
    try {
      const result = await service.testConnection(state.draft)
      if (operationToken.current !== token) return
      dispatch({ type: 'connection-result', ok: result.ok })
      setFailure(result.ok ? null : result.failure)
    } catch (error) {
      if (operationToken.current !== token) return
      dispatch({ type: 'connection-result', ok: false })
      setFailure({ code: 'unknown', message: toMessage(error) })
    }
  }

  const enterModelStep = async () => {
    setFailure(null)
    dispatch({ type: 'enter-models' })
    if (state.models.length > 0) return
    const token = ++operationToken.current
    try {
      const models = await service.discover(state.draft)
      if (operationToken.current === token) dispatch({ type: 'models-discovered', models })
    } catch (error) {
      if (operationToken.current !== token) return
      dispatch({ type: 'models-discovered', models: [] })
      setFailure({ code: 'unknown', message: toMessage(error) })
    }
  }

  const testModels = async (modelIds: readonly string[]) => {
    if (modelIds.some((modelId) => pendingModelIds.current.has(modelId))) return
    setFailure(null)
    const token = ++operationToken.current
    for (const modelId of modelIds) {
      modelTokens.current.set(modelId, token)
      pendingModelIds.current.add(modelId)
    }
    dispatch({ type: 'model-testing', modelIds })
    try {
      const selectedModels = modelIds
        .map((modelId) => state.models.find((model) => model.id === modelId))
        .filter((model): model is NonNullable<typeof model> => Boolean(model))
      const requestIdByModelId = new Map(
        selectedModels.map((model) => [
          model.id,
          model.id.startsWith('custom-model') ? model.name.trim() : model.id
        ])
      )
      if (selectedModels.some((model) => !requestIdByModelId.get(model.id)))
        throw new Error('请先输入模型 ID')
      const results = await service.testModels(state.draft, [...requestIdByModelId.values()])
      const originalIdByRequestId = new Map(
        [...requestIdByModelId].map(([original, requestId]) => [requestId, original])
      )
      const currentResults = results
        .filter(
          (result) =>
            modelTokens.current.get(originalIdByRequestId.get(result.modelId) ?? result.modelId) ===
            token
        )
        .map((result) => ({
          ...result,
          modelId: originalIdByRequestId.get(result.modelId) ?? result.modelId
        }))
      if (currentResults.length) dispatch({ type: 'model-result', results: currentResults })
    } catch {
      const currentIds = modelIds.filter((modelId) => modelTokens.current.get(modelId) === token)
      if (currentIds.length) {
        dispatch({
          type: 'model-result',
          results: currentIds.map((modelId) => ({ modelId, state: 'failed' as const }))
        })
        setFailure({ code: 'unknown', message: '测试失败' })
      }
    } finally {
      for (const modelId of modelIds) {
        if (modelTokens.current.get(modelId) === token) pendingModelIds.current.delete(modelId)
      }
    }
  }

  const addManualModel = () => {
    let suffix = 1
    let id = 'custom-model'
    while (state.models.some((model) => model.id === id)) {
      suffix += 1
      id = `custom-model-${suffix}`
    }
    dispatch({
      type: 'add-manual-model',
      model: {
        id,
        name: id,
        enabled: true,
        testState: 'untested',
        capabilities: {}
      }
    })
  }

  const invalidateModelTest = (modelId: string) => {
    modelTokens.current.delete(modelId)
    pendingModelIds.current.delete(modelId)
  }

  return (
    <div className="model-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="add-model-set-title"
        aria-modal="true"
        className="model-dialog"
        data-testid="e2e/settings/add-model-set/dialog#dialog"
        data-view-state={getAddModelSetViewState(state)}
        role="dialog"
      >
        <header className="model-dialog-header">
          <h2 id="add-model-set-title">添加模型集</h2>
          <IconButton
            className="plain-icon-action"
            icon="close"
            aria-label="关闭"
            onClick={onClose}
            testId="e2e/settings/add-model-set/close#button"
          />
        </header>

        <div className="model-dialog-steps" aria-label="添加步骤">
          <div className={state.step === 'connection' ? 'is-active' : 'is-complete'}>
            <span>{state.step === 'connection' ? '1' : <AppIcon name="check" />}</span>
            <strong>连接配置</strong>
          </div>
          <i aria-hidden="true" />
          <div className={state.step === 'models' ? 'is-active' : ''}>
            <span>2</span>
            <strong>选择模型</strong>
          </div>
        </div>

        <div className="model-dialog-body">
          {state.step === 'connection' ? (
            <div className="connection-form">
              <label>
                <span>协议</span>
                <select
                  aria-label="协议"
                  className="protocol-select"
                  data-testid="e2e/settings/add-model-set/protocol#select"
                  value={state.draft.protocol}
                  onChange={(event) =>
                    updateDraft('protocol', event.currentTarget.value as ModelProtocol)
                  }
                >
                  {MODEL_PROTOCOLS.map((protocol) => (
                    <option key={protocol.id} value={protocol.id}>
                      {protocol.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>名称</span>
                <input
                  data-testid="e2e/settings/add-model-set/name#input"
                  value={state.draft.name}
                  onChange={(event) => updateDraft('name', event.currentTarget.value)}
                  placeholder="例如：公司模型网关"
                />
              </label>
              <label>
                <span>接口地址</span>
                <input
                  data-testid="e2e/settings/add-model-set/base-url#input"
                  value={state.draft.baseUrl}
                  onChange={(event) => updateDraft('baseUrl', event.currentTarget.value)}
                  placeholder="https://api.example.com/v1"
                />
              </label>
              <label>
                <span>API 密钥</span>
                <input
                  data-testid="e2e/settings/add-model-set/api-key#input"
                  type="password"
                  value={state.draft.apiKey}
                  onChange={(event) => updateDraft('apiKey', event.currentTarget.value)}
                  placeholder="输入 API 密钥"
                />
              </label>
              <div className="connection-test-row">
                <button
                  className="secondary-button"
                  disabled={!fieldsComplete || state.connectionState === 'testing'}
                  data-testid="e2e/settings/add-model-set/test-connection#button"
                  onClick={() => void testConnection()}
                  type="button"
                >
                  <AppIcon
                    name={state.connectionState === 'testing' ? 'loader' : 'play'}
                    className={state.connectionState === 'testing' ? 'spin-icon' : ''}
                  />
                  {state.connectionState === 'testing' ? '测试中' : '测试连接'}
                </button>
                {state.connectionState === 'success' ? (
                  <span className="connection-test-result is-success">
                    <AppIcon name="check" />
                    连接成功
                  </span>
                ) : null}
                {state.connectionState === 'failed' ? (
                  <span className="connection-test-result is-failed">
                    <AppIcon name="close" />
                    连接失败
                  </span>
                ) : null}
              </div>
              {failure && state.connectionState === 'failed' ? (
                <p className="connection-test-detail" role="alert">
                  {failure.message}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="model-picker">
              <div className="model-picker-toolbar">
                <div>
                  <strong>发现的模型</strong>
                  <span>
                    逐项测试文本、推理、视觉和生图；生图测试会实际生成一张图片，可能产生费用
                  </span>
                </div>
                <IconButton
                  aria-label="手动添加模型"
                  className="plain-icon-action"
                  icon="plus"
                  onClick={addManualModel}
                  testId="e2e/settings/add-model-set/add-manual-model#button"
                  title="手动添加模型"
                />
                <button
                  className="secondary-button"
                  disabled={state.discovering || state.models.length === 0}
                  data-testid="e2e/settings/add-model-set/test-all-models#button"
                  onClick={() => void testModels(state.models.map((model) => model.id))}
                  type="button"
                >
                  <AppIcon name="play" />
                  测试全部模型
                </button>
              </div>
              {state.discovering ? (
                <div className="model-picker-loading">
                  <AppIcon className="spin-icon" name="loader" />
                  正在发现模型…
                </div>
              ) : (
                <div className="model-picker-list">
                  {state.models.map((model) =>
                    model.id.startsWith('custom-model') ? (
                      <ManualModelRow
                        key={model.id}
                        model={model}
                        onChangeName={(name) => {
                          invalidateModelTest(model.id)
                          dispatch({ type: 'rename-model', modelId: model.id, name })
                        }}
                        onTest={() => void testModels([model.id])}
                        onToggle={(enabled) =>
                          dispatch({ type: 'toggle-model', modelId: model.id, enabled })
                        }
                      />
                    ) : (
                      <ModelPickerRow
                        key={model.id}
                        model={model}
                        onTest={() => void testModels([model.id])}
                        onToggle={(enabled) =>
                          dispatch({ type: 'toggle-model', modelId: model.id, enabled })
                        }
                      />
                    )
                  )}
                </div>
              )}
              {failure && !state.discovering ? (
                <p className="connection-test-detail" role="alert">
                  {failure.message}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <footer className="model-dialog-footer">
          {state.step === 'models' ? (
            <button
              className="secondary-button"
              data-testid="e2e/settings/add-model-set/back#button"
              type="button"
              onClick={() => dispatch({ type: 'back' })}
            >
              <AppIcon name="arrow-left" />
              上一步
            </button>
          ) : (
            <span />
          )}
          <div>
            <button
              className="secondary-button"
              data-testid="e2e/settings/add-model-set/cancel#button"
              type="button"
              onClick={onClose}
            >
              取消
            </button>
            {state.step === 'connection' ? (
              <>
                <button
                  className="primary-button"
                  disabled={state.connectionState !== 'success'}
                  data-testid="e2e/settings/add-model-set/next#button"
                  onClick={() => void enterModelStep()}
                  type="button"
                >
                  下一步
                </button>
              </>
            ) : (
              <button
                className="primary-button"
                disabled={!state.models.some((model) => model.enabled && model.name.trim())}
                data-testid="e2e/settings/add-model-set/save#button"
                onClick={async () => {
                  if (savePending.current) return
                  setFailure(null)
                  savePending.current = true
                  try {
                    await service.add(
                      state.draft,
                      state.models.map((model) =>
                        model.id.startsWith('custom-model')
                          ? { ...model, id: model.name.trim(), name: model.name.trim() }
                          : model
                      )
                    )
                    onSaved()
                  } catch (error) {
                    setFailure({ code: 'unknown', message: toMessage(error) })
                  } finally {
                    savePending.current = false
                  }
                }}
                type="button"
              >
                保存
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
