import type { ModelConnection } from '../../models/model-connections'
import { LibraryModelRow } from './LibraryModelRow'

export function ModelLibrary({
  connection,
  onTestModel,
  onToggleModel
}: {
  connection: ModelConnection
  onTestModel(modelId: string): void
  onToggleModel(modelId: string, enabled: boolean): void
}) {
  return (
    <div className="model-table">
      <div className="model-table-head" aria-hidden="true">
        <span>模型</span><span>状态</span><span>启用</span>
      </div>
      {connection.models.map((model) => (
        <LibraryModelRow
          key={model.id}
          model={model}
          onTest={() => onTestModel(model.id)}
          onToggle={(enabled) => onToggleModel(model.id, enabled)}
        />
      ))}
    </div>
  )
}
