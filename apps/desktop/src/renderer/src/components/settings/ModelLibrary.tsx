import type { ModelConnection } from '../../models/model-connections'
import { LibraryModelRow } from './LibraryModelRow'
import type { ModelRef } from '@actiondriver/contracts'

export function ModelLibrary({
  connection,
  onTestModel,
  onToggleModel,
  defaultImageModel,
  onToggleDefaultImageModel
}: {
  connection: ModelConnection
  onTestModel(modelId: string): void
  onToggleModel(modelId: string, enabled: boolean): void
  defaultImageModel?: ModelRef | null
  onToggleDefaultImageModel?(modelId: string): void
}) {
  return (
    <div className="model-table">
      <div className="model-table-head" aria-hidden="true">
        <span>模型</span>
        <span>能力测试</span>
        <span>启用</span>
        <span>默认生图</span>
      </div>
      {connection.models.map((model) => (
        <LibraryModelRow
          key={model.id}
          model={model}
          onTest={() => onTestModel(model.id)}
          onToggle={(enabled) => onToggleModel(model.id, enabled)}
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
