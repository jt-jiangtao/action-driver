import { describe, expect, it } from 'vitest'
import { MockModelConnectionsService } from '../../../../../../src/renderer/src/services/model-connections/mock-model-connections'

describe('MockModelConnectionsService', () => {
  it('lists seeded connections and refreshes discovered models', async () => {
    const service = new MockModelConnectionsService({ delayMs: 0 })

    await expect(service.list()).resolves.toHaveLength(2)
    expect((await service.list())[0]).toMatchObject({
      name: '公司模型网关',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1'
    })

    await service.refresh('company-gateway')
    expect((await service.list())[0]!.models.map((model) => model.name)).toEqual([
      'gpt-5.2',
      'gpt-5.2-mini',
      'gpt-4.1'
    ])
  })

  it('discovers models after a successful connection test', async () => {
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const draft = {
      name: '研发模型服务',
      protocol: 'openai-compatible' as const,
      baseUrl: 'https://models.example.com/v1',
      apiKey: 'sk-mock'
    }

    await expect(service.testConnection(draft)).resolves.toEqual({ ok: true })
    await expect(service.discover(draft)).resolves.toEqual([
      expect.objectContaining({ name: 'gpt-5.2', testState: 'untested' }),
      expect.objectContaining({ name: 'gpt-5.2-mini', testState: 'untested' }),
      expect.objectContaining({ name: 'gpt-4.1', testState: 'untested' })
    ])
  })

  it('shows four probe candidates without making audio models chat candidates', async () => {
    const connection = (await new MockModelConnectionsService({ delayMs: 0 }).list())[0]!
    const audio = {
      id: 'audio-only',
      name: 'audio-only',
      enabled: true,
      testState: 'untested' as const,
      catalogLabels: ['speech_recognition']
    }
    const service = new MockModelConnectionsService({
      delayMs: 0,
      seed: [{ ...connection, models: [audio] }]
    })
    expect((await service.list())[0]!.models[0]).toMatchObject({
      probeCandidates: ['text', 'reasoning', 'vision', 'image_generation'],
      chatCandidate: false
    })
    const [result] = await service.testConnectionModels(connection.id, ['audio-only'])
    expect(Object.keys(result!.capabilities ?? {})).toEqual([
      'text',
      'reasoning',
      'vision',
      'image_generation'
    ])
  })

  it('returns an image-generation test outcome for every discovered model', async () => {
    const service = new MockModelConnectionsService({ delayMs: 0 })
    const models = (await service.list())[0]!.models
    expect(models.every((model) => model.probeCandidates?.includes('image_generation'))).toBe(true)
    const results = await service.testConnectionModels('company-gateway', ['gpt-5.2', 'gpt-4.1'])
    expect(results.map((result) => result.capabilities?.image_generation?.state)).toEqual([
      'failed',
      'failed'
    ])
  })

  it('supports deterministic partial-failure and all-success model tests', async () => {
    const draft = {
      name: '公司模型网关',
      protocol: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-mock'
    }
    const partial = new MockModelConnectionsService({
      delayMs: 0,
      modelResults: { 'gpt-5.2-mini': false }
    })
    const allSuccess = new MockModelConnectionsService({ delayMs: 0, modelResults: {} })

    const partialResults = await partial.testModels(draft, ['gpt-5.2', 'gpt-5.2-mini'])
    expect(partialResults).toEqual([
      expect.objectContaining({
        modelId: 'gpt-5.2',
        state: 'success',
        capabilities: {
          text: { state: 'success', source: 'probe' },
          reasoning: { state: 'success', source: 'probe' },
          vision: { state: 'success', source: 'probe' },
          image_generation: { state: 'failed', source: 'probe' }
        }
      }),
      expect.objectContaining({
        modelId: 'gpt-5.2-mini',
        state: 'failed',
        capabilities: {
          text: { state: 'failed', source: 'probe' },
          reasoning: { state: 'failed', source: 'probe' },
          vision: { state: 'failed', source: 'probe' },
          image_generation: { state: 'failed', source: 'probe' }
        }
      })
    ])
    await expect(allSuccess.testModels(draft, ['gpt-5.2', 'gpt-5.2-mini'])).resolves.toEqual([
      expect.objectContaining({ modelId: 'gpt-5.2', state: 'success' }),
      expect.objectContaining({ modelId: 'gpt-5.2-mini', state: 'success' })
    ])
    await expect(allSuccess.testModels(draft, ['custom-model'])).resolves.toEqual([
      expect.objectContaining({ modelId: 'custom-model', state: 'failed' })
    ])

    await partial.testConnectionModels('company-gateway', ['gpt-5.2-mini'])
    expect(
      (await partial.list())[0]!.models.find((model) => model.id === 'gpt-5.2-mini')?.testState
    ).toBe('failed')
  })

  it('toggles, adds, and deletes model connections in memory', async () => {
    const service = new MockModelConnectionsService({ delayMs: 0 })

    await service.setModelEnabled('company-gateway', 'gpt-4.1', true)
    expect((await service.list())[0]!.models.find((model) => model.id === 'gpt-4.1')?.enabled).toBe(
      true
    )

    const created = await service.add(
      {
        name: '研发模型服务',
        protocol: 'openai-compatible',
        baseUrl: 'https://models.example.com/v1',
        apiKey: 'sk-mock'
      },
      [{ id: 'gpt-5.2', name: 'gpt-5.2', enabled: true, testState: 'success' }]
    )
    expect((await service.list()).some((connection) => connection.id === created.id)).toBe(true)

    await service.delete(created.id)
    expect((await service.list()).some((connection) => connection.id === created.id)).toBe(false)
  })
})
