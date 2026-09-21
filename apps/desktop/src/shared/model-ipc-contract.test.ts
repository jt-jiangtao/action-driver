import { describe, expect, it } from 'vitest'
import { MODEL_IPC_CHANNELS, type ModelConnectionDto } from './model-ipc-contract'

describe('model IPC contract', () => {
  it('keeps every channel name unique and namespaced', () => {
    const channels = Object.values(MODEL_IPC_CHANNELS)
    expect(new Set(channels).size).toBe(channels.length)
    for (const channel of channels) {
      expect(channel).toMatch(/^actiondriver:model-connections:[a-z-]+$/)
    }
  })

  it('never carries a plaintext API key across the IPC boundary', () => {
    const connection: ModelConnectionDto = {
      id: 'company-gateway',
      name: '公司模型网关',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKeyHint: '••••1234',
      expanded: true,
      models: [{ id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'untested' }]
    }

    const serialized = JSON.stringify(connection)
    expect(serialized).not.toContain('apiKey"')
    expect(serialized).toContain('••••1234')
    expect(Object.keys(connection)).not.toContain('apiKey')
  })
})
