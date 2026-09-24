import { describe, expect, it } from 'vitest'
import { ModelServiceError, type ModelOptionDto } from '@actiondriver/model-connections'
import { ModelConnectionService } from '../src/model-connections/service'
import type {
  HttpRequest,
  HttpResponse,
  HttpTransport
} from '../src/model-connections/http-transport'
import type { ModelConnectionStore, StoredModelConnection } from '../src/model-connections/store'
import type { SecretCipher } from '../src/model-connections/credential-cipher'
import type {
  OpenAiClientFactory,
  OpenAiStreamChunk
} from '../src/model-connections/provider-adapters'

function memoryStore(): ModelConnectionStore {
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
                model.imageGenerationEnabled
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

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plainText) => Buffer.from(`cipher:${plainText}`).toString('base64'),
  decrypt: (cipherText) =>
    Buffer.from(cipherText, 'base64')
      .toString()
      .replace(/^cipher:/, '')
}

const draft = {
  name: '公司模型网关',
  protocol: 'openai-compatible' as const,
  baseUrl: 'https://token-plan.example.com/compatible-mode/v1',
  apiKey: 'sk-secret-value'
}

function createService(
  handler: (request: HttpRequest) => HttpResponse,
  openAiClientFactory?: OpenAiClientFactory
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
      ...(openAiClientFactory ? { openAiClientFactory } : {})
    }),
    store
  }
}

const discoveredModels: ModelOptionDto[] = [
  { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' }
]

describe('model connection service', () => {
  it('keeps one default image model and clears it when generation is disabled', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft,
      models: [
        { id: 'vision', name: 'vision', enabled: true, testState: 'success' },
        { id: 'image', name: 'image', enabled: true, testState: 'untested' }
      ]
    })
    await service.setModelImageCapability({
      connectionId: connection.id,
      modelId: 'image',
      kind: 'generation',
      enabled: true
    })
    await service.setDefaultImageModel({ connectionId: connection.id, modelId: 'image' })
    expect(await service.getDefaultImageModel()).toEqual({
      connectionId: connection.id,
      modelId: 'image'
    })
    await service.setModelImageCapability({
      connectionId: connection.id,
      modelId: 'image',
      kind: 'generation',
      enabled: false
    })
    expect(await service.getDefaultImageModel()).toBeNull()
  })

  it('preserves image flags across model refresh without generating an image', async () => {
    const { service, requests } = createService(() => ({
      status: 200,
      body: { data: [{ id: 'vision' }, { id: 'image' }] },
      text: ''
    }))
    const connection = await service.add({
      draft,
      models: [
        { id: 'vision', name: 'vision', enabled: true, testState: 'success' },
        { id: 'image', name: 'image', enabled: true, testState: 'untested' }
      ]
    })
    await service.setModelImageCapability({
      connectionId: connection.id,
      modelId: 'vision',
      kind: 'input',
      enabled: true
    })
    await service.setModelImageCapability({
      connectionId: connection.id,
      modelId: 'image',
      kind: 'generation',
      enabled: true
    })
    await service.setDefaultImageModel({ connectionId: connection.id, modelId: 'image' })
    expect(await service.refresh(connection.id)).toMatchObject([
      { id: 'vision', imageInputEnabled: true },
      { id: 'image', imageGenerationEnabled: true }
    ])
    expect(await service.getDefaultImageModel()).toEqual({
      connectionId: connection.id,
      modelId: 'image'
    })
    expect(requests.every((request) => request.url.endsWith('/models'))).toBe(true)
  })

  it('streams a duplicate model id through the exact selected connection', async () => {
    const clientOptions: Array<Record<string, unknown>> = []
    const chunks: OpenAiStreamChunk[] = [
      {
        choices: [{ delta: { content: 'selected ' }, finish_reason: null, index: 0 }]
      },
      {
        choices: [{ delta: { content: 'answer' }, finish_reason: 'stop', index: 0 }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
      }
    ]
    const openAiClientFactory = ((options: Record<string, unknown>) => {
      clientOptions.push(options)
      return {
        chat: {
          completions: {
            create: () => ({
              withResponse: async () => ({
                data: {
                  async *[Symbol.asyncIterator]() {
                    yield* chunks
                  }
                },
                response: { status: 200 },
                request_id: 'provider-request-1'
              })
            })
          }
        }
      }
    }) as OpenAiClientFactory
    const { service, requests } = createService(
      () => ({ status: 200, body: {}, text: '' }),
      openAiClientFactory
    )
    await service.add({
      draft: { ...draft, name: 'First', apiKey: 'first-secret' },
      models: [{ id: 'shared-model', name: 'shared-model', enabled: true, testState: 'success' }]
    })
    const second = await service.add({
      draft: { ...draft, name: 'Second', apiKey: 'second-secret' },
      models: [{ id: 'shared-model', name: 'shared-model', enabled: true, testState: 'success' }]
    })

    const events = []
    for await (const event of service.stream({
      model: { connectionId: second.id, modelId: 'shared-model' },
      requestId: 'request-1',
      taskId: 'task-1',
      messages: [{ role: 'user', content: 'hello' }],
      parameters: { temperature: 0 }
    })) {
      events.push(event)
    }

    expect(clientOptions).toEqual([
      expect.objectContaining({ apiKey: 'second-secret', baseURL: draft.baseUrl })
    ])
    expect(requests).toEqual([])
    expect(events).toMatchObject([
      { kind: 'content', delta: 'selected ' },
      { kind: 'content', delta: 'answer' },
      { kind: 'end', content: 'selected answer' }
    ])
    expect(JSON.stringify(events)).not.toContain('second-secret')
    expect(JSON.stringify(events)).not.toContain(draft.baseUrl)
  })

  it('executes a duplicate model id through the selected connection only', async () => {
    const { service, requests } = createService(() => ({
      status: 200,
      body: { choices: [{ message: { content: 'selected connection answer' } }] },
      text: ''
    }))
    await service.add({
      draft: { ...draft, name: 'First', apiKey: 'first-secret' },
      models: [{ id: 'shared-model', name: 'shared-model', enabled: true, testState: 'success' }]
    })
    const second = await service.add({
      draft: { ...draft, name: 'Second', apiKey: 'second-secret' },
      models: [{ id: 'shared-model', name: 'shared-model', enabled: true, testState: 'success' }]
    })

    const result = await service.complete({
      model: { connectionId: second.id, modelId: 'shared-model' },
      requestId: 'request-1',
      taskId: 'task-1',
      messages: [{ role: 'user', content: 'hello' }],
      parameters: { temperature: 0 }
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Bearer second-secret')
    expect(result).toMatchObject({ ok: true, value: { content: 'selected connection answer' } })
    expect(JSON.stringify(result)).not.toContain('second-secret')
  })

  it.each([
    {
      label: 'disabled',
      protocol: 'openai-compatible' as const,
      model: { id: 'blocked', name: 'blocked', enabled: false, testState: 'success' as const },
      message: 'is disabled'
    },
    {
      label: 'unsupported',
      protocol: 'openai-compatible' as const,
      model: { id: 'blocked', name: 'blocked', enabled: true, testState: 'unsupported' as const },
      message: 'does not support text'
    },
    {
      label: 'anthropic',
      protocol: 'anthropic' as const,
      model: { id: 'blocked', name: 'blocked', enabled: true, testState: 'success' as const },
      message: 'Agent 调用暂未接入'
    }
  ])('rejects a $label model before network I/O', async ({ protocol, model, message }) => {
    const { service, requests } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft: { ...draft, protocol },
      models: [model]
    })

    const consume = async () => {
      for await (const event of service.stream({
        model: { connectionId: connection.id, modelId: model.id },
        requestId: 'request-1',
        taskId: 'task-1',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })) {
        void event
      }
    }
    await expect(consume()).rejects.toMatchObject({
      code: 'invalid-request',
      message: expect.stringContaining(message)
    })
    expect(requests).toEqual([])
  })

  it('rejects a missing connection or model before network I/O', async () => {
    const { service, requests } = createService(() => ({ status: 200, body: {}, text: '' }))

    await expect(
      service.complete({
        model: { connectionId: 'missing', modelId: 'shared-model' },
        requestId: 'request-1',
        taskId: 'task-1',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })
    ).rejects.toBeInstanceOf(ModelServiceError)

    const connection = await service.add({ draft, models: discoveredModels })
    await expect(
      service.complete({
        model: { connectionId: connection.id, modelId: 'missing' },
        requestId: 'request-2',
        taskId: 'task-2',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })
    ).rejects.toBeInstanceOf(ModelServiceError)
    expect(requests).toEqual([])
  })

  it('stores a connection with an encrypted key and only exposes a hint', async () => {
    const { service, store } = createService(() => ({ status: 200, body: {}, text: '' }))

    const created = await service.add({ draft, models: discoveredModels })

    expect(created).toMatchObject({ name: '公司模型网关', apiKeyHint: '••••alue' })
    expect(JSON.stringify(created)).not.toContain('sk-secret-value')
    expect(JSON.stringify(store.read())).not.toContain('sk-secret-value')
    await expect(service.list()).resolves.toEqual([created])
  })

  it('classifies connection failures for the renderer', async () => {
    const { service } = createService((request) =>
      request.url.endsWith('/models')
        ? {
            status: 401,
            body: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' },
            text: ''
          }
        : { status: 200, body: {}, text: '' }
    )

    await expect(service.testConnection(draft)).resolves.toEqual({
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid API-key provided.' }
    })
  })

  it('redacts normalized and saved credentials from provider failures', async () => {
    const { service } = createService((request) => ({
      status: 401,
      body: { message: `Rejected ${request.headers.authorization}` },
      text: ''
    }))

    const draftResult = await service.testConnection({
      ...draft,
      apiKey: '  sk-secret-value  '
    })
    expect(JSON.stringify(draftResult)).not.toContain('sk-secret-value')

    const created = await service.add({ draft, models: discoveredModels })
    await expect(service.refresh(created.id)).rejects.toMatchObject({
      message: 'Rejected [redacted]'
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
    expect((await service.list())[0]!.models.map((model) => model.id)).toEqual([
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
        {
          id: 'qwen-image-3.0-pro',
          name: 'qwen-image-3.0-pro',
          enabled: true,
          testState: 'untested'
        }
      ]
    })
    await service.testConnectionModels({
      connectionId: created.id,
      modelIds: ['qwen3.7-plus', 'qwen-image-3.0-pro']
    })

    expect((await service.list())[0]!.models.map((model) => model.testState)).toEqual([
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
    expect((await service.list())[0]!.models[0]!.enabled).toBe(false)

    await expect(service.delete(created.id)).resolves.toBeUndefined()
    await expect(service.list()).resolves.toEqual([])

    await expect(
      service.testConnectionModels({
        connectionId: 'missing-connection',
        modelIds: ['qwen3.7-plus']
      })
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
