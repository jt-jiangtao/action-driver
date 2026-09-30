import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecentTaskSummary, TaskCatalog } from '../models/task-catalog'
import { SettingsSidebar } from '../components/SettingsSidebar'
import { AppIcon } from '../components/ui/AppIcon'
import { e2eId } from '../testing/e2e-id'

export function ArchivedChatsPage({
  catalog,
  onBack,
  onOpenTask,
  onRestored,
  onOpenConnections,
  onOpenMainPrompt,
  onOpenSkills,
  onOpenComputerUse
}: {
  catalog: TaskCatalog
  onBack(): void
  onOpenTask(taskId: string): void
  onRestored(): void
  onOpenConnections(): void
  onOpenMainPrompt(): void
  onOpenSkills(): void
  onOpenComputerUse(): void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<readonly RecentTaskSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecentTaskSummary | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const load = useCallback(
    async (next: string | null = null) => {
      if (!catalog.listArchivedTasks) return
      const currentRequest = ++requestId.current
      setLoading(true)
      setError(null)
      try {
        const page = await catalog.listArchivedTasks(query, next)
        if (currentRequest !== requestId.current) return
        setItems((current) => (next ? [...current, ...page.items] : page.items))
        setCursor(page.nextCursor)
      } catch (cause) {
        if (currentRequest !== requestId.current) return
        const detail = cause as { message?: string } | null
        setError(cause instanceof Error ? cause.message : detail?.message ?? '加载归档聊天失败')
      } finally {
        if (currentRequest === requestId.current) setLoading(false)
      }
    },
    [catalog, query]
  )
  useEffect(() => {
    setItems([])
    setCursor(null)
    void load()
  }, [load])

  const restore = async (item: RecentTaskSummary) => {
    if (!item.sessionId || !catalog.setArchived || busyId) return
    setBusyId(item.sessionId)
    setError(null)
    try {
      await catalog.setArchived(item.sessionId, false)
      setItems((current) => current.filter((candidate) => candidate.sessionId !== item.sessionId))
      await load()
      onRestored()
    } catch (cause) {
      const detail = cause as { code?: string; message?: string } | null
      if (detail?.code === 'not-found') await load()
      setError(cause instanceof Error ? cause.message : detail?.message ?? '取消归档失败')
    } finally {
      setBusyId(null)
    }
  }
  const remove = async () => {
    const item = deleteTarget
    if (!item?.sessionId || !catalog.deleteSession || busyId) return
    setBusyId(item.sessionId)
    setError(null)
    try {
      await catalog.deleteSession(item.sessionId)
      setItems((current) => current.filter((candidate) => candidate.sessionId !== item.sessionId))
      setDeleteTarget(null)
      setNotice('聊天已永久删除')
      await load()
      onRestored()
    } catch (cause) {
      const detail = cause as { code?: string; message?: string } | null
      if (detail?.code === 'not-found') await load()
      setDeleteTarget(null)
      setError(cause instanceof Error ? cause.message : detail?.message ?? '删除聊天失败')
    } finally {
      setBusyId(null)
    }
  }
  return (
    <div className="settings-shell" data-testid="e2e/settings/archived/page#page">
      <SettingsSidebar
        active="archived"
        onBack={onBack}
        onOpenConnections={onOpenConnections}
        onOpenMainPrompt={onOpenMainPrompt}
        onOpenSkills={onOpenSkills}
        onOpenComputerUse={onOpenComputerUse}
      />
      <main className="settings-main">
        <div className="settings-main-topbar" aria-hidden="true" />
        <div className="settings-main-scroll is-archived">
        <div className="settings-content archived-chat-content">
          <header className="settings-page-header">
            <h1>已归档的聊天</h1>
          </header>
          <label className="archived-chat-search">
            <AppIcon name="search" />
            <input
              aria-label="搜索已归档的聊天"
              type="search"
              value={query}
              data-testid="e2e/settings/archived/search#input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索已归档的聊天"
            />
          </label>
          {error ? (
            <p role="alert" className="archived-chat-error">
              {error}
            </p>
          ) : null}
          {loading && items.length === 0 ? <p>正在加载…</p> : null}
          {!loading && items.length === 0 && !error ? (
            <p className="archived-chat-empty">暂无已归档的聊天</p>
          ) : null}
          <ul className="archived-chat-list">
            {items.map((item) => (
              <li key={item.sessionId ?? item.id}>
                <button
                  className="archived-chat-title"
                  type="button"
                  onClick={() => onOpenTask(item.id)}
                  data-testid={e2eId('e2e/settings/archived/:task-id/open#button', {
                    'task-id': item.id
                  })}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {item.archivedAt ? new Intl.DateTimeFormat('zh-CN', {
                      year: 'numeric', month: 'long', day: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    }).format(new Date(item.archivedAt)) : ''}
                  </small>
                </button>
                <button
                  type="button"
                  className="archived-chat-delete"
                  aria-label={`删除${item.title}`}
                  title="永久删除"
                  disabled={busyId !== null}
                  data-testid={e2eId('e2e/settings/archived/:task-id/delete#button', {
                    'task-id': item.id
                  })}
                  onClick={() => setDeleteTarget(item)}
                >
                  <AppIcon name="trash" size={14} />
                </button>
                <button
                  type="button"
                  className="archived-chat-restore"
                  disabled={busyId === item.sessionId}
                  data-testid={e2eId('e2e/settings/archived/:task-id/restore#button', {
                    'task-id': item.id
                  })}
                  onClick={() => void restore(item)}
                >
                  取消归档
                </button>
              </li>
            ))}
          </ul>
          {cursor ? (
            <button
              type="button"
              className="archived-chat-more"
              disabled={loading}
              data-testid="e2e/settings/archived/more#button"
              onClick={() => void load(cursor)}
            >
              加载更多
            </button>
          ) : null}
          {error && items.length === 0 ? (
            <button
              type="button"
              data-testid="e2e/settings/archived/retry#button"
              onClick={() => void load()}
            >
              重试
            </button>
          ) : null}
        </div>
        </div>
      </main>
      {deleteTarget ? (
        <div className="agent-dialog-backdrop">
          <section className="agent-dialog is-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-chat-title">
            <header><div>
              <h2 id="delete-chat-title">永久删除聊天？</h2>
              <p>“{deleteTarget.title}”及其记录将被删除，无法恢复。</p>
            </div></header>
            <footer>
              <button className="agent-secondary-button" type="button" disabled={busyId !== null}
                data-testid="e2e/settings/archived/delete/cancel#button"
                onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="agent-primary-button is-danger" type="button" disabled={busyId !== null}
                data-testid="e2e/settings/archived/delete/confirm#button"
                onClick={() => void remove()}>{busyId ? '删除中…' : '永久删除'}</button>
            </footer>
          </section>
        </div>
      ) : null}
      {notice ? <div className="archive-toast archived-delete-toast" role="status">
        <AppIcon name="trash" size={15} /><span>{notice}</span>
        <button type="button" aria-label="关闭提示" data-testid="e2e/settings/archived/delete/toast-close#button" onClick={() => setNotice(null)}><AppIcon name="close" size={14} /></button>
      </div> : null}
    </div>
  )
}
