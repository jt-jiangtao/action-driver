import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AddModelSetDialog } from '../components/AddModelSetDialog'
import { ModelConnectionCard } from '../components/ModelConnectionCard'
import { ModelConnectionsEmptyState } from '../components/ModelConnectionsEmptyState'
import { SettingsSidebar } from '../components/SettingsSidebar'
import { DeleteModelSetDialog } from '../components/settings/DeleteModelSetDialog'
import { SettingsPageTitle } from '../components/settings/SettingsPageTitle'
import type { ModelConnection, ModelConnectionsService } from '../models/model-connections'

const EMPTY_CONNECTIONS: ModelConnection[] = []

export function SettingsPage({
  service,
  onBack,
  onOpenMainPrompt,
  onOpenSkills
}: {
  service: ModelConnectionsService
  onBack(): void
  onOpenMainPrompt?(): void
  onOpenSkills?(): void
}) {
  const queryClient = useQueryClient()
  const connectionsQuery = useQuery({
    queryKey: ['model-connections'],
    queryFn: () => service.list(),
    staleTime: 30_000,
    retry: false
  })
  const connections = connectionsQuery.data ?? EMPTY_CONNECTIONS
  const defaultImageQuery = useQuery({
    queryKey: ['default-image-model'],
    queryFn: () => service.getDefaultImageModel(),
    staleTime: 30_000,
    retry: false
  })
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>())
  const loadError = connectionsQuery.error?.message ?? null
  const loading = connectionsQuery.isPending
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelConnection | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current)
      let changed = false
      for (const connection of connections) {
        if (connection.expanded && !next.has(connection.id)) {
          next.add(connection.id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [connections])

  const syncConnections = () => queryClient.invalidateQueries({ queryKey: ['model-connections'] })
  const syncImageDefault = () =>
    queryClient.invalidateQueries({ queryKey: ['default-image-model'] })
  const runImageAction = async (action: () => Promise<void>) => {
    setActionError(null)
    try {
      await action()
      await Promise.all([syncConnections(), syncImageDefault()])
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '图片模型配置失败')
    }
  }

  return (
    <div className="settings-shell" data-testid="e2e/settings/model-connections/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="model-connections"
        {...(onOpenMainPrompt ? { onOpenMainPrompt } : {})}
        {...(onOpenSkills ? { onOpenSkills } : {})}
      />

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
                    queryClient.setQueryData<ModelConnection[]>(['model-connections'], (current) =>
                      (current ?? []).map((item) =>
                        item.id === connection.id
                          ? {
                              ...item,
                              models: item.models.map((model) =>
                                model.id === modelId ? { ...model, testState: 'testing' } : model
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
                    await Promise.all([syncConnections(), syncImageDefault()])
                  }}
                  defaultImageModel={defaultImageQuery.data ?? null}
                  onToggleImageCapability={(modelId, kind, enabled) =>
                    void runImageAction(() =>
                      service.setModelImageCapability(connection.id, modelId, kind, enabled)
                    )
                  }
                  onToggleDefaultImageModel={(modelId) =>
                    void runImageAction(() =>
                      service.setDefaultImageModel(
                        defaultImageQuery.data?.connectionId === connection.id &&
                          defaultImageQuery.data.modelId === modelId
                          ? null
                          : { connectionId: connection.id, modelId }
                      )
                    )
                  }
                />
              ))}
            </div>
          )}
          {loadError ? (
            <p className="settings-error" role="alert">
              无法读取模型连接：{loadError}
            </p>
          ) : null}
          {actionError ? (
            <p className="settings-error" role="alert">
              {actionError}
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
