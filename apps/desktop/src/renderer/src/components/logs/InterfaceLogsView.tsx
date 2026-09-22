import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InteractionLogRecord, InteractionLogService } from '../../models/interaction-logs'
import { e2eId } from '../../testing/e2e-id'
import { AppIcon } from '../ui/AppIcon'

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
const DIRECTIONS = [
  { id: '', label: '全部方向' },
  { id: 'renderer->service', label: '页面 → 服务端' },
  { id: 'service->renderer', label: '服务端 → 页面' },
  { id: 'service->skill', label: '服务端 → 本机能力' }
] as const

export function InterfaceLogsView({
  service,
  autoRefreshMs
}: {
  service: InteractionLogService
  autoRefreshMs: number
}) {
  const [records, setRecords] = useState<InteractionLogRecord[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [level, setLevel] = useState<string>('info')
  const [direction, setDirection] = useState<string>('')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const requestInFlight = useRef(false)

  const load = useCallback(async () => {
    if (requestInFlight.current) return
    requestInFlight.current = true
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
      requestInFlight.current = false
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
    <section className="layered-log-view" aria-label="接口层日志">
      <div className="logs-toolbar">
        <label className="logs-search">
          <AppIcon name="search" />
          <input
            aria-label="搜索日志"
            data-testid="e2e/settings/logs/search#input"
            placeholder="搜索会话 ID、任务 ID、接口或结果"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <span className="logs-select">
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
          <AppIcon name="chevron-down" />
        </span>
        <span className="logs-select logs-select-wide">
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
          <AppIcon name="chevron-down" />
        </span>
        <div className="logs-actions">
          <button
            className="secondary-button"
            data-testid="e2e/settings/logs/auto-refresh#switch"
            type="button"
            aria-pressed={autoRefresh}
            onClick={() => setAutoRefresh((current) => !current)}
          >
            <span className={`live-dot ${autoRefresh ? 'is-on' : ''}`} />
            {autoRefresh ? '自动刷新' : '已暂停'}
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

      {error ? (
        <div className="logs-state-card is-error" role="alert">
          <AppIcon name="circle-alert" />
          <div>
            <strong>无法读取日志（真实接口数据）</strong>
            <span>{error}</span>
          </div>
          <button
            className="secondary-button"
            data-testid="e2e/settings/logs/retry#button"
            type="button"
            onClick={() => void load()}
          >
            重试
          </button>
        </div>
      ) : loading ? (
        <p className="settings-loading">正在读取真实接口日志…</p>
      ) : records.length === 0 ? (
        <div className="logs-empty">
          <AppIcon name="scroll-text" size={24} />
          <strong>还没有交互记录</strong>
          <span>执行一次模型连接读取或任务提交后即可在这里看到</span>
        </div>
      ) : (
        <div className={`logs-workspace ${selected ? 'has-inspector' : ''}`}>
          <section className="logs-console is-light" aria-label="交互日志控制台">
            <header className="logs-console-header">
              <div>
                <strong>接口事件</strong>
                <span>前端、主进程、模型服务与本机组件的真实调用</span>
              </div>
              <span>{records.length} 条记录</span>
            </header>
            <div className="logs-console-columns" aria-hidden="true">
              <span>时间</span>
              <span>来源</span>
              <span>传输</span>
              <span>操作</span>
              <span className="is-center">耗时</span>
              <span className="is-end">状态</span>
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
                    <i />
                    {directionShort(record.direction)}
                  </span>
                  <span className="logs-transport">{record.transport?.toUpperCase() ?? '—'}</span>
                  <span className="logs-entry-operation">
                    {record.operation ?? record.msg ?? '—'}
                  </span>
                  <span className="logs-entry-duration">
                    {record.durationMs === undefined ? '—' : `${record.durationMs}ms`}
                  </span>
                  <span className={`logs-result is-${resultKind(record)}`}>
                    <i />
                    {resultLabel(record)}
                  </span>
                </button>
              )
            })}
          </section>

          {selected ? (
            <InterfaceLogInspector
              record={selected}
              copyState={copyState}
              onClose={() => setSelectedKey(null)}
              onCopy={() => void copySelected()}
            />
          ) : null}
        </div>
      )}

      {files.length > 0 ? (
        <footer className="logs-footer">
          <AppIcon name="folder" />
          <span>真实日志库</span>
          <code>{files[0]}</code>
        </footer>
      ) : null}
    </section>
  )
}

function InterfaceLogInspector({
  record,
  copyState,
  onClose,
  onCopy
}: {
  record: InteractionLogRecord
  copyState: 'idle' | 'copied'
  onClose(): void
  onCopy(): void
}) {
  return (
    <aside className="logs-inspector" data-testid="e2e/settings/logs/inspector#section">
      <header>
        <div>
          <span className={`logs-result is-${resultKind(record)}`}>{resultLabel(record)}</span>
          <strong>接口事件详情</strong>
        </div>
        <div className="logs-inspector-actions">
          <button
            className="plain-icon-action"
            data-testid="e2e/settings/logs/inspector/copy#button"
            type="button"
            aria-label="复制条目"
            onClick={onCopy}
          >
            <AppIcon name={copyState === 'copied' ? 'check' : 'copy'} />
          </button>
          <button
            className="plain-icon-action"
            data-testid="e2e/settings/logs/inspector/close#button"
            type="button"
            aria-label="关闭详情"
            onClick={onClose}
          >
            <AppIcon name="close" />
          </button>
        </div>
      </header>
      <div className="logs-inspector-fields">
        <InspectorRow label="时间">
          {new Date(record.time).toLocaleString('zh-CN', { hour12: false })}
        </InspectorRow>
        <InspectorRow label="来源">{record.name ?? '—'}</InspectorRow>
        <InspectorRow label="方向">{directionLabel(record.direction)}</InspectorRow>
        <InspectorRow label="传输">{record.transport?.toUpperCase() ?? '—'}</InspectorRow>
        <InspectorRow label="操作" mono>
          {record.operation ?? record.msg ?? '—'}
        </InspectorRow>
        <InspectorRow label="耗时">
          {record.durationMs === undefined ? '—' : `${record.durationMs}ms`}
        </InspectorRow>
        <InspectorRow label="载荷">
          {record.payloadBytes === undefined
            ? '—'
            : `${formatBytes(record.payloadBytes)}${
                record.payloadItems === undefined ? '' : ` · ${record.payloadItems} 项`
              }`}
        </InspectorRow>
        {record.status !== undefined ? (
          <InspectorRow label="状态码">{String(record.status)}</InspectorRow>
        ) : null}
        {record.errorMessage ? (
          <InspectorRow label="错误信息">{record.errorMessage}</InspectorRow>
        ) : null}
      </div>

      <details className="logs-inspector-raw">
        <summary data-testid="e2e/settings/logs/inspector/request#button">
          <AppIcon name="chevron-right" />
          请求（Request）
        </summary>
        <p>当前真实日志源记录操作、方向与载荷摘要，未记录完整请求正文。</p>
      </details>
      <details className="logs-inspector-raw">
        <summary data-testid="e2e/settings/logs/inspector/response#button">
          <AppIcon name="chevron-right" />
          响应（Response）
        </summary>
        <p>当前真实日志源记录状态、结果与耗时，未记录完整响应正文。</p>
      </details>
      <details className="logs-inspector-raw" open>
        <summary data-testid="e2e/settings/logs/raw#button">
          <AppIcon name="chevron-right" />
          原始记录
        </summary>
        <pre>{JSON.stringify(record, null, 2)}</pre>
      </details>
    </aside>
  )
}

function InspectorRow({
  label,
  mono = false,
  children
}: {
  label: string
  mono?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="logs-inspector-row">
      <span className="logs-inspector-label">{label}</span>
      <span className={`logs-inspector-value ${mono ? 'is-mono' : ''}`}>{children}</span>
    </div>
  )
}

function formatTime(time: number): string {
  const date = new Date(time)
  const text = date.toLocaleTimeString('zh-CN', { hour12: false })
  return `${text}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

function resultKind(record: InteractionLogRecord): 'success' | 'warning' | 'failure' {
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

function resultLabel(record: InteractionLogRecord): string {
  const kind = resultKind(record)
  return kind === 'success' ? '成功' : kind === 'failure' ? '失败' : '被拒绝'
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

function directionShort(direction: string | undefined): string {
  if (direction === 'service->renderer') return '主进程'
  if (direction === 'service->skill') return '组件'
  return '前端'
}

function keyOf(record: InteractionLogRecord): string {
  return `${record.time}-${record.operation ?? record.msg ?? 'entry'}`
}
