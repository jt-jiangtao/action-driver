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
import type { ModelConnectionService } from './model-connections/model-connection-service'
import { ModelServiceError } from './model-connections/model-connection-service'

export interface ModelIpcMain {
  handle(channel: string, handler: (event: unknown, input: unknown) => unknown): void
}

async function asModelResponse<T>(operation: () => Promise<T> | T): Promise<ModelIpcResponse<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error: serializeModelError(error) }
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
  service: ModelConnectionService
): void {
  ipcMain.handle(MODEL_IPC_CHANNELS.list, () =>
    asModelResponse<ModelConnectionDto[]>(() => service.list())
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testConnection, (_event, input) =>
    asModelResponse<ModelConnectionTestResultDto>(() =>
      service.testConnection(input as ModelTestRequestDto['draft'])
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.discover, (_event, input) =>
    asModelResponse<ModelOptionDto[]>(() =>
      service.discover(input as ModelTestRequestDto['draft'])
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.refresh, (_event, input) =>
    asModelResponse<ModelOptionDto[]>(() =>
      service.refresh((input as ModelDeleteRequestDto).connectionId)
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testModels, (_event, input) =>
    asModelResponse<ModelTestResultDto[]>(() => service.testModels(input as ModelTestRequestDto))
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.testConnectionModels, (_event, input) =>
    asModelResponse<ModelTestResultDto[]>(() =>
      service.testConnectionModels(input as ModelConnectionTestRequestDto)
    )
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.setModelEnabled, (_event, input) =>
    asModelResponse<void>(() => service.setModelEnabled(input as ModelSetEnabledRequestDto))
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.add, (_event, input) =>
    asModelResponse<ModelConnectionDto>(() => service.add(input as ModelAddRequestDto))
  )
  ipcMain.handle(MODEL_IPC_CHANNELS.delete, (_event, input) =>
    asModelResponse<void>(() => service.delete((input as ModelDeleteRequestDto).connectionId))
  )
}
