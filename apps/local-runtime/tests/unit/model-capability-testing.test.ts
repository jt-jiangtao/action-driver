import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpResponse } from '@action-driver/model-provider-runtime/http-transport'
import { createService, draft } from './model-connection-fixtures'

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

  it('discards test results when a connection is replaced during the probe', async () => {
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
        body: { choices: [{ message: { content: 'OK', reasoning_content: 'reason' } }] },
        text: ''
      }
    })
    const original = await service.add({
      draft,
      models: [{ id: 'qwen3.7-max', name: 'qwen3.7-max', enabled: true, testState: 'untested' }]
    })
    const testing = service.testConnectionModels({
      connectionId: original.id,
      modelIds: ['qwen3.7-max']
    })
    await vi.waitFor(() => expect(releaseFirst).toBeDefined())
    await service.delete(original.id)
    const replacement = await service.add({
      draft: { ...draft, apiKey: 'sk-different-value' },
      models: [{ id: 'qwen3.7-max', name: 'qwen3.7-max', enabled: true, testState: 'untested' }]
    })
    expect(replacement.id).toBe(original.id)
    releaseFirst?.({
      status: 200,
      body: { choices: [{ message: { content: 'OK', reasoning_content: 'reason' } }] },
      text: ''
    })
    await expect(testing).rejects.toThrow('Model connection changed during testing')
    expect((await service.list())[0]?.models[0]?.testState).toBe('untested')
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
})
