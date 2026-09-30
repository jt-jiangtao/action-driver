import type {
  ModelCapability,
  ModelCapabilityResultDto,
  ModelFailure,
  ModelProtocol
} from '@action-driver/model-connections'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { HttpTransportError, type HttpTransport } from '@action-driver/model-provider-runtime/http-transport'
import { classifyResponse } from '@action-driver/model-provider-runtime/provider-adapters'
import { createImageGenerationAdapter } from '../media/image-generation-adapter'
import {
  createTokenPlanImageGenerationAdapter,
  isTokenPlanBaseUrl
} from '../media/token-plan-image-generation-adapter'
import { inspectImage } from '../media/session-asset-store'

const RED_SQUARE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC'
const PROBE_TIMEOUT_MS = 15_000
const execFileAsync = promisify(execFile)

export type CapabilityProbeInput = {
  endpoint: { baseUrl: string; apiKey: string; protocol: ModelProtocol }
  modelId: string
  capability: ModelCapability
  transport: HttpTransport
  signal?: AbortSignal
  imageGenerator?: (signal?: AbortSignal) => Promise<Uint8Array>
}

export async function probeCapability(
  input: CapabilityProbeInput
): Promise<ModelCapabilityResultDto> {
  const testedAt = new Date().toISOString()
  const makeResult = (
    state: ModelCapabilityResultDto['state'],
    failure?: ModelFailure
  ): ModelCapabilityResultDto => ({
    state,
    source: 'probe',
    testedAt,
    ...(failure ? { failure: sanitizeFailure(failure, input.endpoint.apiKey) } : {})
  })
  if (input.signal?.aborted)
    return makeResult('failed', { code: 'cancelled', message: 'Model test was cancelled' })
  if (input.endpoint.protocol !== 'openai-compatible')
    return makeResult('unsupported', {
      code: 'invalid-request',
      message: 'This capability test requires an OpenAI compatible connection'
    })
  try {
    if (input.capability === 'image_generation') {
      const imageGenerator = input.imageGenerator ?? (() => generateTestImage(input))
      const bytes = await imageGenerator(input.signal)
      if (input.signal?.aborted)
        return makeResult('failed', { code: 'cancelled', message: 'Model test was cancelled' })
      await verifyGeneratedImage(bytes)
      return makeResult('success')
    }
    const response = await input.transport.request({
      url: `${input.endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      method: 'POST',
      headers: { authorization: `Bearer ${input.endpoint.apiKey}` },
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
      body: chatProbeBody(input.modelId, input.capability)
    })
    if (input.signal?.aborted)
      return makeResult('failed', { code: 'cancelled', message: 'Model test was cancelled' })
    const error = classifyResponse(response.status, response.body, response.text)
    if (error)
      return makeResult(
        error.code === 'invalid-request'
          ? explicitlyUnsupported(error.message, input.capability)
            ? 'unsupported'
            : 'inconclusive'
          : 'failed',
        error
      )
    const message = assistantMessage(response.body)
    const content = typeof message?.content === 'string' ? message.content.trim() : ''
    if (input.capability === 'text') return makeResult(content ? 'success' : 'inconclusive')
    if (input.capability === 'reasoning') {
      const reasoning = message?.reasoning_content
      return makeResult(
        typeof reasoning === 'string' && reasoning.trim() ? 'success' : 'inconclusive'
      )
    }
    return makeResult(/\bred\b|红色|红的|红方|红块/i.test(content) ? 'success' : 'inconclusive')
  } catch (error) {
    if (error instanceof HttpTransportError)
      return makeResult('failed', { code: error.code, message: error.message })
    return makeResult('failed', {
      code: input.signal?.aborted ? 'cancelled' : 'invalid-response',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

async function verifyGeneratedImage(bytes: Uint8Array): Promise<void> {
  const { mimeType } = await inspectImage(bytes)
  const directory = await mkdtemp(join(tmpdir(), 'action-driver-image-probe-'))
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  const input = join(directory, `input.${extension}`)
  try {
    await writeFile(input, bytes)
    await execFileAsync(
      '/usr/bin/sips',
      ['-s', 'format', 'png', '--out', join(directory, 'decoded.png'), input],
      {
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 64 * 1024
      }
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function explicitlyUnsupported(message: string, capability: ModelCapability): boolean {
  if (
    /\b(?:parameter|field|argument|payload|request|image_url|enable_thinking)\b|参数|字段|请求格式/i.test(
      message
    )
  )
    return false
  if (!/\bmodel\b|模型/i.test(message)) return false
  if (!/(?:does not support|not supported|unsupported|不支持)/i.test(message)) return false
  const subject: Record<ModelCapability, RegExp> = {
    text: /\b(?:text|chat|completion)\b|文本|对话/i,
    reasoning: /\b(?:reasoning|thinking)\b|推理|思考/i,
    vision: /\b(?:vision|image|multimodal)\b|图片|图像|视觉|多模态/i,
    image_generation: /\b(?:image|generation)\b|生图|图片生成/i
  }
  return subject[capability].test(message)
}

function chatProbeBody(modelId: string, capability: Exclude<ModelCapability, 'image_generation'>) {
  if (capability === 'vision') {
    return {
      model: modelId,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What color is the square in this image? Reply with only the color.'
            },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${RED_SQUARE_PNG}` } }
          ]
        }
      ],
      max_tokens: 32,
      stream: false
    }
  }
  return {
    model: modelId,
    messages: [
      { role: 'user', content: capability === 'reasoning' ? 'What is 17 + 25?' : 'Reply OK.' }
    ],
    max_tokens: capability === 'reasoning' ? 128 : 16,
    ...(capability === 'reasoning' ? { enable_thinking: true } : {}),
    stream: false
  }
}

async function generateTestImage(input: CapabilityProbeInput): Promise<Uint8Array> {
  const adapter = isTokenPlanBaseUrl(input.endpoint.baseUrl)
    ? createTokenPlanImageGenerationAdapter()
    : createImageGenerationAdapter()
  return await adapter.generate(
    {
      baseUrl: input.endpoint.baseUrl,
      apiKey: input.endpoint.apiKey,
      modelId: input.modelId,
      prompt: 'A simple blue square on a white background'
    },
    input.signal
  )
}

function assistantMessage(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return null
  const message = (choices[0] as { message?: unknown } | undefined)?.message
  return typeof message === 'object' && message !== null
    ? (message as Record<string, unknown>)
    : null
}

function sanitizeFailure(failure: ModelFailure, apiKey: string): ModelFailure {
  return {
    code: failure.code,
    message: apiKey ? failure.message.split(apiKey).join('[redacted]') : failure.message
  }
}
