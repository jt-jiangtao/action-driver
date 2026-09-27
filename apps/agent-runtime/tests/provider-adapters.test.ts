import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  OpenAIError,
  RateLimitError
} from 'openai'
import {
  HttpTransportError,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport
} from '../src/model-connections/http-transport'
import {
  ModelStreamError,
  classifyResponse,
  createAnthropicAdapter,
  createOpenAiCompatibleAdapter,
  type OpenAiClientFactory,
  type OpenAiStreamChunk
} from '../src/model-connections/provider-adapters'

function transportOf(handler: (request: HttpRequest) => HttpResponse): HttpTransport & {
  requests: HttpRequest[]
} {
  const requests: HttpRequest[] = []
  return {
    requests,
    async request(request) {
      requests.push(request)
      return handler(request)
    }
  }
}

const endpoint = { baseUrl: 'https://token-plan.example.com/compatible-mode/v1', apiKey: 'sk-x' }

function chunk(value: Partial<OpenAiStreamChunk>): OpenAiStreamChunk {
  return value as OpenAiStreamChunk
}

function openAiFactory(
  chunks: readonly OpenAiStreamChunk[],
  status = 200
): {
  factory: OpenAiClientFactory
  create: ReturnType<typeof vi.fn>
  options: Array<Record<string, unknown>>
} {
  const options: Array<Record<string, unknown>> = []
  const create = vi.fn(() => ({
    async withResponse() {
      return {
        data: {
          async *[Symbol.asyncIterator]() {
            yield* chunks
          }
        },
        response: { status } as Response,
        request_id: 'provider-request-1'
      }
    }
  }))
  const factory = ((input: Record<string, unknown>) => {
    options.push(input)
    return { chat: { completions: { create } } }
  }) as OpenAiClientFactory
  return { factory, create, options }
}

function failingOpenAiFactory(error: Error): OpenAiClientFactory {
  return (() => ({
    chat: {
      completions: {
        create: () => ({
          withResponse: async () => {
            throw error
          }
        })
      }
    }
  })) as OpenAiClientFactory
}

describe('OpenAI compatible adapter', () => {
  it('resolves image references only for the outgoing vision request and redacts returned metadata', async () => {
    const sdk = openAiFactory([
      chunk({ choices: [{ index: 0, delta: { content: '一只猫' }, finish_reason: 'stop' }] })
    ])
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      sdk.factory,
      async () => ({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png' })
    )
    const events = []
    for await (const event of adapter.stream({
      ...endpoint,
      modelId: 'vision',
      parameters: {},
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
                width: 2,
                height: 2,
                byteLength: 3,
                source: 'upload'
              }
            }
          ]
        }
      ]
    }))
      events.push(event)
    expect((sdk.create.mock.calls as unknown as Array<[unknown]>)[0]?.[0]).toMatchObject({
      messages: [
        {
          content: [
            { type: 'text', text: '这是什么？' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
          ]
        }
      ]
    })
    expect(JSON.stringify(events)).not.toContain('AQID')
  })

  it('consumes a real local SSE response through the official SDK', async () => {
    let capturedBody = ''
    let capturedAuthorization = ''
    const server = createServer((request, response) => {
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        capturedBody += chunk
      })
      request.on('end', () => {
        capturedAuthorization = request.headers.authorization ?? ''
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(
          'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"gpt-real","choices":[{"index":0,"delta":{"content":"real "},"finish_reason":null}]}\n\n'
        )
        response.write(
          'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"gpt-real","choices":[{"index":0,"delta":{"content":"stream"},"finish_reason":"stop"}]}\n\n'
        )
        response.write(
          'data: {"id":"chat-1","object":"chat.completion.chunk","created":1,"model":"gpt-real","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n'
        )
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server')

    vi.stubGlobal('window', undefined)
    try {
      const adapter = createOpenAiCompatibleAdapter(
        transportOf(() => ({ status: 200, body: {}, text: '' }))
      )
      const events = []
      for await (const event of adapter.stream({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: 'local-test-secret',
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })) {
        events.push(event)
      }

      expect(events).toMatchObject([
        { kind: 'content', delta: 'real ' },
        { kind: 'content', delta: 'stream' },
        {
          kind: 'end',
          content: 'real stream',
          finishReason: 'stop',
          usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
          status: 200
        }
      ])
      expect(capturedAuthorization).toBe('Bearer local-test-secret')
      expect(JSON.parse(capturedBody)).toMatchObject({
        model: 'gpt-real',
        stream: true,
        stream_options: { include_usage: true }
      })
      expect(JSON.stringify(events)).not.toContain('local-test-secret')
    } finally {
      vi.unstubAllGlobals()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('streams visible SDK chunks and emits one aggregate terminal event', async () => {
    const sdk = openAiFactory([
      chunk({ choices: [{ delta: { content: '# 标' }, finish_reason: null, index: 0 }] }),
      chunk({ choices: [{ delta: { content: '题' }, finish_reason: 'stop', index: 0 }] }),
      chunk({
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }
      })
    ])
    const controller = new AbortController()
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      sdk.factory
    )

    const events = []
    for await (const event of adapter.stream(
      {
        ...endpoint,
        modelId: 'gpt-real',
        messages: [
          { role: 'system', content: 'system text' },
          { role: 'user', content: 'user text' }
        ],
        parameters: { temperature: 0, maxTokens: 512 }
      },
      controller.signal
    )) {
      events.push(event)
    }

    expect(sdk.options).toEqual([
      {
        apiKey: 'sk-x',
        baseURL: 'https://token-plan.example.com/compatible-mode/v1',
        maxRetries: 0,
        timeout: 15_000,
        logLevel: 'off'
      }
    ])
    expect(sdk.create).toHaveBeenCalledWith(
      {
        model: 'gpt-real',
        messages: [
          { role: 'system', content: 'system text' },
          { role: 'user', content: 'user text' }
        ],
        temperature: 0,
        max_tokens: 512,
        stream: true,
        stream_options: { include_usage: true }
      },
      { signal: controller.signal }
    )
    expect(events).toEqual([
      { kind: 'content', delta: '# 标' },
      { kind: 'content', delta: '题' },
      {
        kind: 'end',
        result: { kind: 'final-text', content: '# 标题' },
        content: '# 标题',
        finishReason: 'stop',
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
        requestBody: {
          model: 'gpt-real',
          messages: [
            { role: 'system', content: 'system text' },
            { role: 'user', content: 'user text' }
          ],
          temperature: 0,
          max_tokens: 512,
          stream: true,
          stream_options: { include_usage: true }
        },
        responseBody: {
          content: '# 标题',
          finishReason: 'stop',
          usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
          providerRequestId: 'provider-request-1'
        },
        status: 200
      }
    ])
    expect(JSON.stringify(events)).not.toContain('sk-x')
    expect(JSON.stringify(events)).not.toContain(endpoint.baseUrl)
  })

  it('aggregates interleaved tool call deltas and sends only explicitly provided tools', async () => {
    const sdk = openAiFactory([
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'provider-2',
                  function: { name: 'tools_local_command_shell_run', arguments: '{"pa' }
                },
                {
                  index: 0,
                  id: 'provider-1',
                  function: { name: 'tools_local_command_shell_run', arguments: '{"pa' }
                }
              ]
            },
            finish_reason: null
          }
        ]
      } as unknown as Partial<OpenAiStreamChunk>),
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'th":"README.md"}' } },
                { index: 1, function: { arguments: 'th":"src"}' } }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      } as unknown as Partial<OpenAiStreamChunk>)
    ])
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      sdk.factory
    )
    const events = []

    for await (const event of adapter.stream({
      ...endpoint,
      modelId: 'gpt-real',
      messages: [{ role: 'user', content: 'read files' }],
      tools: [
        {
          id: 'tools.local.command.shell.run',
          version: 1,
          modelName: 'tools.local.command.shell.run',
          description: 'Read a workspace file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          risk: 'low',
          sideEffects: { filesystem: 'read', network: false },
          timeoutMs: 10_000
        }
      ],
      parameters: {}
    })) {
      events.push(event)
    }

    expect(sdk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: 'function',
            function: {
              name: 'tools_local_command_shell_run',
              description: expect.stringContaining('Public tool ID: tools.local.command.shell.run'),
              parameters: { type: 'object', properties: { path: { type: 'string' } } }
            }
          }
        ],
        tool_choice: 'auto'
      }),
      expect.anything()
    )
    expect(events).toEqual([
      { kind: 'tool-call-preparing', index: 1, modelName: 'tools.local.command.shell.run' },
      { kind: 'tool-call-preparing', index: 0, modelName: 'tools.local.command.shell.run' },
      expect.objectContaining({
        kind: 'end',
        result: {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: 'provider-1',
              modelName: 'tools.local.command.shell.run',
              arguments: { path: 'README.md' }
            },
            {
              providerCallId: 'provider-2',
              modelName: 'tools.local.command.shell.run',
              arguments: { path: 'src' }
            }
          ]
        }
      })
    ])
  })

  it('rejects malformed tool arguments without guessing a tool result', async () => {
    const sdk = openAiFactory([
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'provider-1',
                  function: { name: 'tools_local_command_shell_run', arguments: '{invalid' }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      } as unknown as Partial<OpenAiStreamChunk>)
    ])
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      sdk.factory
    )
    const consume = async () => {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'read' }],
        parameters: {}
      })) {
        void event
      }
    }

    await expect(consume()).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('streams the recognized tool name before its arguments are complete without exposing arguments', async () => {
    const sdk = openAiFactory([
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'provider-1',
                  function: {
                    name: 'tools_local_command_shell_run',
                    arguments: '{"command":"secret'
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }),
      chunk({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"}' } }] },
            finish_reason: 'tool_calls'
          }
        ]
      })
    ])
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      sdk.factory
    )
    const iterable = adapter.stream({
      ...endpoint,
      modelId: 'gpt-real',
      messages: [{ role: 'user', content: 'run a command' }],
      tools: [
        {
          id: 'tools.local.command.shell.run',
          version: 1,
          modelName: 'tools.local.command.shell.run',
          description: 'Run command',
          inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
          risk: 'high',
          sideEffects: { filesystem: 'write', network: true },
          timeoutMs: 10_000
        }
      ],
      parameters: {}
    })
    const stream = iterable[Symbol.asyncIterator]()
    const first = await stream.next()
    expect(first.value).toEqual({
      kind: 'tool-call-preparing',
      index: 0,
      modelName: 'tools.local.command.shell.run'
    })
    expect(JSON.stringify(first.value)).not.toContain('secret')
    const terminal = await stream.next()
    expect(terminal.value).toMatchObject({
      kind: 'end',
      result: {
        kind: 'tool-calls',
        calls: [
          {
            providerCallId: 'provider-1',
            modelName: 'tools.local.command.shell.run',
            arguments: { command: 'secret' }
          }
        ]
      }
    })
  })

  it.each([
    {
      label: 'no visible text',
      chunks: [chunk({ choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] })],
      code: 'invalid-response'
    },
    {
      label: 'missing finish reason',
      chunks: [
        chunk({ choices: [{ delta: { content: 'partial' }, finish_reason: null, index: 0 }] })
      ],
      code: 'invalid-response'
    }
  ])('rejects an SDK stream with $label', async ({ chunks, code }) => {
    const sdk = openAiFactory(chunks)
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      sdk.factory
    )

    const consume = async () => {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })) {
        void event
      }
    }

    await expect(consume()).rejects.toMatchObject({ code })
  })

  it('rejects an already aborted call without creating an SDK client', async () => {
    const sdk = openAiFactory([])
    const controller = new AbortController()
    controller.abort()
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      sdk.factory
    )

    const consume = async () => {
      for await (const event of adapter.stream(
        {
          ...endpoint,
          modelId: 'gpt-real',
          messages: [{ role: 'user', content: 'hello' }],
          parameters: {}
        },
        controller.signal
      )) {
        void event
      }
    }

    await expect(consume()).rejects.toBeInstanceOf(ModelStreamError)
    await expect(consume()).rejects.toMatchObject({ code: 'cancelled' })
    expect(sdk.options).toEqual([])
  })

  it.each([
    {
      label: 'authentication',
      error: new AuthenticationError(
        401,
        { error: { message: 'bad key' } },
        'bad key',
        new Headers()
      ),
      code: 'unauthorized'
    },
    {
      label: 'rate limit',
      error: new RateLimitError(
        429,
        { error: { message: 'slow down' } },
        'slow down',
        new Headers()
      ),
      code: 'rate-limited'
    },
    {
      label: 'timeout',
      error: new APIConnectionTimeoutError({ message: 'request timed out' }),
      code: 'timeout'
    },
    {
      label: 'cancellation',
      error: new APIUserAbortError({ message: 'aborted' }),
      code: 'cancelled'
    },
    {
      label: 'malformed SSE chunk',
      error: new OpenAIError('Could not parse SSE data as JSON'),
      code: 'invalid-response'
    }
  ])('maps SDK $label errors to domain failures', async ({ error, code }) => {
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      failingOpenAiFactory(error)
    )
    const consume = async () => {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })) {
        void event
      }
    }

    await expect(consume()).rejects.toMatchObject({ code })
  })

  it('preserves visible partial output and fails when the SDK stream disconnects', async () => {
    const factory = (() => ({
      chat: {
        completions: {
          create: () => ({
            withResponse: async () => ({
              data: {
                async *[Symbol.asyncIterator]() {
                  yield chunk({
                    choices: [{ delta: { content: 'partial' }, finish_reason: null, index: 0 }]
                  })
                  throw new APIConnectionTimeoutError({ message: 'stream idle timeout' })
                }
              },
              response: { status: 200 },
              request_id: 'provider-request-1'
            })
          })
        }
      }
    })) as OpenAiClientFactory
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      factory
    )
    const events = []
    let caught: unknown
    try {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })) {
        events.push(event)
      }
    } catch (error) {
      caught = error
    }

    expect(events).toEqual([{ kind: 'content', delta: 'partial' }])
    expect(caught).toMatchObject({ code: 'timeout' })
  })

  it('redacts credentials reflected by an SDK error', async () => {
    const reflected = new AuthenticationError(
      401,
      { error: { message: 'Rejected sk-completion-secret' } },
      'Rejected sk-completion-secret',
      new Headers()
    )
    const adapter = createOpenAiCompatibleAdapter(
      transportOf(() => ({ status: 200, body: {}, text: '' })),
      failingOpenAiFactory(reflected)
    )
    let caught: unknown
    try {
      for await (const event of adapter.stream({
        ...endpoint,
        apiKey: 'sk-completion-secret',
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })) {
        void event
      }
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      code: 'unauthorized',
      message: expect.stringContaining('[redacted]')
    })
    expect((caught as Error).message).not.toContain('sk-completion-secret')
  })

  it('executes a non-streaming chat completion and preserves safe request and response bodies', async () => {
    const transport = transportOf(() => ({
      status: 200,
      body: { choices: [{ message: { role: 'assistant', content: 'real answer' } }] },
      text: ''
    }))
    const adapter = createOpenAiCompatibleAdapter(transport)

    await expect(
      adapter.complete({
        ...endpoint,
        modelId: 'gpt-real',
        messages: [
          { role: 'system', content: 'system text' },
          { role: 'user', content: 'user text' }
        ],
        parameters: { temperature: 0 }
      })
    ).resolves.toEqual({
      ok: true,
      value: {
        content: 'real answer',
        providerProtocol: 'openai-compatible',
        requestBody: {
          model: 'gpt-real',
          messages: [
            { role: 'system', content: 'system text' },
            { role: 'user', content: 'user text' }
          ],
          temperature: 0,
          stream: false
        },
        responseBody: {
          choices: [{ message: { role: 'assistant', content: 'real answer' } }]
        },
        status: 200
      }
    })
    expect(transport.requests[0]).toMatchObject({
      url: 'https://token-plan.example.com/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: { authorization: 'Bearer sk-x' },
      body: {
        model: 'gpt-real',
        messages: [
          { role: 'system', content: 'system text' },
          { role: 'user', content: 'user text' }
        ],
        temperature: 0,
        stream: false
      }
    })
  })

  it.each([
    {
      name: 'blank successful response',
      response: { status: 200, body: { choices: [{ message: { content: '   ' } }] }, text: '' },
      failure: { code: 'invalid-response', retryable: false },
      status: 200
    },
    {
      name: 'unauthorized response',
      response: { status: 401, body: { error: { message: 'bad key' } }, text: '' },
      failure: { code: 'unauthorized', retryable: false },
      status: 401
    },
    {
      name: 'rate limited response',
      response: { status: 429, body: { error: { message: 'slow down' } }, text: '' },
      failure: { code: 'rate-limited', retryable: true },
      status: 429
    }
  ])('returns a diagnosable outcome for $name', async ({ response, failure, status }) => {
    const adapter = createOpenAiCompatibleAdapter(transportOf(() => response))

    await expect(
      adapter.complete({
        ...endpoint,
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })
    ).resolves.toMatchObject({
      ok: false,
      failure,
      requestBody: { model: 'gpt-real', stream: false },
      responseBody: response.body,
      status
    })
  })

  it('maps timeout and cancellation without inventing a response', async () => {
    const timedOut = createOpenAiCompatibleAdapter(
      transportOf(() => {
        throw new HttpTransportError('timeout', 'request timed out')
      })
    )
    await expect(
      timedOut.complete({
        ...endpoint,
        modelId: 'gpt-real',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })
    ).resolves.toMatchObject({
      ok: false,
      failure: { code: 'timeout', retryable: true },
      responseBody: null,
      status: null
    })

    const transport = transportOf(() => ({ status: 200, body: {}, text: '' }))
    const cancelled = createOpenAiCompatibleAdapter(transport)
    const controller = new AbortController()
    controller.abort()
    await expect(
      cancelled.complete(
        {
          ...endpoint,
          modelId: 'gpt-real',
          messages: [{ role: 'user', content: 'hello' }],
          parameters: {}
        },
        controller.signal
      )
    ).resolves.toMatchObject({
      ok: false,
      failure: { code: 'cancelled', retryable: false },
      responseBody: null,
      status: null
    })
    expect(transport.requests).toEqual([])
  })

  it('removes reflected credentials from completion response bodies', async () => {
    const transport = transportOf((request) => ({
      status: 401,
      body: { error: { message: `Rejected ${request.headers.authorization}` } },
      text: ''
    }))

    const result = await createOpenAiCompatibleAdapter(transport).complete({
      ...endpoint,
      apiKey: 'sk-completion-secret',
      modelId: 'gpt-real',
      messages: [{ role: 'user', content: 'hello' }],
      parameters: {}
    })

    expect(result).toMatchObject({
      ok: false,
      responseBody: { error: { message: 'Rejected [redacted]' } }
    })
    expect(JSON.stringify(result)).not.toContain('sk-completion-secret')
  })

  it('discovers models from the model list endpoint', async () => {
    const transport = transportOf(() => ({
      status: 200,
      body: { data: [{ id: 'qwen3.7-plus' }, { id: 'qwen-image-3.0-pro' }] },
      text: ''
    }))
    const adapter = createOpenAiCompatibleAdapter(transport)

    await expect(adapter.discover(endpoint)).resolves.toEqual({
      ok: true,
      value: ['qwen3.7-plus', 'qwen-image-3.0-pro']
    })
    expect(transport.requests[0]).toMatchObject({
      url: 'https://token-plan.example.com/compatible-mode/v1/models',
      method: 'GET',
      headers: { authorization: 'Bearer sk-x' }
    })
  })

  it('reports credential and address failures instead of returning models', async () => {
    const unauthorized = transportOf(() => ({
      status: 401,
      body: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' },
      text: ''
    }))
    await expect(createOpenAiCompatibleAdapter(unauthorized).discover(endpoint)).resolves.toEqual({
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid API-key provided.' }
    })

    const missingPath = transportOf(() => ({ status: 404, body: null, text: 'Not Found' }))
    await expect(
      createOpenAiCompatibleAdapter(missingPath).verifyConnection(endpoint)
    ).resolves.toMatchObject({ ok: false, failure: { code: 'not-found' } })
  })

  it('removes the effective credential when a provider reflects it in an error', async () => {
    const reflected = transportOf((request) => ({
      status: 401,
      body: { message: `Rejected ${request.headers.authorization}` },
      text: ''
    }))

    const result = await createOpenAiCompatibleAdapter(reflected).discover({
      ...endpoint,
      apiKey: 'sk-secret-value'
    })
    expect(result).toMatchObject({
      ok: false,
      failure: { message: 'Rejected [redacted]' }
    })
    expect(JSON.stringify(result)).not.toContain('sk-secret-value')
  })

  it('removes the effective credential from generic transport errors', async () => {
    const reflected = transportOf((request) => {
      throw new Error(`Transport failed for ${request.headers.authorization}`)
    })

    const result = await createOpenAiCompatibleAdapter(reflected).discover({
      ...endpoint,
      apiKey: 'sk-secret-value'
    })
    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'unknown', message: 'Transport failed for [redacted]' }
    })
    expect(JSON.stringify(result)).not.toContain('sk-secret-value')
  })

  it('marks models that reject text requests as unsupported instead of failed', async () => {
    const media = transportOf(() => ({
      status: 400,
      body: {
        code: 'InvalidParameter',
        message: 'Input should be a valid list: input.messages.0.content'
      },
      text: ''
    }))
    await expect(
      createOpenAiCompatibleAdapter(media).probeModel({
        ...endpoint,
        modelId: 'qwen-image-3.0-pro'
      })
    ).resolves.toMatchObject({ state: 'unsupported' })

    const unknownModel = transportOf(() => ({
      status: 404,
      body: { error: { message: 'Model not exist.', code: 'model_not_found' } },
      text: ''
    }))
    await expect(
      createOpenAiCompatibleAdapter(unknownModel).probeModel({
        ...endpoint,
        modelId: 'missing-model'
      })
    ).resolves.toMatchObject({ state: 'failed', failure: { code: 'model-not-found' } })

    const working = transportOf(() => ({ status: 200, body: { choices: [] }, text: '' }))
    await expect(
      createOpenAiCompatibleAdapter(working).probeModel({
        ...endpoint,
        modelId: 'qwen3.7-plus'
      })
    ).resolves.toEqual({ state: 'success' })
  })
})

describe('Anthropic compatible adapter', () => {
  const anthEndpoint = {
    baseUrl: 'https://token-plan.example.com/apps/anthropic/',
    apiKey: 'sk-x'
  }

  it('has no discovery endpoint and probes the messages route', async () => {
    const transport = transportOf(() => ({ status: 200, body: { content: [] }, text: '' }))
    const adapter = createAnthropicAdapter(transport)

    await expect(adapter.discover(anthEndpoint)).resolves.toEqual({ ok: true, value: [] })
    await expect(adapter.probeModel({ ...anthEndpoint, modelId: 'qwen3.7-plus' })).resolves.toEqual(
      { state: 'success' }
    )
    expect(transport.requests[0]).toMatchObject({
      url: 'https://token-plan.example.com/apps/anthropic/v1/messages',
      method: 'POST',
      headers: { 'x-api-key': 'sk-x', 'anthropic-version': '2023-06-01' }
    })
  })

  it('treats an unknown sentinel model as proof that endpoints and credentials work', async () => {
    const transport = transportOf(() => ({
      status: 400,
      body: { code: 'InvalidParameter', message: 'Model not exist.' },
      text: ''
    }))

    await expect(createAnthropicAdapter(transport).verifyConnection(anthEndpoint)).resolves.toEqual(
      {
        ok: true,
        value: null
      }
    )
  })

  it('still fails on rejected credentials', async () => {
    const transport = transportOf(() => ({
      status: 401,
      body: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' },
      text: ''
    }))

    await expect(
      createAnthropicAdapter(transport).verifyConnection(anthEndpoint)
    ).resolves.toMatchObject({ ok: false, failure: { code: 'unauthorized' } })
  })

  it('does not execute Agent completions in the first vertical slice', async () => {
    const transport = transportOf(() => ({ status: 200, body: {}, text: '' }))

    await expect(
      createAnthropicAdapter(transport).complete({
        ...anthEndpoint,
        modelId: 'claude',
        messages: [{ role: 'user', content: 'hello' }],
        parameters: {}
      })
    ).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid-request', message: 'Agent 调用暂未接入', retryable: false },
      responseBody: null,
      status: null
    })
    expect(transport.requests).toEqual([])
  })
})

describe('provider response classification', () => {
  it('classifies status codes and provider error codes', () => {
    expect(classifyResponse(200, {}, '')).toBeNull()
    expect(classifyResponse(401, {}, '')).toMatchObject({ code: 'unauthorized' })
    expect(classifyResponse(429, {}, '')).toMatchObject({ code: 'rate-limited' })
    expect(classifyResponse(503, {}, '')).toMatchObject({ code: 'provider-error' })
    expect(classifyResponse(404, {}, '')).toMatchObject({ code: 'not-found' })
    expect(classifyResponse(422, {}, '')).toMatchObject({ code: 'invalid-request' })
    expect(classifyResponse(418, {}, '')).toMatchObject({ code: 'unknown' })
  })
})

const dottedTool = (modelName = 'tools.local.command.node.run') => ({
  id: modelName,
  modelName,
  version: 1,
  description: 'Run code',
  inputSchema: { type: 'object' },
  risk: 'low' as const,
  sideEffects: { filesystem: 'none' as const, network: false },
  timeoutMs: 1000
})
it('maps historical calls and results only in the provider request without changing history', async () => {
  const sdk = openAiFactory([
    chunk({ choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] })
  ])
  const adapter = createOpenAiCompatibleAdapter(
    transportOf(() => ({ status: 200, body: {}, text: '' })),
    sdk.factory
  )
  const messages = [
    {
      role: 'assistant' as const,
      toolCalls: [{ providerCallId: 'p', modelName: 'tools.local.command.node.run', arguments: {} }]
    },
    { role: 'tool' as const, toolCallId: 'p', name: 'tools.local.command.node.run', content: 'ok' }
  ]
  const before = JSON.stringify(messages)
  for await (const event of adapter.stream({
    ...endpoint,
    modelId: 'model',
    messages,
    tools: [dottedTool()],
    parameters: {}
  }))
    void event
  const body = (sdk.create.mock.calls as unknown as Array<[unknown]>)[0]?.[0] as unknown as {
    messages: Array<Record<string, unknown>>
  }
  expect(body.messages).toEqual([
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'p',
          type: 'function',
          function: { name: 'tools_local_command_node_run', arguments: '{}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'p', name: 'tools_local_command_node_run', content: 'ok' }
  ])
  expect(JSON.stringify(messages)).toBe(before)
})
it.each([
  ['collision', [dottedTool('a.b'), dottedTool('a_b')]],
  ['overlong', [dottedTool('x'.repeat(65))]]
])('rejects %s wire names before sending', async (_label, tools) => {
  const sdk = openAiFactory([])
  const adapter = createOpenAiCompatibleAdapter(
    transportOf(() => ({ status: 200, body: {}, text: '' })),
    sdk.factory
  )
  await expect(
    (async () => {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'model',
        messages: [],
        tools,
        parameters: {}
      }))
        void event
    })()
  ).rejects.toMatchObject({ code: 'invalid-request' })
  expect(sdk.create).not.toHaveBeenCalled()
})
it('rejects an unknown wire response rather than guessing a public tool name', async () => {
  const sdk = openAiFactory([
    chunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: 'p', function: { name: 'unknown_tool', arguments: '{}' } }]
          },
          finish_reason: 'tool_calls'
        }
      ]
    })
  ])
  const adapter = createOpenAiCompatibleAdapter(
    transportOf(() => ({ status: 200, body: {}, text: '' })),
    sdk.factory
  )
  await expect(
    (async () => {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'model',
        messages: [],
        tools: [dottedTool()],
        parameters: {}
      }))
        void event
    })()
  ).rejects.toMatchObject({ code: 'invalid-response' })
})

it('rejects collisions between history and current tools before sending', async () => {
  const sdk = openAiFactory([])
  const adapter = createOpenAiCompatibleAdapter(
    transportOf(() => ({ status: 200, body: {}, text: '' })),
    sdk.factory
  )
  const messages = [
    {
      role: 'assistant' as const,
      toolCalls: [{ providerCallId: 'old', modelName: 'a_b', arguments: {} }]
    }
  ]
  await expect(
    (async () => {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'model',
        messages,
        tools: [dottedTool('a.b')],
        parameters: {}
      }))
        void event
    })()
  ).rejects.toMatchObject({ code: 'invalid-request' })
  expect(sdk.create).not.toHaveBeenCalled()
})
it('rejects collisions within history even without currently available tools', async () => {
  const sdk = openAiFactory([])
  const adapter = createOpenAiCompatibleAdapter(
    transportOf(() => ({ status: 200, body: {}, text: '' })),
    sdk.factory
  )
  const messages = [
    {
      role: 'assistant' as const,
      toolCalls: [{ providerCallId: 'one', modelName: 'a.b', arguments: {} }]
    },
    { role: 'tool' as const, toolCallId: 'two', name: 'a_b', content: 'result' }
  ]
  await expect(
    (async () => {
      for await (const event of adapter.stream({
        ...endpoint,
        modelId: 'model',
        messages,
        tools: [],
        parameters: {}
      }))
        void event
    })()
  ).rejects.toMatchObject({ code: 'invalid-request' })
  expect(sdk.create).not.toHaveBeenCalled()
})

it('rejects conflicting history in non-streaming provider requests too', async () => {
  const transport = transportOf(() => ({
    status: 200,
    body: { choices: [{ message: { content: 'done' } }] },
    text: ''
  }))
  const adapter = createOpenAiCompatibleAdapter(transport)
  await expect(
    adapter.complete({
      ...endpoint,
      modelId: 'model',
      messages: [
        {
          role: 'assistant',
          toolCalls: [{ providerCallId: 'p', modelName: 'a.b', arguments: {} }]
        },
        { role: 'tool', toolCallId: 'p', name: 'a_b', content: 'ok' }
      ],
      parameters: {}
    })
  ).rejects.toMatchObject({ code: 'invalid-request' })
  expect(transport.requests).toHaveLength(0)
})
