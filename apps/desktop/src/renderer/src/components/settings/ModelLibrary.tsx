import type { ModelConnection } from '../../models/model-connections'
import { LibraryModelRow } from './LibraryModelRow'
import type { ModelRef } from '@action-driver/contracts'

export function ModelLibrary({
  connection,
  onTestModel,
  onToggleModel,
  defaultImageModel,
  onToggleDefaultImageModel,
  testingModels,
  modelErrors,
  batchTesting = false
}: {
  connection: ModelConnection
  onTestModel(modelId: string): void
  onToggleModel(modelId: string, enabled: boolean): void
  defaultImageModel?: ModelRef | null
  onToggleDefaultImageModel?(modelId: string): void
  testingModels?: ReadonlySet<string> | undefined
  modelErrors?: Readonly<Record<string, string>> | undefined
  batchTesting?: boolean
}) {
  return (
    <div className="model-table">
      <div className="model-table-head" aria-hidden="true">
        <span>模型</span>
        <span>能力状态</span>
        <span>操作</span>
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
          testing={testingModels?.has(`${connection.id}:${model.id}`) ?? false}
          requestError={modelErrors?.[`${connection.id}:${model.id}`]}
          testDisabled={batchTesting}
        />
      ))}
    </div>
  )
}
