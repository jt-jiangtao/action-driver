import { describe, expect, it } from 'vitest'
import type { ModelOptionDto } from '../../shared/model-ipc-contract'
import { createModelConnectionStore, type FileSystemPort } from './connection-store'
import type { HttpRequest, HttpResponse, HttpTransport } from './http-transport'
import {
  ModelConnectionService,
  ModelServiceError
} from './model-connection-service'
import type { SecretCipher } from './secret-cipher'

function memoryFileSystem(): FileSystemPort {
  const files = new Map<string, string>()
  return {
    exists: (path) => files.has(path),
    readFile: (path) => files.get(path) ?? '',
    writeFile: (path, contents) => {
      files.set(path, contents)
    },
    mkdir: () => undefined,
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    }
  }
}

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plainText) => Buffer.from(`cipher:${plainText}`).toString('base64'),
  decrypt: (cipherText) => Buffer.from(cipherText, 'base64').toString().replace(/^cipher:/, '')
}

const draft = {
  name: '公司模型网关',
  protocol: 'openai-compatible' as const,
  baseUrl: 'https://token-plan.example.com/compatible-mode/v1',
  apiKey: 'sk-secret-value'
}

function createService(handler: (request: HttpRequest) => HttpResponse) {
  const requests: HttpRequest[] = []
  const transport: HttpTransport = {
    async request(request) {
      requests.push(request)
      return handler(request)
    }
  }
  const store = createModelConnectionStore({
    filePath: '/data/model-connections.json',
    fs: memoryFileSystem()
  })
  return {
    requests,
    service: new ModelConnectionService({ store, cipher, transport }),
    store
  }
}

const discoveredModels: ModelOptionDto[] = [
  { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' }
]

describe('model connection service', () => {
  it('stores a connection with an encrypted key and only exposes a hint', async () => {
    const { service, store } = createService(() => ({ status: 200, body: {}, text: '' }))

    const created = await service.add({ draft, models: discoveredModels })

    expect(created).toMatchObject({ name: '公司模型网关', apiKeyHint: '••••alue' })
    expect(JSON.stringify(created)).not.toContain('sk-secret-value')
    expect(JSON.stringify(store.read())).not.toContain('sk-secret-value')
    expect(service.list()).toEqual([created])
  })

  it('classifies connection failures for the renderer', async () => {
    const { service } = createService((request) =>
      request.url.endsWith('/models')
        ? { status: 401, body: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, text: '' }
        : { status: 200, body: {}, text: '' }
    )

    await expect(service.testConnection(draft)).resolves.toEqual({
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid API-key provided.' }
    })
  })

  it('discovers models and persists refreshed results for saved connections', async () => {
    const { service } = createService((request) =>
      request.url.endsWith('/models')
        ? {
            status: 200,
            body: { data: [{ id: 'qwen3.7-plus' }, { id: 'qwen3.8-max' }] },
            text: ''
          }
        : { status: 200, body: {}, text: '' }
    )

    await expect(service.discover(draft)).resolves.toEqual([
      { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'untested' },
      { id: 'qwen3.8-max', name: 'qwen3.8-max', enabled: true, testState: 'untested' }
    ])

    const created = await service.add({ draft, models: discoveredModels })
    const refreshed = await service.refresh(created.id)
    expect(refreshed.map((model) => model.id)).toEqual(['qwen3.7-plus', 'qwen3.8-max'])
    expect(service.list()[0]!.models.map((model) => model.id)).toEqual([
      'qwen3.7-plus',
      'qwen3.8-max'
    ])
  })

  it('separates unsupported models from failing ones and persists test results', async () => {
    const { service } = createService((request) => {
      if (request.url.endsWith('/models')) {
        return { status: 200, body: { data: [{ id: 'qwen3.7-plus' }] }, text: '' }
      }
      const body = request.body as { model: string }
      if (body.model === 'qwen-image-3.0-pro') {
        return {
          status: 400,
          body: { code: 'InvalidParameter', message: 'Input should be a valid list' },
          text: ''
        }
      }
      if (body.model === 'missing-model') {
        return {
          status: 404,
          body: { error: { message: 'Model not exist.', code: 'model_not_found' } },
          text: ''
        }
      }
      return { status: 200, body: { choices: [] }, text: '' }
    })

    await expect(
      service.testModels({
        draft,
        modelIds: ['qwen3.7-plus', 'qwen-image-3.0-pro', 'missing-model']
      })
    ).resolves.toEqual([
      { modelId: 'qwen3.7-plus', state: 'success' },
      { modelId: 'qwen-image-3.0-pro', state: 'unsupported' },
      { modelId: 'missing-model', state: 'failed' }
    ])

    const created = await service.add({
      draft,
      models: [
        { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'untested' },
        { id: 'qwen-image-3.0-pro', name: 'qwen-image-3.0-pro', enabled: true, testState: 'untested' }
      ]
    })
    await service.testConnectionModels({
      connectionId: created.id,
      modelIds: ['qwen3.7-plus', 'qwen-image-3.0-pro']
    })

    expect(service.list()[0]!.models.map((model) => model.testState)).toEqual([
      'success',
      'unsupported'
    ])
  })

  it('persists enablement, deletion, and rejects unknown connections', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const created = await service.add({ draft, models: discoveredModels })

    await service.setModelEnabled({
      connectionId: created.id,
      modelId: 'qwen3.7-plus',
      enabled: false
    })
    expect(service.list()[0]!.models[0]!.enabled).toBe(false)

    await expect(service.delete(created.id)).resolves.toBeUndefined()
    expect(service.list()).toEqual([])

    await expect(
      service.testConnectionModels({ connectionId: 'missing-connection', modelIds: ['qwen3.7-plus'] })
    ).rejects.toBeInstanceOf(ModelServiceError)
  })

  it('rejects invalid drafts before touching the network', async () => {
    const { service, requests } = createService(() => ({ status: 200, body: {}, text: '' }))

    await expect(
      service.testConnection({ ...draft, baseUrl: 'ftp://example.com' })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(requests).toEqual([])
  })
})
