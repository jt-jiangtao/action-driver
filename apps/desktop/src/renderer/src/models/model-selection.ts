import type { ModelRef } from '@action-driver/contracts'
import type { ModelCapability } from '@action-driver/model-connections'
import type { ModelConnection } from './model-connections'

export type ModelSelectionState = 'loading' | 'ready' | 'empty' | 'error'
export type CapabilityDisplayState = 'success' | 'failed' | 'untested'

export interface ModelOptionItemProjection {
  id: string
  name: string
  ref: ModelRef
  disabled: boolean
  disabledReason: string | null
  visionVerified: boolean
  capabilityStates: Record<ModelCapability, CapabilityDisplayState>
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
  const projectedConnections = connections
    .map((connection) => ({
      id: connection.id,
      name: connection.name,
      models: connection.models
        .filter(
          (model) =>
            connection.protocol === 'openai-compatible' &&
            model.enabled &&
            (model.chatCandidate !== undefined
              ? model.chatCandidate
              : model.probeCandidates
                ? model.probeCandidates.includes('text')
                : !model.catalogLabels?.length &&
                  !(model.capabilities?.image_generation && !model.capabilities.text) &&
                  model.kind !== 'image')
        )
        .map((model) => {
          const displayState = (capability: ModelCapability): CapabilityDisplayState => {
            const state = model.capabilities?.[capability]?.state
            return state === undefined ? 'untested' : state === 'success' ? 'success' : 'failed'
          }
          return {
            id: model.id,
            name: model.name,
            ref: { connectionId: connection.id, modelId: model.id },
            disabled: false,
            disabledReason: null,
            visionVerified: model.capabilities?.vision?.state === 'success',
            capabilityStates: {
              text: displayState('text'),
              reasoning: displayState('reasoning'),
              vision: displayState('vision'),
              image_generation: displayState('image_generation')
            }
          }
        })
    }))
    .filter((connection) => connection.models.length > 0)
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
      : (firstSelectable?.ref ?? null)
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
