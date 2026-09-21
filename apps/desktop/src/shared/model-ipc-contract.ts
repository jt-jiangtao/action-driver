export type {
  ModelAddRequestDto,
  ModelConnectionDto,
  ModelConnectionDraftDto,
  ModelConnectionTestRequestDto,
  ModelConnectionTestResultDto,
  ModelDeleteRequestDto,
  ModelFailure,
  ModelFailureCode,
  ModelIpcError,
  ModelIpcResponse,
  ModelOptionDto,
  ModelProbeState,
  ModelProtocol,
  ModelSetEnabledRequestDto,
  ModelTestRequestDto,
  ModelTestResultDto,
  ModelTestState
} from '@actiondriver/model-connections'

export const MODEL_IPC_CHANNELS = {
  list: 'actiondriver:model-connections:list',
  testConnection: 'actiondriver:model-connections:test-connection',
  discover: 'actiondriver:model-connections:discover',
  refresh: 'actiondriver:model-connections:refresh',
  testModels: 'actiondriver:model-connections:test-models',
  testConnectionModels: 'actiondriver:model-connections:test-connection-models',
  setModelEnabled: 'actiondriver:model-connections:set-model-enabled',
  add: 'actiondriver:model-connections:add',
  delete: 'actiondriver:model-connections:delete'
} as const
