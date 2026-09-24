import type { ModelConnection } from '../../models/model-connections'
import { LibraryModelRow } from './LibraryModelRow'
import type { ModelRef } from '@actiondriver/contracts'

export function ModelLibrary({
  connection,
  onTestModel,
  onToggleModel,
  onToggleImageCapability,
  defaultImageModel,
  onToggleDefaultImageModel
}: {
  connection: ModelConnection
  onTestModel(modelId: string): void
  onToggleModel(modelId: string, enabled: boolean): void
  onToggleImageCapability?(modelId: string, kind: 'input' | 'generation', enabled: boolean): void
  defaultImageModel?: ModelRef | null
  onToggleDefaultImageModel?(modelId: string): void
}) {
  return (
    <div className="model-table">
      <div className="model-table-head" aria-hidden="true">
        <span>模型</span>
        <span>状态</span>
        <span>启用</span>
        <span>识图</span>
        <span>生图</span>
        <span>默认生图</span>
      </div>
      {connection.models.map((model) => (
        <LibraryModelRow
          key={model.id}
          model={model}
          onTest={() => onTestModel(model.id)}
          onToggle={(enabled) => onToggleModel(model.id, enabled)}
          imageSupported={connection.protocol === 'openai-compatible'}
          onToggleImageInput={(enabled) => onToggleImageCapability?.(model.id, 'input', enabled)}
          onToggleImageGeneration={(enabled) =>
            onToggleImageCapability?.(model.id, 'generation', enabled)
          }
          isDefaultImageModel={
            defaultImageModel?.connectionId === connection.id &&
            defaultImageModel.modelId === model.id
          }
          onToggleDefaultImageModel={() => onToggleDefaultImageModel?.(model.id)}
        />
      ))}
    </div>
  )
}
