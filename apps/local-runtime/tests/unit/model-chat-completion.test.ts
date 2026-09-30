import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelServiceError } from '@action-driver/model-connections'
import type {
  OpenAiClientFactory,
  OpenAiStreamChunk
} from '@action-driver/model-provider-runtime/provider-adapters'
import { createService, draft, discoveredModels } from './model-connection-fixtures'

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
})
