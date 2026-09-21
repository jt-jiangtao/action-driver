import { useState } from 'react'
import { AddModelSetDialog } from '../components/AddModelSetDialog'
import { ModelConnectionCard } from '../components/ModelConnectionCard'
import { ModelConnectionsEmptyState } from '../components/ModelConnectionsEmptyState'
import { SettingsSidebar } from '../components/SettingsSidebar'
import { DeleteModelSetDialog } from '../components/settings/DeleteModelSetDialog'
import { SettingsPageTitle } from '../components/settings/SettingsPageTitle'
import type { ModelConnection, ModelConnectionsService } from '../models/model-connections'

export function SettingsPage({
  service,
  onBack
}: {
  service: ModelConnectionsService
  onBack(): void
}) {
  const [connections, setConnections] = useState<ModelConnection[]>(() => service.list())
  const [expandedIds, setExpandedIds] = useState(
    () => new Set(connections.filter((connection) => connection.expanded).map((connection) => connection.id))
  )
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelConnection | null>(null)

  const syncConnections = () => setConnections(service.list())

  return (
    <div className="settings-shell" data-testid="settings-page">
      <SettingsSidebar onBack={onBack} />

      <main className="settings-main">
        <div className="settings-content">
          <SettingsPageTitle
            hasConnections={connections.length > 0}
            onAdd={() => setDialogOpen(true)}
          />

          {connections.length === 0 ? (
            <ModelConnectionsEmptyState onAdd={() => setDialogOpen(true)} />
          ) : (
            <div className="model-connection-list">
              {connections.map((connection) => (
                <ModelConnectionCard
                  key={connection.id}
                  connection={connection}
                  expanded={expandedIds.has(connection.id)}
                  menuOpen={openMenuId === connection.id}
                  onToggleExpanded={() => {
                    setExpandedIds((current) => {
                      const next = new Set(current)
                      if (next.has(connection.id)) next.delete(connection.id)
                      else next.add(connection.id)
                      return next
                    })
                  }}
                  onToggleMenu={() =>
                    setOpenMenuId((current) => (current === connection.id ? null : connection.id))
                  }
                  onDelete={() => {
                    setOpenMenuId(null)
                    setDeleteTarget(connection)
                  }}
                  onRefresh={async () => {
                    await service.refresh(connection.id)
                    syncConnections()
                  }}
                  onTestModel={async (modelId) => {
                    setConnections((current) =>
                      current.map((item) =>
                        item.id === connection.id
                          ? {
                              ...item,
                              models: item.models.map((model) =>
                                model.id === modelId
                                  ? { ...model, testState: 'testing' }
                                  : model
                              )
                            }
                          : item
                      )
                    )
                    await service.testConnectionModels(connection.id, [modelId])
                    syncConnections()
                  }}
                  onToggleModel={async (modelId, enabled) => {
                    await service.setModelEnabled(connection.id, modelId, enabled)
                    syncConnections()
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      {dialogOpen ? (
        <AddModelSetDialog
          service={service}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            syncConnections()
            setDialogOpen(false)
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteModelSetDialog
          connectionName={deleteTarget.name}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await service.delete(deleteTarget.id)
            setDeleteTarget(null)
            syncConnections()
          }}
        />
      ) : null}
    </div>
  )
}
