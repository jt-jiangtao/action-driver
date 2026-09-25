import type { ModelConnectionDraft, ModelOption, ModelTestResult } from './model-connections'

export type AddModelSetState = {
  step: 'connection' | 'models'
  draft: ModelConnectionDraft
  connectionState: 'idle' | 'testing' | 'success' | 'failed'
  models: readonly ModelOption[]
  discovering: boolean
}

export type AddModelSetAction =
  | { type: 'update-draft'; draft: ModelConnectionDraft }
  | { type: 'connection-testing' }
  | { type: 'connection-result'; ok: boolean }
  | { type: 'enter-models' }
  | { type: 'models-discovered'; models: readonly ModelOption[] }
  | { type: 'model-testing'; modelIds: readonly string[] }
  | { type: 'model-result'; results: readonly ModelTestResult[] }
  | { type: 'toggle-model'; modelId: string; enabled: boolean }
  | { type: 'add-manual-model'; model: ModelOption }
  | { type: 'rename-model'; modelId: string; name: string }
  | { type: 'back' }

export const initialAddModelSetState: AddModelSetState = {
  step: 'connection',
  draft: { name: '', protocol: 'openai-compatible', baseUrl: '', apiKey: '' },
  connectionState: 'idle',
  models: [],
  discovering: false
}

export function addModelSetReducer(
  state: AddModelSetState,
  action: AddModelSetAction
): AddModelSetState {
  switch (action.type) {
    case 'update-draft':
      return {
        ...state,
        draft: action.draft,
        connectionState: 'idle',
        models:
          state.draft.protocol !== action.draft.protocol ||
          state.draft.baseUrl !== action.draft.baseUrl ||
          state.draft.apiKey !== action.draft.apiKey
            ? []
            : state.models,
        discovering: false
      }
    case 'connection-testing':
      return { ...state, connectionState: 'testing' }
    case 'connection-result':
      return { ...state, connectionState: action.ok ? 'success' : 'failed' }
    case 'enter-models':
      return {
        ...state,
        step: 'models',
        discovering: state.models.length === 0
      }
    case 'models-discovered':
      return { ...state, models: action.models.map((model) => ({ ...model })), discovering: false }
    case 'model-testing':
      return {
        ...state,
        models: state.models.map((model) =>
          action.modelIds.includes(model.id) ? { ...model, testState: 'testing' } : model
        )
      }
    case 'model-result': {
      const results = new Map(action.results.map((result) => [result.modelId, result]))
      return {
        ...state,
        models: state.models.map((model) => {
          const result = results.get(model.id)
          return result
            ? {
                ...model,
                testState: result.state,
                capabilities: { ...model.capabilities, ...result.capabilities }
              }
            : model
        })
      }
    }
    case 'toggle-model':
      return {
        ...state,
        models: state.models.map((model) =>
          model.id === action.modelId ? { ...model, enabled: action.enabled } : model
        )
      }
    case 'add-manual-model':
      return { ...state, models: [...state.models, action.model] }
    case 'rename-model':
      return {
        ...state,
        models: state.models.map((model) =>
          model.id === action.modelId
            ? { ...model, name: action.name, testState: 'untested', capabilities: {} }
            : model
        )
      }
    case 'back':
      return { ...state, step: 'connection' }
  }
}

export function getAddModelSetViewState(state: AddModelSetState) {
  if (state.step === 'connection') return `connection-${state.connectionState}`
  if (state.discovering) return 'models-discovering'
  const testStates = state.models.map((model) => model.testState)
  if (testStates.some((testState) => testState === 'testing')) return 'models-testing'
  const successes = testStates.filter((testState) => testState === 'success').length
  const failures = testStates.filter((testState) => testState === 'failed').length
  if (successes > 0 && failures > 0) return 'models-partial-failure'
  if (successes > 0 && successes === testStates.length) return 'models-success'
  return 'models-untested'
}
