import { useCallback, useEffect, useState } from 'react'
import { SettingsSidebar } from '../components/SettingsSidebar'
import { AppIcon } from '../components/ui/AppIcon'
import type {
  InteractionLogRecord,
  InteractionLogService
} from '../models/interaction-logs'

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
const DIRECTIONS = [
  { id: '', label: '全部方向' },
  { id: 'renderer->service', label: 'Renderer → 服务端' },
  { id: 'service->renderer', label: '服务端 → Renderer' },
  { id: 'service->skill', label: '服务端 → 本机能力' }
] as const

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
  const [files, setFiles] = useState<string[]>([])
  const [level, setLevel] = useState<string>('info')
  const [direction, setDirection] = useState<string>('')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
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
      setFiles(result.files)
      setError(null)
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

  return (
    <div className="settings-shell" data-testid="e2e/settings/logs/page#page">
      <SettingsSidebar
        onBack={onBack}
        active="logs"
        onOpenLogs={onOpenConnections}
        onOpenConnections={onOpenConnections}
      />
      <main className="settings-main">
        <div className="settings-content">
          <header className="logs-header">
            <div>
              <h2>交互日志</h2>
              <p>Renderer 与服务端之间的每一次调用都会记录在这里</p>
            </div>
            <div className="logs-actions">
              <label>
                <span>级别</span>
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
              </label>
              <label>
                <span>方向</span>
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
              </label>
              <input
                aria-label="搜索日志"
                data-testid="e2e/settings/logs/search#input"
                placeholder="搜索通道或结果"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
              <button
                className="secondary-button"
                data-testid="e2e/settings/logs/auto-refresh#switch"
                type="button"
                aria-pressed={autoRefresh}
                onClick={() => setAutoRefresh((current) => !current)}
              >
                <AppIcon name={autoRefresh ? 'pause' : 'play'} />
                {autoRefresh ? '暂停刷新' : '自动刷新'}
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
            <div className="logs-table" role="table" aria-label="交互日志">
              <div className="logs-row logs-row-head" role="row">
                <span role="columnheader">时间</span>
                <span role="columnheader">方向</span>
                <span role="columnheader">通道 / 端点</span>
                <span role="columnheader">结果</span>
                <span role="columnheader">耗时</span>
                <span role="columnheader">载荷</span>
              </div>
              {records.map((record, index) => (
                <div className="logs-row" role="row" key={`${record.time}-${index}`}>
                  <span role="cell">{formatTime(record.time)}</span>
                  <span role="cell">{directionLabel(record.direction)}</span>
                  <span role="cell" className="logs-operation" title={record.operation ?? record.msg ?? ''}>
                    {record.operation ?? record.msg ?? '—'}
                  </span>
                  <span role="cell">
                    <span className={`logs-outcome is-${record.outcome ?? 'ok'}`}>
                      {record.errorCode ?? record.outcome ?? '—'}
                    </span>
                  </span>
                  <span role="cell">{record.durationMs === undefined ? '—' : `${record.durationMs}ms`}</span>
                  <span role="cell">
                    {record.payloadBytes === undefined
                      ? '—'
                      : `${record.payloadBytes}B${record.payloadItems === undefined ? '' : ` · ${record.payloadItems} 项`}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <footer className="logs-footer">
            <span>日志文件</span>
            {files.map((file) => (
              <code key={file}>{file}</code>
            ))}
            <span className="logs-hint">终端查看：tail -f &lt;文件路径&gt;</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString('zh-CN', { hour12: false })
}

function directionLabel(direction: string | undefined): string {
  if (direction === 'renderer->service') return '页面 → 服务端'
  if (direction === 'service->renderer') return '服务端 → 页面'
  if (direction === 'service->skill') return '服务端 → 本机能力'
  return direction ?? '—'
}
