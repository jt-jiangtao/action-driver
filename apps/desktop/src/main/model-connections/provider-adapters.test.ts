import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpResponse, HttpTransport } from './http-transport'
import {
  classifyResponse,
  createAnthropicAdapter,
  createOpenAiCompatibleAdapter
} from './provider-adapters'

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
      createOpenAiCompatibleAdapter(media).probeModel({ ...endpoint, modelId: 'qwen-image-3.0-pro' })
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
    await expect(
      adapter.probeModel({ ...anthEndpoint, modelId: 'qwen3.7-plus' })
    ).resolves.toEqual({ state: 'success' })
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

    await expect(createAnthropicAdapter(transport).verifyConnection(anthEndpoint)).resolves.toEqual({
      ok: true,
      value: null
    })
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
