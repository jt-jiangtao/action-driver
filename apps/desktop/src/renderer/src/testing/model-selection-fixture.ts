import type { ModelSelectionProjection } from '../models/model-selection'

export const mockModelSelection: ModelSelectionProjection = {
  state: 'ready',
  selected: { connectionId: 'company-gateway', modelId: 'gpt-5.2' },
  error: null,
  connections: [
    {
      id: 'company-gateway',
      name: '公司模型网关',
      models: [
        model('company-gateway', 'gpt-5.2'),
        model('company-gateway', 'gpt-5.2-mini'),
        model('company-gateway', 'gpt-4.1')
      ]
    },
    {
      id: 'anthropic-production',
      name: 'Anthropic 生产连接',
      models: [model('anthropic-production', 'claude-sonnet-4', true, 'Agent 调用暂未接入')]
    }
  ]
}

function model(
  connectionId: string,
  modelId: string,
  disabled = false,
  disabledReason: string | null = null
) {
  return {
    id: modelId,
    name: modelId,
    ref: { connectionId, modelId },
    disabled,
    disabledReason,
    visionVerified: true,
    capabilityStates: {
      text: 'success' as const,
      reasoning: 'untested' as const,
      vision: 'success' as const,
      image_generation: 'untested' as const
    }
  }
}
