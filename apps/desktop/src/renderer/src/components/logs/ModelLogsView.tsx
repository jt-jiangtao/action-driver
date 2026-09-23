import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type ModelLogCall,
  type ModelLogDetailSection,
  type ModelLogSession,
  type ModelLogTask,
  type ModelRunStatus
} from '../../models/model-logs'
import type { ModelLogService } from '../../models/model-log-service'
import { e2eId } from '../../testing/e2e-id'
import { AppIcon, type AppIconName } from '../ui/AppIcon'

type ModelListMode = 'sessions' | 'tasks'

export function ModelLogsView({
  service,
  autoRefreshMs = 2_000
}: {
  service: ModelLogService
  autoRefreshMs?: number
}) {
  const [mode, setMode] = useState<ModelListMode>('sessions')
  const [status, setStatus] = useState<ModelRunStatus | ''>('')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [sessions, setSessions] = useState<ModelLogSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<{ sessionId: string; taskId: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await service.list())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '模型日志读取失败')
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    void load()
    if (!autoRefresh) return
    const timer = window.setInterval(() => void load(), autoRefreshMs)
    return () => window.clearInterval(timer)
  }, [autoRefresh, autoRefreshMs, load])

  const filteredSessions = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return sessions
      .map((session) => ({
        ...session,
        tasks: session.tasks.filter(
          (task) =>
            (!status || task.status === status || session.status === status) &&
            (!keyword ||
              session.name.toLowerCase().includes(keyword) ||
              session.sessionId.toLowerCase().includes(keyword) ||
              task.name.toLowerCase().includes(keyword) ||
              task.model.toLowerCase().includes(keyword))
        )
      }))
      .filter((session) => session.tasks.length > 0)
  }, [search, sessions, status])

  if (selected) {
    const session = sessions.find((item) => item.id === selected.sessionId)
    const task = session?.tasks.find((item) => item.id === selected.taskId)
    if (session && task) {
      return (
        <ModelSessionDetail
          session={session}
          task={task}
          onBack={() => setSelected(null)}
          onSelectTask={(taskId) => setSelected({ sessionId: session.id, taskId })}
        />
      )
    }
  }

  if (loading) {
    return <p className="model-log-state">正在读取模型日志</p>
  }

  if (error) {
    return (
      <div className="model-log-state" role="alert">
        <span>{error}</span>
        <button
          className="secondary-button"
          data-testid="e2e/settings/logs/model/retry#button"
          type="button"
          onClick={() => void load()}
        >
          重试
        </button>
      </div>
    )
  }

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  return (
    <section className="layered-log-view model-logs" aria-label="模型层日志">
      <div className="model-log-toolbar">
        <div className="segmented-control" aria-label="运行记录视图">
          <button
            className={mode === 'sessions' ? 'is-active' : ''}
            data-testid="e2e/settings/logs/model/view/sessions#button"
            type="button"
            aria-pressed={mode === 'sessions'}
            onClick={() => setMode('sessions')}
          >
            会话视图
          </button>
          <button
            className={mode === 'tasks' ? 'is-active' : ''}
            data-testid="e2e/settings/logs/model/view/tasks#button"
            type="button"
            aria-pressed={mode === 'tasks'}
            onClick={() => setMode('tasks')}
          >
            任务视图
          </button>
        </div>
        <label className="logs-search model-log-search">
          <AppIcon name="search" />
          <input
            aria-label="搜索模型日志"
            data-testid="e2e/settings/logs/model/search#input"
            placeholder="搜索会话、任务、sessionId 或模型"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <span className="logs-select">
          <select
            aria-label="模型日志状态"
            data-testid="e2e/settings/logs/model/status#select"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as ModelRunStatus | '')}
          >
            <option value="">全部状态</option>
            <option value="completed">已完成</option>
            <option value="running">运行中</option>
            <option value="failed">已失败</option>
          </select>
          <AppIcon name="chevron-down" />
        </span>
        <button
          className="secondary-button model-auto-refresh"
          data-testid="e2e/settings/logs/model/auto-refresh#switch"
          type="button"
          aria-pressed={autoRefresh}
          onClick={() => setAutoRefresh((current) => !current)}
        >
          <span className={`live-dot ${autoRefresh ? 'is-on' : ''}`} />
          {autoRefresh ? '自动刷新' : '已暂停'}
        </button>
      </div>

      {filteredSessions.length === 0 ? (
        <div className="logs-empty">
          <strong>没有匹配的模型运行记录</strong>
          <span>调整关键词或状态筛选后重试</span>
        </div>
      ) : mode === 'sessions' ? (
        <div className="model-session-table">
          <div className="model-session-head" aria-hidden="true">
            <span>会话名称</span>
            <span>开始时间</span>
            <span>状态</span>
            <span>总耗时</span>
            <span>任务数</span>
            <span>操作</span>
          </div>
          {filteredSessions.map((session) => (
            <ModelSessionRow
              expanded={expandedSessions.has(session.id)}
              key={session.id}
              session={session}
              onToggle={() => toggleSession(session.id)}
              onOpenTask={(taskId) => setSelected({ sessionId: session.id, taskId })}
            />
          ))}
        </div>
      ) : (
        <div className="model-task-grid">
          {filteredSessions.flatMap((session) =>
            session.tasks.map((task) => (
              <button
                className="model-task-card"
                data-testid={e2eId('e2e/settings/logs/model/task-cards/:task-id#button', {
                  'task-id': task.id
                })}
                key={`${session.id}-${task.id}`}
                type="button"
                onClick={() => setSelected({ sessionId: session.id, taskId: task.id })}
              >
                <span className="model-task-icon">
                  <AppIcon name="cpu" />
                </span>
                <span>
                  <strong>{task.name}</strong>
                  <small>{session.name}</small>
                </span>
                <StatusBadge status={task.status} />
                <span className="model-task-meta">{task.model}</span>
                <AppIcon name="chevron-right" />
              </button>
            ))
          )}
        </div>
      )}

      <footer className="model-log-summary">
        <span>共 {sessions.length} 个会话</span>
        <span>数据来自本地 Runtime 聚合日志，每轮任务保留一条完整模型调用</span>
      </footer>
    </section>
  )
}

function ModelSessionRow({
  session,
  expanded,
  onToggle,
  onOpenTask
}: {
  session: ModelLogSession
  expanded: boolean
  onToggle(): void
  onOpenTask(taskId: string): void
}) {
  return (
    <article className={`model-session-row ${expanded ? 'is-expanded' : ''}`}>
      <div className="model-session-primary">
        <button
          className="model-session-toggle"
          data-testid={e2eId('e2e/settings/logs/model/sessions/:session-id#button', {
            'session-id': session.id
          })}
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} />
          <span>
            <strong>{session.name}</strong>
            <small>{session.sessionId}</small>
          </span>
        </button>
        <time>{session.startTime}</time>
        <StatusBadge status={session.status} />
        <span>{session.duration}</span>
        <span>{session.tasks.length}</span>
        <button
          className="table-link"
          data-testid={e2eId('e2e/settings/logs/model/session-details/:session-id#button', {
            'session-id': session.id
          })}
          type="button"
          onClick={() => onOpenTask(session.tasks[0]!.id)}
        >
          查看会话详情
          <AppIcon name="arrow-right" />
        </button>
      </div>
      {expanded ? (
        <div className="model-session-tasks">
          <div className="model-task-head" aria-hidden="true">
            <span>任务名称</span>
            <span>开始时间</span>
            <span>状态</span>
            <span>耗时</span>
            <span>模型</span>
            <span>操作</span>
          </div>
          {session.tasks.map((task) => (
            <div className="model-task-row" key={task.id}>
              <span className="model-task-name">
                <i>
                  <AppIcon name={taskIcon(task)} />
                </i>
                {task.name}
              </span>
              <time>{task.startTime}</time>
              <StatusBadge status={task.status} />
              <span>{task.duration}</span>
              <span className="model-chip">{task.model}</span>
              <button
                className="table-link"
                data-testid={e2eId('e2e/settings/logs/model/tasks/:task-id#button', {
                  'task-id': task.id
                })}
                type="button"
                onClick={() => onOpenTask(task.id)}
              >
                查看详情
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function ModelSessionDetail({
  session,
  task,
  onBack,
  onSelectTask
}: {
  session: ModelLogSession
  task: ModelLogTask
  onBack(): void
  onSelectTask(taskId: string): void
}) {
  const [selectedCallId, setSelectedCallId] = useState(task.calls[0]?.id ?? '')
  const selectedCall = task.calls.find((item) => item.id === selectedCallId) ?? task.calls[0]
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(['system-prompt', 'user-input'])
  )

  if (!selectedCall) return null

  const toggleSection = (id: string) => {
    setOpenSections((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="model-detail" aria-label="模型会话详情">
      <button
        className="model-detail-back"
        data-testid="e2e/settings/logs/model/detail/back#button"
        type="button"
        onClick={onBack}
      >
        <AppIcon name="arrow-left" />
        返回会话列表
      </button>

      <header className="model-detail-hero">
        <div>
          <span className="eyebrow">模型层日志 · {task.name}</span>
          <h2>{session.name}</h2>
          <p>{session.sessionId}</p>
        </div>
        <StatusBadge status={session.status} />
        <dl>
          <div>
            <dt>开始时间</dt>
            <dd>{session.startTime}</dd>
          </div>
          <div>
            <dt>结束时间</dt>
            <dd>{session.endTime ?? '—'}</dd>
          </div>
          <div>
            <dt>总耗时</dt>
            <dd>{session.duration}</dd>
          </div>
          <div>
            <dt>任务数</dt>
            <dd>{session.tasks.length}</dd>
          </div>
        </dl>
      </header>

      <div className="model-detail-workspace">
        <aside className="model-call-nav">
          <header>
            <strong>调用导航</strong>
            <span>{task.calls.length} 次调用</span>
          </header>
          <div className="model-call-list">
            {task.calls.map((item, index) => (
              <button
                className={item.id === selectedCall.id ? 'is-active' : ''}
                data-testid={e2eId('e2e/settings/logs/model/calls/:call-id#button', {
                  'call-id': item.id
                })}
                key={item.id}
                type="button"
                onClick={() => setSelectedCallId(item.id)}
              >
                <span className={`call-dot is-${item.kind}`}>
                  <AppIcon name={callIcon(item)} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <time>{item.time}</time>
                {index < task.calls.length - 1 ? <i aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          <div className="model-task-switcher">
            <span>本次会话任务</span>
            {session.tasks.map((item) => (
              <button
                data-testid={e2eId('e2e/settings/logs/model/task-switcher/:task-id#button', {
                  'task-id': item.id
                })}
                key={item.id}
                type="button"
                disabled={item.id === task.id}
                onClick={() => onSelectTask(item.id)}
              >
                {item.name}
                <AppIcon name="chevron-right" />
              </button>
            ))}
          </div>
        </aside>

        <main className="model-call-detail">
          <header>
            <div>
              <span className={`call-kind is-${selectedCall.kind}`}>
                {callKindLabel(selectedCall.kind)}
              </span>
              <h3>{selectedCall.label}</h3>
              <p>当前步骤：{selectedCall.description}</p>
            </div>
            <time>{selectedCall.time}</time>
          </header>
          <div className="model-detail-sections">
            {selectedCall.sections.map((section) => (
              <DetailSection
                key={section.id}
                section={section}
                open={openSections.has(section.id)}
                onToggle={() => toggleSection(section.id)}
              />
            ))}
          </div>
        </main>
      </div>
    </section>
  )
}

function DetailSection({
  section,
  open,
  onToggle
}: {
  section: ModelLogDetailSection
  open: boolean
  onToggle(): void
}) {
  return (
    <section className={`model-detail-section ${open ? 'is-open' : ''}`}>
      <button
        data-testid={e2eId('e2e/settings/logs/model/detail/:section-id#button', {
          'section-id': section.id
        })}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        <AppIcon name={open ? 'chevron-down' : 'chevron-right'} />
        <strong>{section.title}</strong>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        section.language === 'json' ? (
          <pre>{section.content}</pre>
        ) : (
          <p>{section.content}</p>
        )
      ) : null}
    </section>
  )
}

function StatusBadge({ status }: { status: ModelRunStatus }) {
  return (
    <span className={`model-status is-${status}`}>
      <i />
      {statusLabel(status)}
    </span>
  )
}

function statusLabel(status: ModelRunStatus): string {
  if (status === 'completed') return '已完成'
  if (status === 'running') return '运行中'
  return '已失败'
}

function callKindLabel(kind: ModelLogCall['kind']): string {
  if (kind === 'model') return '模型调用'
  if (kind === 'component') return '组件调用'
  if (kind === 'prompt') return '上下文'
  return '处理结果'
}

function callIcon(callItem: ModelLogCall): AppIconName {
  if (callItem.kind === 'model') return 'cpu'
  if (callItem.kind === 'component') return 'boxes'
  if (callItem.kind === 'prompt') return 'code'
  return 'check'
}

function taskIcon(task: ModelLogTask): AppIconName {
  if (task.status === 'failed') return 'circle-alert'
  if (task.status === 'running') return 'loader'
  return 'task'
}
