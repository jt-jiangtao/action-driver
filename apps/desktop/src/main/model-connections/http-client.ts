import {
  ModelServiceError,
  type ModelConnectionServicePort,
  type ModelAddRequestDto,
  type ModelConnectionDto,
  type ModelConnectionDraftDto,
  type ModelConnectionTestRequestDto,
  type ModelConnectionTestResultDto,
  type ModelFailureCode,
  type ModelOptionDto,
  type ModelSetEnabledRequestDto,
  type ModelImageCapabilityRequestDto,
  type ModelImageGenerationApiRequestDto,
  type ModelTestRequestDto,
  type ModelTestResultDto
} from '@actiondriver/model-connections'
import type { ModelRef } from '@actiondriver/contracts'
import { currentTraceparent } from '@actiondriver/observability'

type Envelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ModelFailureCode; message: string } }

export type HttpRequest = {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: Record<string, string>
  body?: unknown
  timeoutMs: number
}

export type HttpResponse = { status: number; body: unknown; text: string }

export type HttpTransport = { request(request: HttpRequest): Promise<HttpResponse> }

const fetchTransport: HttpTransport = {
  async request(request) {
    const response = await globalThis.fetch(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(request.timeoutMs)
    })
    const text = await response.text()
    let body: unknown = null
    try {
      body = JSON.parse(text) as unknown
    } catch {
      /* Invalid envelopes are reported by the client. */
    }
    return { status: response.status, body, text }
  }
}

export type ModelConnectionHttpClientOptions = {
  baseUrl: string
  token: string
  transport?: HttpTransport
}

/**
 * Main-side client for the service HTTP surface. It keeps the same domain shape as the former
 * Main process service so the renderer facing IPC handlers do not need to change yet.
 */
export class ModelConnectionHttpClient implements ModelConnectionServicePort {
  private readonly transport: HttpTransport

  constructor(private readonly options: ModelConnectionHttpClientOptions) {
    this.transport = options.transport ?? fetchTransport
  }

  list(): Promise<ModelConnectionDto[]> {
    return this.call('/model-connections')
  }

  testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto> {
    return this.call('/model-connections/test', draft)
  }

  discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]> {
    return this.call('/model-connections/discover', draft)
  }

  refresh(connectionId: string): Promise<ModelOptionDto[]> {
    return this.call(`/model-connections/${encodeURIComponent(connectionId)}/refresh`, {})
  }

  testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]> {
    return this.call('/model-connections/test-models', request)
  }

  testConnectionModels(request: ModelConnectionTestRequestDto): Promise<ModelTestResultDto[]> {
    return this.call(`/model-connections/${encodeURIComponent(request.connectionId)}/test-models`, {
      modelIds: request.modelIds
    })
  }

  async setModelEnabled(request: ModelSetEnabledRequestDto): Promise<void> {
    await this.call(
      `/model-connections/${encodeURIComponent(request.connectionId)}/models/${encodeURIComponent(request.modelId)}`,
      { enabled: request.enabled }
    )
  }

  async setModelImageCapability(request: ModelImageCapabilityRequestDto): Promise<void> {
    await this.call(
      `/model-connections/${encodeURIComponent(request.connectionId)}/models/${encodeURIComponent(request.modelId)}/image-capability`,
      { kind: request.kind, enabled: request.enabled }
    )
  }

  async setModelImageGenerationApi(request: ModelImageGenerationApiRequestDto): Promise<void> {
    await this.call(
      `/model-connections/${encodeURIComponent(request.connectionId)}/models/${encodeURIComponent(request.modelId)}/image-generation-api`,
      { api: request.api },
      'PUT'
    )
  }

  async setDefaultImageModel(model: ModelRef | null): Promise<void> {
    await this.call('/model-connections/default-image-model', { model })
  }

  getDefaultImageModel(): Promise<ModelRef | null> {
    return this.call('/model-connections/default-image-model')
  }

  add(request: ModelAddRequestDto): Promise<ModelConnectionDto> {
    return this.call('/model-connections', request)
  }

  async delete(connectionId: string): Promise<void> {
    await this.call(`/model-connections/${encodeURIComponent(connectionId)}`, undefined, 'DELETE')
  }

  private async call<T>(
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'
  ): Promise<T> {
    const traceparent = currentTraceparent()
    const response = await this.transport.request({
      url: `${this.options.baseUrl}${path}`,
      method:
        method === 'DELETE' || method === 'PUT' ? method : body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(traceparent ? { traceparent } : {})
      },
      ...(body === undefined ? {} : { body }),
      timeoutMs: 15_000
    })

    const payload = response.body as Envelope<T> | null
    if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
      throw new ModelServiceError('invalid-response', 'Service returned an invalid response')
    }
    if (!payload.ok) {
      const failure = (payload as { ok: false; error: { code: ModelFailureCode; message: string } })
        .error
      throw new ModelServiceError(failure.code, failure.message)
    }
    return (payload as { ok: true; value: T }).value
  }
}
