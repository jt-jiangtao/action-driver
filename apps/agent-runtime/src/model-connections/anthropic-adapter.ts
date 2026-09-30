import type { HttpTransport } from './http-transport'
import type { ModelCompletionEvent } from '@action-driver/model-connections'
import { failure, probeResult } from './provider-failures'
import { completionFailure, normalizeBaseUrl, send } from './provider-http'
import {
  MODEL_REQUEST_TIMEOUT_MS,
  ModelStreamError,
  PROBE_MAX_TOKENS,
  type ModelProviderAdapter,
  type ProviderResult
} from './provider-types'

const ANTHROPIC_VERSION = '2023-06-01'
/** Sentinel model id used only to prove that endpoint and credentials work. */
const CONNECTION_PROBE_MODEL = 'connection-probe'

export function createAnthropicAdapter(transport: HttpTransport): ModelProviderAdapter {
  // The Anthropic compatible endpoint exposes no model list, so discovery stays empty and models
  // are added manually. Missing discovery must not be reported as a connection failure.
  const discover = async (): Promise<ProviderResult<string[]>> => ({ ok: true, value: [] })
  const probeModel: ModelProviderAdapter['probeModel'] = async ({ baseUrl, apiKey, modelId }) => {
    const response = await send(transport, {
      url: `${normalizeBaseUrl(baseUrl)}/v1/messages`,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: {
        model: modelId,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{ role: 'user', content: 'ping' }]
      },
      timeoutMs: MODEL_REQUEST_TIMEOUT_MS
    })
    return probeResult(response)
  }

  return {
    discover,
    stream() {
      const iterator: AsyncIterator<ModelCompletionEvent> & AsyncIterable<ModelCompletionEvent> = {
        [Symbol.asyncIterator]() {
          return iterator
        },
        async next(): Promise<IteratorResult<ModelCompletionEvent>> {
          throw new ModelStreamError('invalid-request', 'Agent 调用暂未接入')
        }
      }
      return iterator
    },
    async complete(input) {
      return completionFailure(
        failure('invalid-request', 'Agent 调用暂未接入'),
        {
          model: input.modelId,
          messages: input.messages,
          ...input.parameters,
          stream: false
        },
        null,
        null
      )
    },
    async verifyConnection({ baseUrl, apiKey }) {
      const result = await probeModel({
        baseUrl,
        apiKey,
        modelId: CONNECTION_PROBE_MODEL
      })
      if (result.state === 'success') return { ok: true, value: null }
      // "Model not exist" proves the route and credentials are valid; only the sentinel is unknown.
      if (result.failure.code === 'model-not-found') return { ok: true, value: null }
      return { ok: false, failure: result.failure }
    },
    probeModel
  }
}
