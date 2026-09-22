import { describe, expect, it } from 'vitest'
import { HttpTransportError, type HttpRequest, type HttpResponse, type HttpTransport } from '../src'
import { classifyResponse, createAnthropicAdapter, createOpenAiCompatibleAdapter } from '../src'

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

describe('OpenAI compatible adapter', () => {
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
