import { describe, expect, it, vi } from 'vitest'
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
  ImageResolver,
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
                model.id === defaultImageModel?.modelId && model.enabled && model.kind === 'image'
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

const discoveredModels: ModelOptionDto[] = [
  { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' }
]

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII=',
  'base64'
)

describe('model connection service', () => {
  it('tests each listed Token Plan capability and keeps their results separate', async () => {
    const { service, requests } = createService((request) => {
      const body = request.body as { messages?: Array<{ content?: unknown }>; enable_thinking?: boolean }
      const content = body.messages?.[0]?.content
      const message = Array.isArray(content)
        ? { content: 'red' }
        : body.enable_thinking
          ? { content: '42', reasoning_content: 'I added 17 and 25.' }
          : { content: 'OK' }
      return { status: 200, body: { choices: [{ message }] }, text: '' }
    })
    const results = await service.testModels({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      modelIds: ['qwen3.8-max'],
      capabilityTest: true
    })
    expect(results[0]?.capabilities?.text?.state).toBe('success')
    expect(results[0]?.capabilities?.reasoning?.state).toBe('success')
    expect(results[0]?.capabilities?.vision?.state).toBe('success')
    expect(requests).toHaveLength(3)
  })

  it('does not probe catalog audio or video models', async () => {
    const { service, requests } = createService(() => {
      throw new Error('Audio and video tests must not call a provider')
    })
    const results = await service.testModels({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      modelIds: ['qwen-audio-3.0-asr-flash', 'happyhorse-1.1-t2v'],
      capabilityTest: true
    })
    expect(results.map((result) => result.capabilities)).toEqual([{}, {}])
    expect(requests).toHaveLength(0)
  })

  it('uses a verified image capability even when the legacy model kind is chat', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (!url.endsWith('/images/generations')) throw new Error('Wrong image endpoint')
      return new Response(JSON.stringify({ data: [{ b64_json: validPng.toString('base64') }] }), {
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const { service } = createService(() => ({ status: 500, body: {}, text: '' }))
      const connection = await service.add({
        draft,
        models: [
          {
            id: 'dual-model',
            name: 'dual-model',
            enabled: true,
            testState: 'success',
            kind: 'chat',
            capabilities: {
              image_generation: { state: 'success', source: 'probe' }
            }
          }
        ]
      })
      const model = { connectionId: connection.id, modelId: 'dual-model' }
      await service.setDefaultImageModel(model)
      expect(await service.generateImage({ model, prompt: 'cat' })).toEqual(new Uint8Array(validPng))
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses the Images API to test image models and does not send a chat completion', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (!url.endsWith('/images/generations')) throw new Error('Unexpected image test URL')
      return new Response(JSON.stringify({ data: [{ b64_json: validPng.toString('base64') }] }), {
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const { service, requests } = createService(() => ({ status: 500, body: {}, text: '' }))
      const results = await service.testModels({
        draft,
        modelIds: ['image-model'],
        imageModels: [{ modelId: 'image-model', api: 'openai-images' }]
      })
      expect(results).toEqual([{ modelId: 'image-model', state: 'success' }])
      expect(requests).toHaveLength(0)
      expect(fetch.mock.calls[0]?.[0]).toMatch(/\/images\/generations$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails an image model test when the endpoint returns bytes that are not an image', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }),
          { status: 200 }
        )
    )
    try {
      const { service } = createService(() => ({ status: 500, body: {}, text: '' }))
      await expect(
        service.testModels({
          draft,
          modelIds: ['image-model'],
          imageModels: [{ modelId: 'image-model', api: 'openai-images' }]
        })
      ).resolves.toEqual([{ modelId: 'image-model', state: 'failed' }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses the Token Plan endpoint and downloads its test image', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/services/aigc/multimodal-generation/generation'))
        return new Response(
          JSON.stringify({
            output: {
              choices: [
                { message: { content: [{ image: 'https://images.example.com/test.png' }] } }
              ]
            }
          }),
          { status: 200 }
        )
      if (url === 'https://images.example.com/test.png')
        return new Response(validPng, { status: 200 })
      throw new Error('Unexpected image test URL')
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const { service, requests } = createService(() => ({ status: 500, body: {}, text: '' }))
      const results = await service.testModels({
        draft: {
          ...draft,
          baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
        },
        modelIds: ['wan-image'],
        imageModels: [{ modelId: 'wan-image', api: 'token-plan' }]
      })
      expect(results).toEqual([{ modelId: 'wan-image', state: 'success' }])
      expect(requests).toHaveLength(0)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends an image to a chat model without a local image-input flag', async () => {
    const { service, requests } = createService(
      () => ({
        status: 200,
        body: { choices: [{ message: { content: '看到了图片' } }] },
        text: ''
      }),
      undefined,
      async () => ({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png' })
    )
    const connection = await service.add({
      draft,
      models: [{ id: 'chat', name: 'chat', enabled: true, testState: 'success' }]
    })
    const outcome = await service.complete({
      model: { connectionId: connection.id, modelId: 'chat' },
      requestId: 'request-image',
      taskId: 'task-image',
      messages: [
        {
          role: 'user',
          content: [
            { kind: 'text', text: '这是什么？' },
            {
              kind: 'image',
              asset: {
                assetId: 'asset-1',
                sessionId: 'session-1',
                mimeType: 'image/png',
                width: 1,
                height: 1,
                byteLength: 3,
                source: 'upload'
              }
            }
          ]
        }
      ],
      parameters: {}
    })
    expect(outcome).toMatchObject({ ok: true })
    expect(requests[0]?.body).toMatchObject({
      messages: [
        {
          content: [
            { type: 'text', text: '这是什么？' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
          ]
        }
      ]
    })
  })

  it('uses the default image model without a generation capability flag', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft,
      models: [
        { id: 'vision', name: 'vision', enabled: true, testState: 'success' },
        { id: 'image', name: 'image', kind: 'image', enabled: true, testState: 'untested' }
      ]
    })
    await service.setDefaultImageModel({ connectionId: connection.id, modelId: 'image' })
    expect(await service.getDefaultImageModel()).toEqual({
      connectionId: connection.id,
      modelId: 'image'
    })
    await service.setModelEnabled({ connectionId: connection.id, modelId: 'image', enabled: false })
    expect(await service.getDefaultImageModel()).toBeNull()
  })

  it('rejects a chat model as the default image model', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft,
      models: [{ id: 'chat', name: 'chat', kind: 'chat', enabled: true, testState: 'success' }]
    })
    await expect(
      service.setDefaultImageModel({ connectionId: connection.id, modelId: 'chat' })
    ).rejects.toThrow('Image model is unavailable')
  })

  it('rejects an image model on the chat completion path', async () => {
    const { service, requests } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft,
      models: [{ id: 'image', name: 'image', kind: 'image', enabled: true, testState: 'success' }]
    })
    await expect(
      service.complete({
        model: { connectionId: connection.id, modelId: 'image' },
        requestId: 'request',
        taskId: 'task',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })
    ).rejects.toThrow('for image generation')
    expect(requests).toHaveLength(0)
  })

  it('clears the image default and test result when an image model becomes a chat model', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft,
      models: [{ id: 'image', name: 'image', kind: 'image', enabled: true, testState: 'success' }]
    })
    await service.setDefaultImageModel({ connectionId: connection.id, modelId: 'image' })
    await service.setModelKind({ connectionId: connection.id, modelId: 'image', kind: 'chat' })
    expect(await service.getDefaultImageModel()).toBeNull()
    expect((await service.list())[0]?.models[0]).toMatchObject({
      kind: 'chat',
      testState: 'untested'
    })
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

  it('keeps a model-selected image API across refresh without changing the default', async () => {
    const { service } = createService(() => ({
      status: 200,
      body: { data: [{ id: 'wan2.7-image' }] },
      text: ''
    }))
    const connection = await service.add({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      models: [{ id: 'wan2.7-image', name: 'wan2.7-image', enabled: true, testState: 'untested' }]
    })
    await service.setModelImageCapability({
      connectionId: connection.id,
      modelId: 'wan2.7-image',
      kind: 'generation',
      enabled: true
    })
    await service.setDefaultImageModel({ connectionId: connection.id, modelId: 'wan2.7-image' })
    await service.setModelImageGenerationApi({
      connectionId: connection.id,
      modelId: 'wan2.7-image',
      api: 'token-plan'
    })
    expect(await service.refresh(connection.id)).toMatchObject([
      { id: 'wan2.7-image', imageGenerationApi: 'token-plan', imageGenerationEnabled: true }
    ])
    expect(await service.getDefaultImageModel()).toEqual({
      connectionId: connection.id,
      modelId: 'wan2.7-image'
    })
  })

  it('rejects Token Plan on an unrelated host and rejects an unknown API value', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft,
      models: [{ id: 'image', name: 'image', kind: 'image', enabled: true, testState: 'untested' }]
    })
    await expect(
      service.setModelImageGenerationApi({
        connectionId: connection.id,
        modelId: 'image',
        api: 'token-plan'
      })
    ).rejects.toThrow('Token Plan')
    await expect(
      service.setModelImageGenerationApi({
        connectionId: connection.id,
        modelId: 'image',
        api: 'unknown' as 'token-plan'
      })
    ).rejects.toThrow('image generation API')
  })

  it('rejects a Token Plan model supplied during connection creation on an unrelated host', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    await expect(
      service.add({
        draft,
        models: [
          {
            id: 'image',
            name: 'image',
            enabled: true,
            testState: 'untested',
            imageGenerationEnabled: true,
            imageGenerationApi: 'token-plan'
          }
        ]
      })
    ).rejects.toThrow('Token Plan')
  })

  it('routes the same default model through its selected image API', async () => {
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII=',
      'base64'
    )
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/images/generations'))
        return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }))
      if (url.endsWith('/multimodal-generation/generation'))
        return new Response(
          JSON.stringify({
            output: {
              choices: [{ message: { content: [{ image: 'https://cdn.example/image.png' }] } }]
            }
          })
        )
      if (url === 'https://cdn.example/image.png') return new Response(new Uint8Array(bytes))
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
      const connection = await service.add({
        draft: {
          ...draft,
          baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
        },
        models: [
          {
            id: 'wan2.7-image',
            name: 'wan2.7-image',
            enabled: true,
            testState: 'untested',
            imageGenerationEnabled: true
          }
        ]
      })
      const model = { connectionId: connection.id, modelId: 'wan2.7-image' }
      await service.setDefaultImageModel(model)
      expect(await service.generateImage({ model, prompt: 'cat' })).toEqual(new Uint8Array(bytes))
      await service.setModelImageGenerationApi({ ...model, api: 'token-plan' })
      expect(await service.generateImage({ model, prompt: 'cat' })).toEqual(new Uint8Array(bytes))
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations',
        'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        'https://cdn.example/image.png'
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects an in-flight image after its default model is disabled', async () => {
    let releaseProvider!: (response: Response) => void
    let providerStarted!: () => void
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        providerStarted()
        return new Promise<Response>((resolve) => {
          releaseProvider = resolve
        })
      })
    )
    try {
      const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
      const connection = await service.add({
        draft,
        models: [
          {
            id: 'image',
            name: 'image',
            enabled: true,
            testState: 'untested',
            imageGenerationEnabled: true
          }
        ]
      })
      const model = { connectionId: connection.id, modelId: 'image' }
      await service.setDefaultImageModel(model)
      const pending = service.generateImage({ model, prompt: 'cat' })
      await started
      await service.setModelEnabled({ ...model, enabled: false })
      expect(await service.getDefaultImageModel()).toBeNull()
      releaseProvider(
        new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] })
        )
      )
      await expect(pending).rejects.toThrow('Default image model changed')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps a configured image-only model when discovery does not list it', async () => {
    const { service } = createService(() => ({
      status: 200,
      body: { data: [{ id: 'chat' }] },
      text: ''
    }))
    const connection = await service.add({
      draft,
      models: [
        { id: 'chat', name: 'chat', enabled: true, testState: 'success' },
        {
          id: 'image-only',
          name: 'image-only',
          kind: 'image',
          enabled: true,
          testState: 'untested'
        }
      ]
    })
    await service.setDefaultImageModel({ connectionId: connection.id, modelId: 'image-only' })
    expect(await service.refresh(connection.id)).toMatchObject([
      { id: 'chat' },
      { id: 'image-only' }
    ])
    expect(await service.getDefaultImageModel()).toEqual({
      connectionId: connection.id,
      modelId: 'image-only'
    })
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
