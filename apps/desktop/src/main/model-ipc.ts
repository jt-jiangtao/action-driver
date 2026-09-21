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
import type { InteractionLogger } from '@actiondriver/observability'
import type { ModelConnectionService } from './model-connections/model-connection-service'
import { ModelServiceError } from './model-connections/model-connection-service'

export interface ModelIpcMain {
  handle(channel: string, handler: (event: unknown, input: unknown) => unknown): void
}

async function asModelResponse<T>(
  channel: string,
  operation: () => Promise<T> | T,
  interactions?: InteractionLogger
): Promise<ModelIpcResponse<T>> {
  const finish = interactions?.start({
    transport: 'ipc',
    direction: 'renderer->service',
    operation: channel
  })
  try {
    const value = await operation()
    finish?.({ outcome: 'ok', payload: value })
    return { ok: true, value }
  } catch (error) {
    const serialized = serializeModelError(error)
    finish?.({ outcome: 'error', error: { code: serialized.code, message: serialized.message } })
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
  service: ModelConnectionService,
  interactions?: InteractionLogger
): void {
  ipcMain.handle(MODEL_IPC_CHANNELS.list, () =>
    asModelResponse<ModelConnectionDto[]>(MODEL_IPC_CHANNELS.list, () => service.list(), interactions)
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testConnection, (_event, input) =>
    asModelResponse<ModelConnectionTestResultDto>(
      MODEL_IPC_CHANNELS.testConnection,
      () => service.testConnection(input as ModelTestRequestDto['draft']),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.discover, (_event, input) =>
    asModelResponse<ModelOptionDto[]>(
      MODEL_IPC_CHANNELS.discover,
      () => service.discover(input as ModelTestRequestDto['draft']),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.refresh, (_event, input) =>
    asModelResponse<ModelOptionDto[]>(
      MODEL_IPC_CHANNELS.refresh,
      () => service.refresh((input as ModelDeleteRequestDto).connectionId),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testModels, (_event, input) =>
    asModelResponse<ModelTestResultDto[]>(
      MODEL_IPC_CHANNELS.testModels,
      () => service.testModels(input as ModelTestRequestDto),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testConnectionModels, (_event, input) =>
    asModelResponse<ModelTestResultDto[]>(
      MODEL_IPC_CHANNELS.testConnectionModels,
      () => service.testConnectionModels(input as ModelConnectionTestRequestDto),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.setModelEnabled, (_event, input) =>
    asModelResponse<void>(
      MODEL_IPC_CHANNELS.setModelEnabled,
      () => service.setModelEnabled(input as ModelSetEnabledRequestDto),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.add, (_event, input) =>
    asModelResponse<ModelConnectionDto>(
      MODEL_IPC_CHANNELS.add,
      () => service.add(input as ModelAddRequestDto),
      interactions
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.delete, (_event, input) =>
    asModelResponse<void>(
      MODEL_IPC_CHANNELS.delete,
      () => service.delete((input as ModelDeleteRequestDto).connectionId),
      interactions
    )
  )
}
