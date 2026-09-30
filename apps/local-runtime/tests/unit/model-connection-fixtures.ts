import type { ModelOptionDto } from '@action-driver/model-connections'
import { ModelConnectionService } from '../../src/model-connections/service'
import type {
  HttpRequest,
  HttpResponse,
  HttpTransport
} from '@action-driver/model-provider-runtime/http-transport'
import type { ModelConnectionStore, StoredModelConnection } from '../../src/model-connections/store'
import type { SecretCipher } from '../../src/model-connections/credential-cipher'
import type {
  ImageResolver,
  OpenAiClientFactory
} from '@action-driver/model-provider-runtime/provider-adapters'

export function memoryStore(): ModelConnectionStore {
  let connections: StoredModelConnection[] = []
  let defaultImageModel: { connectionId: string; modelId: string } | null = null
  return {
    read: () => connections,
    write: (next) => {
      connections = next.map((connection) => ({ ...connection, models: [...connection.models] }))
      if (
        defaultImageModel &&
        !connections.some(
          (connection) =>
            connection.id === defaultImageModel?.connectionId &&
            connection.models.some(
              (model) =>
                model.id === defaultImageModel?.modelId &&
                model.enabled &&
                model.capabilities?.image_generation?.state === 'success'
            )
        )
      )
        defaultImageModel = null
    },
    readDefaultImageModel: () => defaultImageModel,
    writeDefaultImageModel: (model) => {
      defaultImageModel = model
    }
  }
}

export const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plainText) => Buffer.from(`cipher:${plainText}`).toString('base64'),
  decrypt: (cipherText) =>
    Buffer.from(cipherText, 'base64')
      .toString()
      .replace(/^cipher:/, '')
}

export const draft = {
  name: '公司模型网关',
  protocol: 'openai-compatible' as const,
  baseUrl: 'https://token-plan.example.com/compatible-mode/v1',
  apiKey: 'sk-secret-value'
}

export function createService(
  handler: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>,
  openAiClientFactory?: OpenAiClientFactory,
  imageResolver?: ImageResolver
) {
  const requests: HttpRequest[] = []
  const transport: HttpTransport = {
    async request(request) {
      requests.push(request)
      return handler(request)
    }
  }
  const store = memoryStore()
  return {
    requests,
    service: new ModelConnectionService({
      store,
      cipher,
      transport,
      ...(openAiClientFactory ? { openAiClientFactory } : {}),
      ...(imageResolver ? { imageResolver } : {})
    }),
    store
  }
}

export const discoveredModels: ModelOptionDto[] = [
  {
    id: 'qwen3.7-plus',
    name: 'qwen3.7-plus',
    enabled: true,
    testState: 'success',
    capabilities: { text: { state: 'success', source: 'probe' } }
  }
]

export const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII=',
  'base64'
)
export const probePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC',
  'base64'
)
