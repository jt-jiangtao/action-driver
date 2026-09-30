import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelServiceError, type ModelOptionDto } from '@action-driver/model-connections'
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
  OpenAiClientFactory,
  OpenAiStreamChunk
} from '@action-driver/model-provider-runtime/provider-adapters'

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

const discoveredModels: ModelOptionDto[] = [
  {
    id: 'qwen3.7-plus',
    name: 'qwen3.7-plus',
    enabled: true,
    testState: 'success',
    capabilities: { text: { state: 'success', source: 'probe' } }
  }
]

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII=',
  'base64'
)

describe('model connection service', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unsupported', { status: 400 }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists four probe candidates for audio models without storing audio labels as results', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const created = await service.add({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      models: [
        { id: 'qwen3.8-max', name: 'qwen3.8-max', enabled: true, testState: 'untested' },
        {
          id: 'qwen-audio-3.0-asr-flash',
          name: 'qwen-audio-3.0-asr-flash',
          enabled: true,
          testState: 'untested'
        }
      ]
    })
    expect(created.models[0]?.probeCandidates).toEqual([
      'text',
      'reasoning',
      'vision',
      'image_generation'
    ])
    expect(created.models[1]?.probeCandidates).toEqual([
      'text',
      'reasoning',
      'vision',
      'image_generation'
    ])
    expect(created.models[1]?.chatCandidate).toBe(false)
    expect((await service.list())[0]?.models[0]?.probeCandidates).toEqual([
      'text',
      'reasoning',
      'vision',
      'image_generation'
    ])
  })

  it('starts all applicable capability probes before waiting for a result', async () => {
    const releases: Array<(response: HttpResponse) => void> = []
    const { service, requests } = createService(
      () => new Promise<HttpResponse>((resolve) => releases.push(resolve))
    )
    const testing = service.testModels({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      modelIds: ['qwen3.8-max']
    })
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    for (const release of releases) {
      release({
        status: 200,
        body: { choices: [{ message: { content: 'OK', reasoning_content: 'reason' } }] },
        text: ''
      })
    }
    await testing
  })

  it('runs at most four models at once during bulk testing', async () => {
    const releases: Array<(response: HttpResponse) => void> = []
    const { service, requests } = createService(
      () => new Promise<HttpResponse>((resolve) => releases.push(resolve))
    )
    const testing = service.testModels({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      modelIds: ['qwen3.7-max', 'deepseek-v4-pro', 'glm-5.2', 'qwen3.8-max', 'qwen3.8-flash']
    })
    await vi.waitFor(() => expect(requests).toHaveLength(12))
    expect(requests.some((request) => JSON.stringify(request.body).includes('qwen3.8-flash'))).toBe(
      false
    )
    for (const release of [...releases]) {
      release({
        status: 200,
        body: { choices: [{ message: { content: 'OK', reasoning_content: 'reason' } }] },
        text: ''
      })
    }
    await vi.waitFor(() => expect(requests).toHaveLength(15))
    for (const release of releases.slice(12)) {
      release({
        status: 200,
        body: { choices: [{ message: { content: 'OK', reasoning_content: 'reason' } }] },
        text: ''
      })
    }
    expect((await testing).map((result) => result.modelId)).toEqual([
      'qwen3.7-max',
      'deepseek-v4-pro',
      'glm-5.2',
      'qwen3.8-max',
      'qwen3.8-flash'
    ])
  })

  it('replaces legacy results with three real probes on image model retest', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const created = await service.add({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      models: [
        {
          id: 'wan2.7-image',
          name: 'wan2.7-image',
          enabled: true,
          testState: 'success',
          capabilities: {
            text: { state: 'success', source: 'legacy' },
            vision: { state: 'success', source: 'legacy' }
          }
        }
      ]
    })
    await service.testConnectionModels({ connectionId: created.id, modelIds: ['wan2.7-image'] })
    const saved = (await service.list())[0]?.models[0]
    expect(saved?.capabilities?.text?.source).toBe('probe')
    expect(saved?.capabilities?.reasoning?.source).toBe('probe')
    expect(saved?.capabilities?.vision?.source).toBe('probe')
  })

  it('keeps both model results when saved tests complete in reverse order', async () => {
    const releases = new Map<string, Array<(response: HttpResponse) => void>>()
    const { service, requests } = createService(
      (request) =>
        new Promise<HttpResponse>((resolve) => {
          const modelId = String((request.body as { model?: string }).model)
          releases.set(modelId, [...(releases.get(modelId) ?? []), resolve])
        })
    )
    const connection = await service.add({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      models: [
        { id: 'qwen3.7-max', name: 'qwen3.7-max', enabled: true, testState: 'untested' },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', enabled: true, testState: 'untested' }
      ]
    })
    const first = service.testConnectionModels({
      connectionId: connection.id,
      modelIds: ['qwen3.7-max']
    })
    const second = service.testConnectionModels({
      connectionId: connection.id,
      modelIds: ['deepseek-v4-pro']
    })
    await vi.waitFor(() => expect(requests).toHaveLength(6))
    const response = {
      status: 200,
      body: { choices: [{ message: { content: 'OK', reasoning_content: 'reason' } }] },
      text: ''
    }
    for (const release of releases.get('deepseek-v4-pro') ?? []) release(response)
    await second
    for (const release of releases.get('qwen3.7-max') ?? []) release(response)
    await first
    const models = (await service.list())[0]?.models
    expect(models?.find((model) => model.id === 'qwen3.7-max')?.capabilities?.text?.state).toBe(
      'success'
    )
    expect(models?.find((model) => model.id === 'deepseek-v4-pro')?.capabilities?.text?.state).toBe(
      'success'
    )
  })

  it('tests each listed Token Plan capability and keeps their results separate', async () => {
    const { service, requests } = createService((request) => {
      const body = request.body as {
        messages?: Array<{ content?: unknown }>
        enable_thinking?: boolean
      }
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
      modelIds: ['qwen3.8-max']
    })
    expect(results[0]?.capabilities?.text?.state).toBe('success')
    expect(results[0]?.capabilities?.reasoning?.state).toBe('success')
    expect(results[0]?.capabilities?.vision?.state).toBe('success')
    expect(requests).toHaveLength(3)
  })

  it('actually probes text, reasoning and vision on audio and video models', async () => {
    const { service, requests } = createService(() => ({
      status: 200,
      body: { choices: [{ message: { content: 'red', reasoning_content: 'reason' } }] },
      text: ''
    }))
    const results = await service.testModels({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      modelIds: ['qwen-audio-3.0-asr-flash', 'happyhorse-1.1-t2v']
    })
    expect(requests).toHaveLength(6)
    expect(results.map((result) => Object.keys(result.capabilities ?? {}).sort())).toEqual([
      ['image_generation', 'reasoning', 'text', 'vision'],
      ['image_generation', 'reasoning', 'text', 'vision']
    ])
    expect(
      results.every((result) =>
        ['text', 'reasoning', 'vision'].every(
          (capability) =>
            result.capabilities?.[capability as 'text' | 'reasoning' | 'vision']?.state ===
            'success'
        )
      )
    ).toBe(true)
  })

  it('actually sends an image generation request for text, audio and video models', async () => {
    const fetch = vi.fn(async () => new Response('unsupported', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    try {
      const { service, requests } = createService(() => ({
        status: 200,
        body: { choices: [{ message: { content: 'red', reasoning_content: 'reason' } }] },
        text: ''
      }))
      const modelIds = ['qwen3.8-max', 'qwen-audio-3.0-asr-flash', 'happyhorse-1.1-t2v']
      const results = await service.testModels({
        draft: {
          ...draft,
          baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
        },
        modelIds
      })
      expect(requests).toHaveLength(9)
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(results.map((result) => result.capabilities?.image_generation?.state)).toEqual([
        'failed',
        'failed',
        'failed'
      ])
      expect(results.map((result) => result.capabilities?.text?.state)).toEqual([
        'success',
        'success',
        'success'
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not restore a model that was disabled while its capability test ran', async () => {
    let releaseFirst: ((response: HttpResponse) => void) | undefined
    let first = true
    const { service } = createService(() => {
      if (first) {
        first = false
        return new Promise<HttpResponse>((resolve) => {
          releaseFirst = resolve
        })
      }
      return {
        status: 200,
        body: { choices: [{ message: { content: '42', reasoning_content: '17 + 25' } }] },
        text: ''
      }
    })
    const connection = await service.add({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      models: [{ id: 'qwen3.7-max', name: 'qwen3.7-max', enabled: true, testState: 'untested' }]
    })
    const testing = service.testConnectionModels({
      connectionId: connection.id,
      modelIds: ['qwen3.7-max']
    })
    await vi.waitFor(() => expect(releaseFirst).toBeDefined())
    await service.setModelEnabled({
      connectionId: connection.id,
      modelId: 'qwen3.7-max',
      enabled: false
    })
    releaseFirst?.({ status: 200, body: { choices: [{ message: { content: 'OK' } }] }, text: '' })
    await testing
    expect((await service.list())[0]?.models[0]?.enabled).toBe(false)
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
      expect(await service.generateImage({ model, prompt: 'cat' })).toEqual(
        new Uint8Array(validPng)
      )
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects an in-flight image result after the default model is disabled', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        })
    )
    vi.stubGlobal('fetch', fetch)
    try {
      const { service } = createService(() => ({ status: 500, body: {}, text: '' }))
      const connection = await service.add({
        draft,
        models: [
          {
            id: 'image-model',
            name: 'image-model',
            enabled: true,
            testState: 'success',
            capabilities: { image_generation: { state: 'success', source: 'probe' } }
          }
        ]
      })
      const model = { connectionId: connection.id, modelId: 'image-model' }
      await service.setDefaultImageModel(model)
      const pending = service.generateImage({ model, prompt: 'cat' })
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      await service.setModelEnabled({ ...model, enabled: false })
      expect(await service.getDefaultImageModel()).toBeNull()
      resolveResponse?.(
        new Response(
          JSON.stringify({
            data: [{ b64_json: validPng.toString('base64') }]
          }),
          { status: 200 }
        )
      )
      await expect(pending).rejects.toThrow('Default image model changed')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends an image when both text and vision probes succeeded', async () => {
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
      models: [
        {
          id: 'chat',
          name: 'chat',
          enabled: true,
          testState: 'success',
          capabilities: {
            text: { state: 'success', source: 'probe' },
            vision: { state: 'success', source: 'probe' }
          }
        }
      ]
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

  it.each(['untested', 'failed', 'unsupported', 'inconclusive'] as const)(
    'tries image input when the vision probe is %s and surfaces the provider result',
    async (visionState) => {
      const { service, requests } = createService(
        () => ({ status: 200, body: {}, text: '' }),
        undefined,
        async () => ({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png' })
      )
      const connection = await service.add({
        draft,
        models: [
          {
            id: 'text-only',
            name: 'text-only',
            enabled: true,
            testState: 'success',
            capabilities: {
              text: { state: 'success', source: 'probe' },
              vision: { state: visionState, source: 'probe' }
            }
          }
        ]
      })
      const model = { connectionId: connection.id, modelId: 'text-only' }
      await expect(
        service.complete({
          model,
          requestId: 'plain',
          taskId: 'plain',
          messages: [{ role: 'user', content: 'hello' }],
          parameters: {}
        })
      ).resolves.toMatchObject({ ok: false })
      await expect(
        service.complete({
          model,
          requestId: 'image',
          taskId: 'image',
          parameters: {},
          messages: [
            {
              role: 'user',
              content: [
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
          ]
        })
      ).resolves.toMatchObject({ ok: false })
      expect(requests).toHaveLength(2)
    }
  )

  it('tries an untested chat model through the provider', async () => {
    const { service, requests } = createService(() => ({
      status: 503,
      body: { error: { message: 'provider unavailable' } },
      text: ''
    }))
    const connection = await service.add({
      draft,
      models: [{ id: 'untested-chat', name: 'untested-chat', enabled: true, testState: 'untested' }]
    })
    const outcome = await service.complete({
      model: { connectionId: connection.id, modelId: 'untested-chat' },
      requestId: 'untested',
      taskId: 'untested',
      messages: [{ role: 'user', content: 'hello' }],
      parameters: {}
    })
    expect(requests).toHaveLength(1)
    expect(outcome).toMatchObject({ ok: false })
  })

  it('ignores a legacy image kind when the current catalog includes chat', async () => {
    const { service, requests } = createService(() => ({
      status: 503,
      body: { error: { message: 'provider unavailable' } },
      text: ''
    }))
    const connection = await service.add({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      models: [
        {
          id: 'qwen3.7-plus',
          name: 'qwen3.7-plus',
          kind: 'image',
          enabled: true,
          testState: 'untested'
        }
      ]
    })
    const outcome = await service.complete({
      model: { connectionId: connection.id, modelId: 'qwen3.7-plus' },
      requestId: 'legacy-kind',
      taskId: 'legacy-kind',
      messages: [{ role: 'user', content: 'hello' }],
      parameters: {}
    })
    expect(requests).toHaveLength(1)
    expect(outcome).toMatchObject({ ok: false })
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

  it('rejects a cataloged image model on the chat completion path', async () => {
    const { service, requests } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft: {
        ...draft,
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
      },
      models: [
        {
          id: 'wan2.7-image',
          name: 'wan2.7-image',
          kind: 'image',
          enabled: true,
          testState: 'success'
        }
      ]
    })
    await expect(
      service.complete({
        model: { connectionId: connection.id, modelId: 'wan2.7-image' },
        requestId: 'request',
        taskId: 'task',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })
    ).rejects.toThrow('does not support chat')
    expect(requests).toHaveLength(0)
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
      models: [
        {
          id: 'shared-model',
          name: 'shared-model',
          enabled: true,
          testState: 'success',
          capabilities: { text: { state: 'success', source: 'probe' } }
        }
      ]
    })
    const second = await service.add({
      draft: { ...draft, name: 'Second', apiKey: 'second-secret' },
      models: [
        {
          id: 'shared-model',
          name: 'shared-model',
          enabled: true,
          testState: 'success',
          capabilities: { text: { state: 'success', source: 'probe' } }
        }
      ]
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
      models: [
        {
          id: 'shared-model',
          name: 'shared-model',
          enabled: true,
          testState: 'success',
          capabilities: { text: { state: 'success', source: 'probe' } }
        }
      ]
    })
    const second = await service.add({
      draft: { ...draft, name: 'Second', apiKey: 'second-secret' },
      models: [
        {
          id: 'shared-model',
          name: 'shared-model',
          enabled: true,
          testState: 'success',
          capabilities: { text: { state: 'success', source: 'probe' } }
        }
      ]
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
      model: {
        id: 'blocked',
        name: 'blocked',
        enabled: false,
        testState: 'success' as const,
        capabilities: { text: { state: 'success' as const, source: 'probe' as const } }
      },
      message: 'is disabled'
    },
    {
      label: 'anthropic',
      protocol: 'anthropic' as const,
      model: {
        id: 'blocked',
        name: 'blocked',
        enabled: true,
        testState: 'success' as const,
        capabilities: { text: { state: 'success' as const, source: 'probe' as const } }
      },
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
      {
        id: 'qwen3.7-plus',
        name: 'qwen3.7-plus',
        enabled: true,
        testState: 'untested',
        probeCandidates: ['text', 'reasoning', 'vision', 'image_generation'],
        chatCandidate: true
      },
      {
        id: 'qwen3.8-max',
        name: 'qwen3.8-max',
        enabled: true,
        testState: 'untested',
        probeCandidates: ['text', 'reasoning', 'vision', 'image_generation'],
        chatCandidate: true
      }
    ])

    const created = await service.add({ draft, models: discoveredModels })
    const refreshed = await service.refresh(created.id)
    expect(refreshed.map((model) => model.id)).toEqual(['qwen3.7-plus', 'qwen3.8-max'])
    expect((await service.list())[0]!.models.map((model) => model.id)).toEqual([
      'qwen3.7-plus',
      'qwen3.8-max'
    ])
  })

  it('persists independent probe outcomes for a saved connection', async () => {
    const { service } = createService((request) => {
      const body = request.body as { model?: string; enable_thinking?: boolean }
      if (body.model === 'deepseek-v4-pro') {
        return {
          status: 404,
          body: { error: { code: 'model_not_found', message: 'Model not found' } },
          text: ''
        }
      }
      return {
        status: 200,
        body: {
          choices: [
            {
              message: body.enable_thinking
                ? { content: '42', reasoning_content: 'steps' }
                : { content: 'OK' }
            }
          ]
        },
        text: ''
      }
    })
    const officialDraft = {
      ...draft,
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
    }
    const created = await service.add({
      draft: officialDraft,
      models: [
        { id: 'qwen3.7-max', name: 'qwen3.7-max', enabled: true, testState: 'untested' },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', enabled: true, testState: 'untested' }
      ]
    })
    const results = await service.testConnectionModels({
      connectionId: created.id,
      modelIds: ['qwen3.7-max', 'deepseek-v4-pro']
    })
    expect(results[0]?.capabilities).toMatchObject({
      text: { state: 'success' },
      reasoning: { state: 'success' }
    })
    expect(results[1]?.capabilities?.text?.state).toBe('failed')
    expect((await service.list())[0]?.models[0]?.capabilities?.text?.state).toBe('success')
    expect((await service.list())[0]?.models[1]?.capabilities?.text?.state).toBe('failed')
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
