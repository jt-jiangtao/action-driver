import type { ModelRef } from '@actiondriver/contracts'
import type { ModelConnection } from './model-connections'

export type ModelSelectionState = 'loading' | 'ready' | 'empty' | 'error'

export interface ModelOptionItemProjection {
  id: string
  name: string
  ref: ModelRef
  disabled: boolean
  disabledReason: string | null
}

export interface ModelConnectionOption {
  id: string
  name: string
  models: readonly ModelOptionItemProjection[]
}

export interface ModelSelectionProjection {
  state: ModelSelectionState
  connections: readonly ModelConnectionOption[]
  selected: ModelRef | null
  error: string | null
}

export const loadingModelSelection: ModelSelectionProjection = {
  state: 'loading',
  connections: [],
  selected: null,
  error: null
}

export function failedModelSelection(error: unknown): ModelSelectionProjection {
  return {
    state: 'error',
    connections: [],
    selected: null,
    error: error instanceof Error ? error.message : '加载模型失败'
  }
}

export function toModelSelectionProjection(
  connections: readonly ModelConnection[],
  selected: ModelRef | null
): ModelSelectionProjection {
  const projectedConnections = connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    models: connection.models.map((model) => {
      const disabledReason = getDisabledReason(connection, model)
      return {
        id: model.id,
        name: model.name,
        ref: { connectionId: connection.id, modelId: model.id },
        disabled: disabledReason !== null,
        disabledReason
      }
    })
  }))
  const candidate: ModelSelectionProjection = {
    state: projectedConnections.length === 0 ? 'empty' : 'ready',
    connections: projectedConnections,
    selected,
    error: null
  }
  const selectedModel = findSelectedModel(candidate)
  const firstSelectable = projectedConnections
    .flatMap((connection) => connection.models)
    .find((model) => !model.disabled)

  return {
    ...candidate,
    selected: selected
      ? selectedModel && !selectedModel.model.disabled
        ? selected
        : null
      : firstSelectable?.ref ?? null
  }
}

export function findSelectedModel(projection: ModelSelectionProjection) {
  if (!projection.selected) return null
  const connection = projection.connections.find(
    (candidate) => candidate.id === projection.selected?.connectionId
  )
  const model = connection?.models.find(
    (candidate) => candidate.id === projection.selected?.modelId
  )
  return connection && model ? { connection, model } : null
}

function getDisabledReason(
  connection: ModelConnection,
  model: ModelConnection['models'][number]
): string | null {
  if (connection.protocol === 'anthropic') return 'Agent 调用暂未接入'
  if (!model.enabled) return '模型已停用'
  if (model.testState === 'failed') return '模型测试失败'
  if (model.testState === 'unsupported') return '不支持文本生成'
  if (model.testState !== 'success') return '模型尚未通过测试'
  return null
}
