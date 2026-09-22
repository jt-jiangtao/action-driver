import type {
  ModelAddRequestDto,
  ModelConnectionTestRequestDto,
  ModelConnectionTestResultDto,
  ModelConnectionDto,
  ModelDeleteRequestDto,
  ModelIpcError,
  ModelIpcResponse,
  ModelOptionDto,
  ModelSetEnabledRequestDto,
  ModelTestRequestDto,
  ModelTestResultDto
} from '../shared/model-ipc-contract'
import { MODEL_IPC_CHANNELS } from '../shared/model-ipc-contract'
import type { InteractionLogRecorder } from '@actiondriver/observability'
import type { ModelConnectionServicePort } from '@actiondriver/model-connections'
import { ModelServiceError } from '@actiondriver/model-connections'
import { startIpcInteraction } from './logging'

export interface ModelIpcMain {
  handle(channel: string, handler: (event: unknown, input: unknown) => unknown): void
}

async function asModelResponse<T>(
  channel: string,
  input: unknown,
  operation: () => Promise<T> | T,
  interactions?: InteractionLogRecorder,
  secretPaths: string[] = []
): Promise<ModelIpcResponse<T>> {
  const finish = await startIpcInteraction(interactions, channel, input, secretPaths)
  try {
    const value = await operation()
    await finish?.({ outcome: 'ok', response: { kind: 'json', value } })
    return { ok: true, value }
  } catch (error) {
    const serialized = serializeModelError(error)
    await finish?.({
      outcome: 'error',
      error: { code: serialized.code, message: serialized.message }
    })
    return { ok: false, error: serialized }
  }
}

export function serializeModelError(error: unknown): ModelIpcError {
  if (error instanceof ModelServiceError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error)
  }
}

export function registerModelIpcHandlers(
  ipcMain: ModelIpcMain,
  service: ModelConnectionServicePort,
  interactions?: InteractionLogRecorder
): void {
  ipcMain.handle(MODEL_IPC_CHANNELS.list, () =>
    asModelResponse<ModelConnectionDto[]>(
      MODEL_IPC_CHANNELS.list,
      null,
      () => service.list(),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testConnection, (_event, input) =>
    asModelResponse<ModelConnectionTestResultDto>(
      MODEL_IPC_CHANNELS.testConnection,
      input,
      () => service.testConnection(input as ModelTestRequestDto['draft']),
      interactions,
      ['apiKey']
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.discover, (_event, input) =>
    asModelResponse<ModelOptionDto[]>(
      MODEL_IPC_CHANNELS.discover,
      input,
      () => service.discover(input as ModelTestRequestDto['draft']),
      interactions,
      ['apiKey']
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.refresh, (_event, input) =>
    asModelResponse<ModelOptionDto[]>(
      MODEL_IPC_CHANNELS.refresh,
      input,
      () => service.refresh((input as ModelDeleteRequestDto).connectionId),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testModels, (_event, input) =>
    asModelResponse<ModelTestResultDto[]>(
      MODEL_IPC_CHANNELS.testModels,
      input,
      () => service.testModels(input as ModelTestRequestDto),
      interactions,
      ['draft.apiKey']
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testConnectionModels, (_event, input) =>
    asModelResponse<ModelTestResultDto[]>(
      MODEL_IPC_CHANNELS.testConnectionModels,
      input,
      () => service.testConnectionModels(input as ModelConnectionTestRequestDto),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.setModelEnabled, (_event, input) =>
    asModelResponse<void>(
      MODEL_IPC_CHANNELS.setModelEnabled,
      input,
      () => service.setModelEnabled(input as ModelSetEnabledRequestDto),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.add, (_event, input) =>
    asModelResponse<ModelConnectionDto>(
      MODEL_IPC_CHANNELS.add,
      input,
      () => service.add(input as ModelAddRequestDto),
      interactions,
      ['draft.apiKey']
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.delete, (_event, input) =>
    asModelResponse<void>(
      MODEL_IPC_CHANNELS.delete,
      input,
      () => service.delete((input as ModelDeleteRequestDto).connectionId),
      interactions
    )
  )
}
