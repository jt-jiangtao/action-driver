import { useCallback, useEffect, useState } from 'react'
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
  const [connections, setConnections] = useState<ModelConnection[]>([])
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelConnection | null>(null)

  const syncConnections = useCallback(async () => {
    try {
      const loaded = await service.list()
      setConnections(loaded)
      setExpandedIds((current) => {
        const next = new Set(current)
        for (const connection of loaded) {
          if (connection.expanded) next.add(connection.id)
        }
        return next
      })
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    void syncConnections()
  }, [syncConnections])

  return (
    <div className="settings-shell" data-testid="e2e/settings/model-connections/page#page">
      <SettingsSidebar onBack={onBack} />

      <main className="settings-main">
        <div className="settings-content">
          <SettingsPageTitle
            hasConnections={loading || connections.length > 0}
            onAdd={() => setDialogOpen(true)}
          />

          {loading ? (
            <p className="settings-loading">正在读取模型连接…</p>
          ) : connections.length === 0 ? (
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
                    await syncConnections()
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
                    await syncConnections()
                  }}
                  onToggleModel={async (modelId, enabled) => {
                    await service.setModelEnabled(connection.id, modelId, enabled)
                    await syncConnections()
                  }}
                />
              ))}
            </div>
          )}
          {loadError ? (
            <p className="settings-error" role="alert">
              无法读取模型连接：{loadError}
            </p>
          ) : null}
        </div>
      </main>
      {dialogOpen ? (
        <AddModelSetDialog
          service={service}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            void syncConnections()
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
            await syncConnections()
          }}
        />
      ) : null}
    </div>
  )
}
