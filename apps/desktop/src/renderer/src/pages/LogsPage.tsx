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

type ConsoleTheme = 'dark' | 'light'

/**
 * Interaction log screen: a console stream on the left and a details inspector for the selected
 * entry on the right. The console can be switched between a dark developer console and a light
 * surface that matches the rest of settings.
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
  const [files, setFiles] = useState<string[]>([])
  const [level, setLevel] = useState<string>('info')
  const [direction, setDirection] = useState<string>('')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [consoleTheme, setConsoleTheme] = useState<ConsoleTheme>('dark')
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
      setFiles(result.files)
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
              <div className="logs-filters">
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
              </div>
              <div className="logs-actions">
                <button
                  className="plain-icon-action"
                  data-testid="e2e/settings/logs/theme#switch"
                  type="button"
                  aria-label={consoleTheme === 'dark' ? '切换为浅色控制台' : '切换为暗色控制台'}
                  title={consoleTheme === 'dark' ? '切换为浅色控制台' : '切换为暗色控制台'}
                  aria-pressed={consoleTheme === 'light'}
                  onClick={() =>
                    setConsoleTheme((current) => (current === 'dark' ? 'light' : 'dark'))
                  }
                >
                  <AppIcon name="eye" />
                </button>
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
              <section className={`logs-console is-${consoleTheme}`} aria-label="交互日志控制台">
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
                      <span className={`logs-level is-${record.levelLabel}`}>
                        {record.levelLabel.toUpperCase()}
                      </span>
                      <span className="logs-entry-operation">
                        {record.operation ?? record.msg ?? '—'}
                      </span>
                      <span className="logs-entry-outcome">
                        {record.errorCode ?? record.outcome ?? ''}
                      </span>
                    </button>
                  )
                })}
              </section>

              {selected ? (
                <aside className="logs-inspector" data-testid="e2e/settings/logs/inspector#section">
                  <header>
                    <strong>详情</strong>
                    <button
                      className="plain-icon-action"
                      data-testid="e2e/settings/logs/inspector/copy#button"
                      type="button"
                      aria-label="复制条目"
                      onClick={() => void copySelected()}
                    >
                      <AppIcon name={copyState === 'copied' ? 'check' : 'folder'} />
                    </button>
                  </header>
                  <dl>
                    <Detail
                      label="时间"
                      value={new Date(selected.time).toLocaleString('zh-CN', { hour12: false })}
                    />
                    <Detail label="级别" value={selected.levelLabel} />
                    <Detail label="方向" value={directionLabel(selected.direction)} />
                    <Detail label="传输" value={selected.transport ?? '—'} />
                    <Detail label="操作" value={selected.operation ?? selected.msg ?? '—'} mono />
                    <Detail
                      label="结果"
                      value={
                        selected.errorCode ??
                        [selected.outcome, selected.status].filter(Boolean).join(' · ') ??
                        '—'
                      }
                    />
                    <Detail
                      label="耗时"
                      value={selected.durationMs === undefined ? '—' : `${selected.durationMs}ms`}
                    />
                    <Detail
                      label="载荷"
                      value={
                        selected.payloadBytes === undefined
                          ? '—'
                          : `${selected.payloadBytes}B${
                              selected.payloadItems === undefined
                                ? ''
                                : ` · ${selected.payloadItems} 项`
                            }`
                      }
                    />
                    {selected.errorMessage ? (
                      <Detail label="错误信息" value={selected.errorMessage} />
                    ) : null}
                  </dl>
                </aside>
              ) : null}
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

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : undefined}>{value}</dd>
    </>
  )
}

function formatTime(time: number): string {
  const date = new Date(time)
  const text = date.toLocaleTimeString('zh-CN', { hour12: false })
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `${text}.${milliseconds}`
}

function directionLabel(direction: string | undefined): string {
  if (direction === 'renderer->service') return '页面 → 服务端'
  if (direction === 'service->renderer') return '服务端 → 页面'
  if (direction === 'service->skill') return '服务端 → 本机能力'
  return direction ?? '—'
}

function keyOf(record: InteractionLogRecord): string {
  return `${record.time}-${record.operation ?? record.msg ?? 'entry'}`
}
