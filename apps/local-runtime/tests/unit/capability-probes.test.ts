import { describe, expect, it } from 'vitest'
import type {
  HttpRequest,
  HttpResponse,
  HttpTransport
} from '@action-driver/model-provider-runtime/http-transport'
import { probeCapability } from '../../src/model-connections/capability-probes'

const endpoint = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-secret',
  protocol: 'openai-compatible' as const
}
const redPng = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC',
    'base64'
  )
)

function transportFor(
  body: unknown,
  status = 200
): {
  transport: HttpTransport
  requests: HttpRequest[]
} {
  const requests: HttpRequest[] = []
  return {
    requests,
    transport: {
      async request(request): Promise<HttpResponse> {
        requests.push(request)
        return { body, status, text: JSON.stringify(body) }
      }
    }
  }
}

describe('probeCapability', () => {
  it('requires usable assistant text for a text success', async () => {
    const { transport } = transportFor({ choices: [{ message: { content: '' } }] })
    const result = await probeCapability({
      endpoint,
      modelId: 'text-model',
      capability: 'text',
      transport
    })
    expect(result.state).toBe('inconclusive')
  })

  it('requires explicit reasoning evidence instead of a normal answer', async () => {
    const { transport } = transportFor({ choices: [{ message: { content: '42' } }] })
    const result = await probeCapability({
      endpoint,
      modelId: 'reasoning-model',
      capability: 'reasoning',
      transport
    })
    expect(result.state).toBe('inconclusive')
  })

  it('accepts a response that exposes reasoning content', async () => {
    const { transport } = transportFor({
      choices: [{ message: { content: '42', reasoning_content: 'I added the numbers.' } }]
    })
    const result = await probeCapability({
      endpoint,
      modelId: 'reasoning-model',
      capability: 'reasoning',
      transport
    })
    expect(result.state).toBe('success')
  })

  it('sends an actual image and checks its content answer', async () => {
    const { transport, requests } = transportFor({ choices: [{ message: { content: 'red' } }] })
    const result = await probeCapability({
      endpoint,
      modelId: 'vision-model',
      capability: 'vision',
      transport
    })
    expect(result.state).toBe('success')
    expect(JSON.stringify(requests[0]?.body)).toContain('data:image/png;base64,')
    expect(JSON.stringify(requests[0]?.body)).not.toContain('sk-secret')
  })

  it('does not accept an unrelated vision answer', async () => {
    const { transport } = transportFor({ choices: [{ message: { content: 'blue' } }] })
    const result = await probeCapability({
      endpoint,
      modelId: 'vision',
      capability: 'vision',
      transport
    })
    expect(result.state).toBe('inconclusive')
  })

  it('separates unsupported image input from a rate limit', async () => {
    const rejected = transportFor(
      { error: { message: 'This model does not support image input' } },
      400
    )
    const malformed = transportFor({ error: { message: 'Unexpected item type in content' } }, 400)
    const unsupportedParameter = transportFor(
      { error: { message: 'image_url parameter is not supported' } },
      400
    )
    const limited = transportFor({ error: { message: 'Rate limit' } }, 429)
    expect(
      (
        await probeCapability({
          endpoint,
          modelId: 'vision',
          capability: 'vision',
          transport: rejected.transport
        })
      ).state
    ).toBe('unsupported')
    expect(
      (
        await probeCapability({
          endpoint,
          modelId: 'vision',
          capability: 'vision',
          transport: malformed.transport
        })
      ).state
    ).toBe('inconclusive')
    expect(
      (
        await probeCapability({
          endpoint,
          modelId: 'vision',
          capability: 'vision',
          transport: unsupportedParameter.transport
        })
      ).state
    ).toBe('inconclusive')
    expect(
      (
        await probeCapability({
          endpoint,
          modelId: 'vision',
          capability: 'vision',
          transport: limited.transport
        })
      ).state
    ).toBe('failed')
  })

  it('validates generated image bytes and rejects empty output', async () => {
    const { transport } = transportFor(null)
    const success = await probeCapability({
      endpoint,
      modelId: 'image',
      capability: 'image_generation',
      transport,
      imageGenerator: async () => redPng
    })
    const invalid = await probeCapability({
      endpoint,
      modelId: 'image',
      capability: 'image_generation',
      transport,
      imageGenerator: async () => Uint8Array.from([1, 2, 3])
    })
    const truncated = await probeCapability({
      endpoint,
      modelId: 'image',
      capability: 'image_generation',
      transport,
      imageGenerator: async () => redPng.slice(0, 40)
    })
    expect(success.state).toBe('success')
    expect(invalid.state).toBe('failed')
    expect(truncated.state).toBe('failed')
  })

  it('reports cancellation without leaving a running result', async () => {
    const { transport } = transportFor(null)
    const controller = new AbortController()
    controller.abort()
    const result = await probeCapability({
      endpoint,
      modelId: 'text',
      capability: 'text',
      transport,
      signal: controller.signal
    })
    expect(result.state).toBe('failed')
    expect(result.failure?.code).toBe('cancelled')
  })

  it('does not accept a provider success that arrives after cancellation', async () => {
    const controller = new AbortController()
    const transport: HttpTransport = {
      async request() {
        controller.abort()
        return {
          status: 200,
          body: { choices: [{ message: { content: 'OK' } }] },
          text: ''
        }
      }
    }
    const result = await probeCapability({
      endpoint,
      modelId: 'text',
      capability: 'text',
      transport,
      signal: controller.signal
    })
    expect(result.state).toBe('failed')
    expect(result.failure?.code).toBe('cancelled')
  })
})
