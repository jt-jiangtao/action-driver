import { useCallback, useEffect, useMemo, useState } from 'react'
import { SettingsSidebar } from '../components/SettingsSidebar'
import { AppIcon } from '../components/ui/AppIcon'
import type { InteractionLogRecord, InteractionLogService } from '../models/interaction-logs'
import { e2eId } from '../testing/e2e-id'

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
const DIRECTIONS = [
  { id: '', label: '全部方向' },
  { id: 'renderer->service', label: '页面 → 服务端' },
  { id: 'service->renderer', label: '服务端 → 页面' },
  { id: 'service->skill', label: '服务端 → 本机能力' }
] as const

/**
 * Interaction log screen: a console stream on the left and a details inspector for the selected
 * entry on the right. The console uses the light surface that matches the rest of settings.
 */
export function LogsPage({
  service,
  onBack,
  onOpenConnections,
  autoRefreshMs = 2_000
}: {
  service: InteractionLogService
  onBack(): void
  onOpenConnections(): void
  autoRefreshMs?: number
}) {
  const [records, setRecords] = useState<InteractionLogRecord[]>([])
  const [level, setLevel] = useState<string>('info')
  const [direction, setDirection] = useState<string>('')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const result = await service.list({
        level,
        ...(direction ? { direction } : {}),
        ...(search ? { search } : {}),
        limit: 200
      })
      setRecords(result.records)
      setError(null)
      setSelectedKey((current) =>
        current && result.records.some((record) => keyOf(record) === current) ? current : null
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [direction, level, search, service])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => void load(), autoRefreshMs)
    return () => clearInterval(timer)
  }, [autoRefresh, autoRefreshMs, load])

  const selected = useMemo(
    () => records.find((record) => keyOf(record) === selectedKey) ?? null,
    [records, selectedKey]
  )

  const copySelected = async () => {
    if (!selected) return
    await globalThis.navigator?.clipboard?.writeText(JSON.stringify(selected, null, 2))
    setCopyState('copied')
    setTimeout(() => setCopyState('idle'), 1_500)
  }

  return (
    <div className="settings-shell" data-testid="e2e/settings/logs/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="logs"
        onOpenLogs={onOpenConnections}
        onOpenConnections={onOpenConnections}
      />
      <main className="settings-main">
        <div className="settings-content logs-content">
          <header className="logs-header">
            <div className="logs-heading">
              <h2>交互日志</h2>
              <p>Renderer 与服务端之间的每一次调用都会记录在这里</p>
            </div>
            <div className="logs-toolbar">
              <label className="logs-search">
                <AppIcon name="search" />
                <input
                  aria-label="搜索日志"
                  data-testid="e2e/settings/logs/search#input"
                  placeholder="搜索通道、结果或方向"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              </label>
              <select
                aria-label="日志级别"
                data-testid="e2e/settings/logs/level#select"
                value={level}
                onChange={(event) => setLevel(event.currentTarget.value)}
              >
                {LEVELS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                aria-label="日志方向"
                data-testid="e2e/settings/logs/direction#select"
                value={direction}
                onChange={(event) => setDirection(event.currentTarget.value)}
              >
                {DIRECTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="logs-actions">
                <button
                  className="secondary-button"
                  data-testid="e2e/settings/logs/auto-refresh#switch"
                  type="button"
                  aria-pressed={autoRefresh}
                  onClick={() => setAutoRefresh((current) => !current)}
                >
                  <AppIcon name={autoRefresh ? 'pause' : 'play'} />
                  {autoRefresh ? '暂停' : '自动刷新'}
                </button>
                <button
                  className="secondary-button"
                  data-testid="e2e/settings/logs/refresh#button"
                  type="button"
                  onClick={() => void load()}
                >
                  <AppIcon name="refresh" />
                  刷新
                </button>
              </div>
            </div>
          </header>

          {error ? (
            <p className="settings-error" role="alert">
              无法读取日志：{error}
            </p>
          ) : loading ? (
            <p className="settings-loading">正在读取日志…</p>
          ) : records.length === 0 ? (
            <div className="logs-empty">
              <strong>还没有交互记录</strong>
              <span>执行一次模型连接读取或任务提交后即可在这里看到</span>
            </div>
          ) : (
            <div className={`logs-workspace ${selected ? 'has-inspector' : ''}`}>
              <section className="logs-console is-light" aria-label="交互日志控制台">
                <header className="logs-console-header">
                  <strong>调用记录</strong>
                  <span>
                    {records.length} 条 · 最近更新 {formatTime(records.at(-1)!.time)}
                  </span>
                </header>
                <div className="logs-console-columns" aria-hidden="true">
                  <span>时间</span>
                  <span>方向</span>
                  <span>级别</span>
                  <span>操作</span>
                  <span>耗时</span>
                  <span>结果</span>
                </div>
                {records.map((record, index) => {
                  const key = keyOf(record)
                  return (
                    <button
                      className="logs-entry"
                      data-testid={e2eId('e2e/settings/logs/entries/:entry-index#button', {
                        'entry-index': String(index)
                      })}
                      data-selected={key === selectedKey}
                      key={key}
                      type="button"
                      onClick={() => setSelectedKey((current) => (current === key ? null : key))}
                    >
                      <span className="logs-entry-time">{formatTime(record.time)}</span>
                      <span
                        className={`logs-direction is-${directionKind(record.direction)}`}
                        title={directionLabel(record.direction)}
                      >
                        <AppIcon name={directionIcon(record.direction)} />
                        {directionShort(record.direction)}
                      </span>
                      <span className={`logs-level is-${record.levelLabel}`}>
                        {record.levelLabel.toUpperCase()}
                      </span>
                      <span className="logs-entry-operation">
                        {record.operation ?? record.msg ?? '—'}
                      </span>
                      <span className="logs-entry-duration">
                        {record.durationMs === undefined ? '—' : `${record.durationMs}ms`}
                      </span>
                      <span className={`logs-result is-${resultKind(record)}`}>
                        {resultIcon(record) ? <AppIcon name={resultIcon(record)!} /> : null}
                        {resultLabel(record)}
                      </span>
                    </button>
                  )
                })}
              </section>

              {selected ? (
                <aside className="logs-inspector" data-testid="e2e/settings/logs/inspector#section">
                  <header>
                    <span className="logs-inspector-title">
                      <AppIcon name="task" />
                      <strong>详情</strong>
                    </span>
                    <button
                      className="plain-icon-action"
                      data-testid="e2e/settings/logs/inspector/copy#button"
                      type="button"
                      aria-label="复制条目"
                      onClick={() => void copySelected()}
                    >
                      <AppIcon name={copyState === 'copied' ? 'check' : 'copy'} />
                    </button>
                  </header>
                  <div className="logs-inspector-fields">
                    <InspectorRow icon="clock" label="时间">
                      {new Date(selected.time).toLocaleString('zh-CN', { hour12: false })}
                    </InspectorRow>
                    <InspectorRow icon="circle-alert" label="级别">
                      <span className={`logs-level is-${selected.levelLabel}`}>
                        {selected.levelLabel.toUpperCase()}
                      </span>
                    </InspectorRow>
                    <InspectorRow icon="server" label="来源">
                      {selected.name ?? '—'}
                    </InspectorRow>
                    <InspectorRow
                      icon={directionIcon(selected.direction)}
                      label="方向"
                      iconClass={directionKind(selected.direction)}
                    >
                      {directionLabel(selected.direction)}
                    </InspectorRow>
                    <InspectorRow icon="network" label="传输">
                      {selected.transport ?? '—'}
                    </InspectorRow>
                    <InspectorRow icon="terminal" label="操作" mono>
                      {selected.operation ?? selected.msg ?? '—'}
                    </InspectorRow>
                    <InspectorRow icon="check" label="结果">
                      <span className={`logs-result is-${resultKind(selected)}`}>
                        {resultLabel(selected)}
                      </span>
                    </InspectorRow>
                    <InspectorRow icon="timer" label="耗时">
                      {selected.durationMs === undefined ? '—' : `${selected.durationMs}ms`}
                    </InspectorRow>
                    <InspectorRow icon="boxes" label="载荷">
                      {selected.payloadBytes === undefined
                        ? '—'
                        : `${formatBytes(selected.payloadBytes)}${
                            selected.payloadItems === undefined
                              ? ''
                              : ` · ${selected.payloadItems} 项`
                          }`}
                    </InspectorRow>
                    {selected.status !== undefined ? (
                      <InspectorRow icon="code" label="状态码">
                        {String(selected.status)}
                      </InspectorRow>
                    ) : null}
                    {selected.errorMessage ? (
                      <InspectorRow icon="circle-alert" label="错误信息">
                        {selected.errorMessage}
                      </InspectorRow>
                    ) : null}
                  </div>
                    <details className="logs-inspector-raw" open>
                    <summary data-testid="e2e/settings/logs/raw#button">
                      <AppIcon name="code" />
                      原始记录
                    </summary>
                    <pre>{JSON.stringify(selected, null, 2)}</pre>
                  </details>
                </aside>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function InspectorRow({
  icon,
  label,
  iconClass,
  mono = false,
  children
}: {
  icon: Parameters<typeof AppIcon>[0]['name']
  label: string
  iconClass?: string
  mono?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="logs-inspector-row">
      <span className={`logs-inspector-icon ${iconClass ? `is-${iconClass}` : ''}`}>
        <AppIcon name={icon} />
      </span>
      <span className="logs-inspector-label">{label}</span>
      <span className={`logs-inspector-value ${mono ? 'is-mono' : ''}`}>{children}</span>
    </div>
  )
}

function formatTime(time: number): string {
  const date = new Date(time)
  const text = date.toLocaleTimeString('zh-CN', { hour12: false })
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `${text}.${milliseconds}`
}

export function resultKind(record: InteractionLogRecord): 'success' | 'warning' | 'failure' {
  if (record.errorCode || record.outcome === 'error') return 'failure'
  if (record.outcome === 'ok' || record.outcome === 'success') return 'success'
  const status = record.status
  if (status !== undefined) {
    if (status >= 500) return 'failure'
    if (status >= 400) return 'warning'
    if (status < 300) return 'success'
  }
  return 'warning'
}

export function resultLabel(record: InteractionLogRecord): string {
  const kind = resultKind(record)
  const label = kind === 'success' ? '成功' : kind === 'failure' ? '失败' : '被拒绝'
  const detail = record.errorCode ?? record.status
  return detail === undefined ? label : `${label} · ${detail}`
}

function resultIcon(
  record: InteractionLogRecord
): 'check' | 'circle-alert' | null {
  const kind = resultKind(record)
  if (kind === 'success') return 'check'
  if (kind === 'failure') return 'circle-alert'
  return 'circle-alert'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function directionLabel(direction: string | undefined): string {
  if (direction === 'renderer->service') return '页面 → 服务端'
  if (direction === 'service->renderer') return '服务端 → 页面'
  if (direction === 'service->skill') return '服务端 → 本机能力'
  return direction ?? '—'
}

function directionKind(direction: string | undefined): 'outgoing' | 'incoming' | 'skill' {
  if (direction === 'service->renderer') return 'incoming'
  if (direction === 'service->skill') return 'skill'
  return 'outgoing'
}

function directionIcon(direction: string | undefined): 'upload' | 'download' | 'monitor' {
  if (direction === 'service->renderer') return 'download'
  if (direction === 'service->skill') return 'monitor'
  return 'upload'
}

function directionShort(direction: string | undefined): string {
  if (direction === 'service->renderer') return '入站'
  if (direction === 'service->skill') return '本机'
  return '出站'
}

function keyOf(record: InteractionLogRecord): string {
  return `${record.time}-${record.operation ?? record.msg ?? 'entry'}`
}
