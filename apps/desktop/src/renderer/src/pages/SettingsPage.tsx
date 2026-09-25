import { useEffect, useRef, useState } from 'react'
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
  const [testingModels, setTestingModels] = useState<Set<string>>(() => new Set())
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({})
  const [batchProgress, setBatchProgress] = useState<
    Record<string, { done: number; total: number; phase: 'discovering' | 'testing' | 'done' }>
  >({})
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({})
  const testingKeysRef = useRef(new Set<string>())
  const batchConnectionsRef = useRef(new Set<string>())

  const modelKey = (connectionId: string, modelId: string) => `${connectionId}:${modelId}`
  const setModelTesting = (key: string, testing: boolean) => {
    setTestingModels((current) => {
      const next = new Set(current)
      if (testing) next.add(key)
      else next.delete(key)
      return next
    })
  }
  const testSavedModel = async (connectionId: string, modelId: string, syncAtEnd = true) => {
    const key = modelKey(connectionId, modelId)
    if (testingKeysRef.current.has(key)) return
    testingKeysRef.current.add(key)
    setModelErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setModelTesting(key, true)
    try {
      const results = await service.testConnectionModels(connectionId, [modelId])
      if (!results.some((result) => result.modelId === modelId)) {
        throw new Error('服务未返回该模型的测试结果')
      }
      const result = results.find((item) => item.modelId === modelId)!
      queryClient.setQueryData<ModelConnection[]>(['model-connections'], (current) =>
        current?.map((connection) =>
          connection.id !== connectionId
            ? connection
            : {
                ...connection,
                models: connection.models.map((model) =>
                  model.id !== modelId
                    ? model
                    : {
                        ...model,
                        testState: result.state,
                        capabilities: result.capabilities ?? {}
                      }
                )
              }
        )
      )
    } catch (error) {
      setModelErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : '模型测试失败'
      }))
    } finally {
      if (syncAtEnd) await Promise.allSettled([syncConnections(), syncImageDefault()])
      testingKeysRef.current.delete(key)
      setModelTesting(key, false)
    }
  }

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
                  batchProgress={batchProgress[connection.id]}
                  batchError={batchErrors[connection.id]}
                  testingModels={testingModels}
                  modelErrors={modelErrors}
                  onRefresh={async () => {
                    if (
                      batchConnectionsRef.current.has(connection.id) ||
                      [...testingKeysRef.current].some((key) => key.startsWith(`${connection.id}:`))
                    )
                      return
                    batchConnectionsRef.current.add(connection.id)
                    setBatchErrors((current) => {
                      const next = { ...current }
                      delete next[connection.id]
                      return next
                    })
                    setBatchProgress((current) => ({
                      ...current,
                      [connection.id]: { done: 0, total: 0, phase: 'discovering' }
                    }))
                    try {
                      const models = await service.refresh(connection.id)
                      await syncConnections()
                      const probeable = models.filter((model) =>
                        model.probeCandidates
                          ? model.probeCandidates.length > 0
                          : !model.catalogLabels?.length
                      )
                      setBatchProgress((current) => ({
                        ...current,
                        [connection.id]: { done: 0, total: probeable.length, phase: 'testing' }
                      }))
                      let nextIndex = 0
                      let done = 0
                      await Promise.all(
                        Array.from({ length: Math.min(4, probeable.length) }, async () => {
                          while (nextIndex < probeable.length) {
                            const model = probeable[nextIndex++]!
                            await testSavedModel(connection.id, model.id, false)
                            done += 1
                            setBatchProgress((current) => ({
                              ...current,
                              [connection.id]: { done, total: probeable.length, phase: 'testing' }
                            }))
                          }
                        })
                      )
                      await Promise.allSettled([syncConnections(), syncImageDefault()])
                      setBatchProgress((current) => ({
                        ...current,
                        [connection.id]: {
                          done: probeable.length,
                          total: probeable.length,
                          phase: 'done'
                        }
                      }))
                    } catch {
                      setBatchErrors((current) => ({
                        ...current,
                        [connection.id]: '刷新失败'
                      }))
                      setBatchProgress((current) => {
                        const next = { ...current }
                        delete next[connection.id]
                        return next
                      })
                    } finally {
                      batchConnectionsRef.current.delete(connection.id)
                    }
                  }}
                  onTestModel={(modelId) => {
                    if (!batchConnectionsRef.current.has(connection.id)) {
                      void testSavedModel(connection.id, modelId)
                    }
                  }}
                  onToggleModel={async (modelId, enabled) => {
                    await service.setModelEnabled(connection.id, modelId, enabled)
                    await Promise.all([syncConnections(), syncImageDefault()])
                  }}
                  defaultImageModel={defaultImageQuery.data ?? null}
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
