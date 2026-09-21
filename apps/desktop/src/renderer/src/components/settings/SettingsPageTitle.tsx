import { TextButton } from '../ui/TextButton'

export function SettingsPageTitle({
  hasConnections,
  onAdd
}: {
  hasConnections: boolean
  onAdd(): void
}) {
  return (
    <header className="settings-page-header">
      <div>
        <h1>模型连接</h1>
        <p>连接并管理任务中使用的模型服务</p>
      </div>
      {hasConnections ? (
        <TextButton icon="plus" variant="primary" onClick={onAdd}>添加模型集</TextButton>
      ) : null}
    </header>
  )
}
