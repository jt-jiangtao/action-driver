export interface ModelOptionItemProjection {
  id: string
  name: string
}

export interface ModelConnectionOption {
  id: string
  name: string
  models: readonly ModelOptionItemProjection[]
}

export interface ModelSelectionProjection {
  connections: readonly ModelConnectionOption[]
  selectedModelId: string
}

export const defaultModelSelection: ModelSelectionProjection = {
  selectedModelId: 'gpt-5.2',
  connections: [
    {
      id: 'company-gateway',
      name: '公司模型网关',
      models: [
        { id: 'gpt-5.2', name: 'gpt-5.2' },
        { id: 'gpt-5.2-mini', name: 'gpt-5.2-mini' },
        { id: 'gpt-4.1', name: 'gpt-4.1' }
      ]
    },
    {
      id: 'anthropic-production',
      name: 'Anthropic 生产连接',
      models: [{ id: 'claude-sonnet-4', name: 'claude-sonnet-4' }]
    }
  ]
}

export function findSelectedModel(projection: ModelSelectionProjection) {
  for (const connection of projection.connections) {
    const model = connection.models.find((candidate) => candidate.id === projection.selectedModelId)
    if (model) return { connection, model }
  }
  return null
}
