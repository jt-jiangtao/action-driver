import type { ModelConnection } from '../models/model-connections'
import { modelProtocolLabel } from '../models/model-connections'
import { useRef, useState } from 'react'
import { ModelLibrary } from './settings/ModelLibrary'
import { AppIcon } from './ui/AppIcon'
import { e2eId } from '../testing/e2e-id'
import type { ModelRef } from '@actiondriver/contracts'

export function ModelConnectionCard({
  connection,
  expanded,
  menuOpen,
  onToggleExpanded,
  onToggleMenu,
  onDelete,
  onRefresh,
  onTestModel,
  onToggleModel,
  defaultImageModel,
  onToggleDefaultImageModel
}: {
  connection: ModelConnection
  expanded: boolean
  menuOpen: boolean
  onToggleExpanded(): void
  onToggleMenu(): void
  onDelete(): void
  onRefresh(): Promise<unknown> | void
  onTestModel(modelId: string): void
  onToggleModel(modelId: string, enabled: boolean): void
  defaultImageModel?: ModelRef | null
  onToggleDefaultImageModel?(modelId: string): void
}) {
  const refreshPendingRef = useRef(false)
  const [refreshPending, setRefreshPending] = useState(false)

  const refresh = async () => {
    if (refreshPendingRef.current) return
    refreshPendingRef.current = true
    setRefreshPending(true)
    try {
      await onRefresh()
    } finally {
      refreshPendingRef.current = false
      setRefreshPending(false)
    }
  }

  return (
    <article className="model-connection-card">
      <header className="model-connection-header">
        <button
          className="model-disclosure"
          type="button"
          aria-label={`${expanded ? '收起' : '展开'}${connection.name}`}
          data-testid={e2eId(
            'e2e/settings/model-connections/connections/:connection-id/toggle#button',
            { 'connection-id': connection.id }
          )}
          onClick={onToggleExpanded}
        >
          <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} />
        </button>
        <span className="connection-icon" aria-hidden="true">
          <AppIcon name="network" />
        </span>
        <div className="connection-copy">
          <strong>{connection.name}</strong>
          <span>
            {modelProtocolLabel(connection.protocol)} · {connection.baseUrl} ·{' '}
            {connection.apiKeyHint}
          </span>
        </div>
        <span className="connection-counts">
          {connection.models.length} 个模型 · 已启用{' '}
          {connection.models.filter((model) => model.enabled).length}
        </span>
        <div className="model-card-actions">
          <button
            className="plain-icon-action"
            type="button"
            aria-label={`刷新${connection.name}`}
            data-testid={e2eId(
              'e2e/settings/model-connections/connections/:connection-id/refresh#button',
              { 'connection-id': connection.id }
            )}
            disabled={refreshPending}
            onClick={() => void refresh()}
          >
            <AppIcon className={refreshPending ? 'spin-icon' : ''} name="refresh" />
          </button>
          <div className="model-more-wrap">
            <button
              className="plain-icon-action"
              type="button"
              aria-label={`${connection.name}的更多操作`}
              aria-expanded={menuOpen}
              data-testid={e2eId(
                'e2e/settings/model-connections/connections/:connection-id/more#button',
                { 'connection-id': connection.id }
              )}
              onClick={onToggleMenu}
            >
              <AppIcon name="ellipsis" />
            </button>
            {menuOpen ? (
              <div className="model-more-menu" role="menu">
                <button
                  data-testid={e2eId(
                    'e2e/settings/model-connections/connections/:connection-id/delete#menuitem',
                    { 'connection-id': connection.id }
                  )}
                  type="button"
                  role="menuitem"
                  onClick={onDelete}
                >
                  <AppIcon name="trash" />
                  删除模型集
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {expanded ? (
        <ModelLibrary
          connection={connection}
          onTestModel={onTestModel}
          onToggleModel={onToggleModel}
          {...(defaultImageModel !== undefined ? { defaultImageModel } : {})}
          {...(onToggleDefaultImageModel ? { onToggleDefaultImageModel } : {})}
        />
      ) : null}
    </article>
  )
}
