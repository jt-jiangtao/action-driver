import { describe, expect, it } from 'vitest'
import { MockModelConnectionsService } from './mock-model-connections'

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
      { modelId: 'gpt-5.2', state: 'success' },
      { modelId: 'gpt-5.2-mini', state: 'failed' }
    ])
    await expect(allSuccess.testModels(draft, ['gpt-5.2', 'gpt-5.2-mini'])).resolves.toEqual([
      { modelId: 'gpt-5.2', state: 'success' },
      { modelId: 'gpt-5.2-mini', state: 'success' }
    ])
    await expect(allSuccess.testModels(draft, ['custom-model'])).resolves.toEqual([
      { modelId: 'custom-model', state: 'failed' }
    ])

    await partial.testConnectionModels('company-gateway', ['gpt-5.2-mini'])
    expect(
      (await partial.list())[0]!.models.find((model) => model.id === 'gpt-5.2-mini')?.testState
    ).toBe('failed')
  })

  it('toggles, adds, and deletes model connections in memory', async () => {
    const service = new MockModelConnectionsService({ delayMs: 0 })

    await service.setModelEnabled('company-gateway', 'gpt-4.1', true)
    expect(
      (await service.list())[0]!.models.find((model) => model.id === 'gpt-4.1')?.enabled
    ).toBe(true)

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
