import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  InteractionLogDetail,
  InteractionPayloadView,
  InteractionTransport
} from '@actiondriver/observability'
import type { InteractionLogRecord, InteractionLogService } from '../../models/interaction-logs'
import { e2eId } from '../../testing/e2e-id'
import { AppIcon } from '../ui/AppIcon'

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
const PAGE_SIZE = 12
const CONSOLE_THEME_KEY = 'actiondriver.logs.console-theme'
type ConsoleTheme = 'light' | 'dark'
const TRANSPORTS: Array<{ id: InteractionTransport; label: string }> = [
  { id: 'ipc', label: 'IPC' },
  { id: 'http', label: 'HTTP' },
  { id: 'websocket', label: 'WebSocket' }
]
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
  const [level, setLevel] = useState<string>('')
  const [direction, setDirection] = useState<string>('')
  const [transports, setTransports] = useState<InteractionTransport[]>([])
  const [transportOpen, setTransportOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selected, setSelected] = useState<InteractionLogRecord | null>(null)
  const [detailState, setDetailState] = useState<{
    eventId: string
    state: 'loading' | 'ready' | 'error'
    detail: InteractionLogDetail | null
    error: string | null
  } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage] = useState(1)
  const [consoleTheme, setConsoleTheme] = useState<ConsoleTheme>(readConsoleTheme)
  const requestInFlight = useRef(false)
  const detailRequest = useRef<{ eventId: string; generation: number } | null>(null)
  const detailGeneration = useRef(0)

  const load = useCallback(async () => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    setRefreshing(true)
    try {
      const result = await service.list({
        level,
        ...(direction ? { direction } : {}),
        ...(search ? { search } : {}),
        ...(transports.length ? { transports } : {}),
        limit: 200
      })
      setRecords(result.records)
      setFiles(result.files)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      requestInFlight.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [direction, level, search, service, transports])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => void load(), autoRefreshMs)
    return () => clearInterval(timer)
  }, [autoRefresh, autoRefreshMs, load])

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const visibleRecords = useMemo(
    () => records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, records]
  )

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(CONSOLE_THEME_KEY, consoleTheme)
    } catch {
      // Keep the in-memory preference when persistent storage is unavailable.
    }
  }, [consoleTheme])

  const clearFilters = () => {
    setLevel('')
    setDirection('')
    setTransports([])
    setSearch('')
    setPage(1)
  }

  const requestDetail = useCallback(
    (record: InteractionLogRecord) => {
      const eventId = keyOf(record)
      if (!service.detail) {
        setDetailState({ eventId, state: 'ready', detail: null, error: null })
        return
      }
      const generation = ++detailGeneration.current
      detailRequest.current = { eventId, generation }
      setDetailState({ eventId, state: 'loading', detail: null, error: null })
      void service.detail(eventId).then(
        (detail) => {
          if (
            detailRequest.current?.eventId !== eventId ||
            detailRequest.current.generation !== generation
          )
            return
          setDetailState({ eventId, state: 'ready', detail, error: null })
        },
        (cause) => {
          if (
            detailRequest.current?.eventId !== eventId ||
            detailRequest.current.generation !== generation
          )
            return
          const code =
            cause && typeof cause === 'object' && 'code' in cause
              ? String((cause as { code: unknown }).code)
              : null
          setDetailState({
            eventId,
            state: 'error',
            detail: null,
            error:
              code === 'payload-expired'
                ? '载荷已过期'
                : cause instanceof Error
                  ? cause.message
                  : String(cause)
          })
        }
      )
    },
    [service]
  )

  useEffect(() => {
    if (!selected) return
    const updated = records.find((record) => keyOf(record) === keyOf(selected))
    if (!updated) return
    const becameComplete = selected.state === 'pending' && updated.state !== 'pending'
    if (selected !== updated) setSelected(updated)
    if (becameComplete) requestDetail(updated)
  }, [records, requestDetail, selected])

  const selectRecord = (record: InteractionLogRecord) => {
    const eventId = keyOf(record)
    if (selected && keyOf(selected) === eventId) {
      detailRequest.current = null
      setSelected(null)
      setDetailState(null)
      return
    }
    setSelected(record)
    requestDetail(record)
  }

  const closeDetail = () => {
    detailRequest.current = null
    setSelected(null)
    setDetailState(null)
  }

  const copySelected = () => {
    if (!selected) return
    setCopyState('copied')
    void globalThis.navigator?.clipboard?.writeText(
      JSON.stringify(detailState?.detail ?? selected, null, 2)
    )
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
            name="interface-log-search"
            autoComplete="off"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <div className="logs-transport-filter">
          <button
            className="secondary-button"
            data-testid="e2e/settings/logs/transport#button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={transportOpen}
            onClick={() => setTransportOpen((current) => !current)}
          >
            {transportLabel(transports)}
            <AppIcon name="chevron-down" />
          </button>
          {transportOpen ? (
            <div className="logs-transport-menu" role="menu" aria-label="传输协议">
              {TRANSPORTS.map((transport) => {
                const checked = transports.includes(transport.id)
                return (
                  <button
                    key={transport.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    data-testid={e2eId('e2e/settings/logs/transport/:transport#option', {
                      transport: transport.id
                    })}
                    onClick={() => {
                      setTransports((current) =>
                        current.includes(transport.id)
                          ? current.filter((item) => item !== transport.id)
                          : [...current, transport.id]
                      )
                      setPage(1)
                    }}
                  >
                    <span>{transport.label}</span>
                    {checked ? <AppIcon name="check" /> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <span className="logs-select">
          <select
            aria-label="日志级别"
            data-testid="e2e/settings/logs/level#select"
            value={level}
            onChange={(event) => {
              setLevel(event.currentTarget.value)
              setPage(1)
            }}
          >
            <option value="">全部级别</option>
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
            onChange={(event) => {
              setDirection(event.currentTarget.value)
              setPage(1)
            }}
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
            className="plain-text-action"
            data-testid="e2e/settings/logs/filters/clear#button"
            type="button"
            disabled={!level && !direction && !search && transports.length === 0}
            onClick={clearFilters}
          >
            清除筛选
          </button>
          <button
            className="secondary-button"
            data-testid="e2e/settings/logs/auto-refresh#switch"
            type="button"
            aria-pressed={autoRefresh}
            onClick={() => setAutoRefresh((current) => !current)}
          >
            <span className={`live-dot ${autoRefresh ? 'is-on' : ''} ${error ? 'is-error' : ''}`} />
            {error && autoRefresh ? '连接中断' : autoRefresh ? '自动刷新' : '已暂停'}
          </button>
          <button
            className="secondary-button"
            data-testid="e2e/settings/logs/refresh#button"
            type="button"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <AppIcon name={refreshing ? 'loader' : 'refresh'} />
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="logs-state-card is-error" role="alert" aria-live="polite">
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
      ) : records.length === 0 && !selected ? (
        <div className="logs-empty">
          <AppIcon name="scroll-text" size={24} />
          <strong>还没有交互记录</strong>
          <span>执行一次模型连接读取或任务提交后即可在这里看到</span>
        </div>
      ) : (
        <div className={`logs-workspace ${selected ? 'has-inspector' : ''}`}>
          <section
            className={`logs-console is-${consoleTheme}`}
            aria-label="交互日志控制台"
          >
            <header className="logs-console-header">
              <div className="logs-console-title">
                <strong>接口事件</strong>
                <span>前端、主进程、模型服务与本机组件的真实调用</span>
              </div>
              <div className="logs-console-actions">
                <span>{records.length} 条记录</span>
                <button
                  className="plain-icon-action logs-theme-toggle"
                  data-testid="e2e/settings/logs/theme#button"
                  type="button"
                  aria-label={consoleTheme === 'light' ? '切换为深色控制台' : '切换为浅色控制台'}
                  aria-pressed={consoleTheme === 'dark'}
                  onClick={() =>
                    setConsoleTheme((current) => (current === 'light' ? 'dark' : 'light'))
                  }
                >
                  <AppIcon name={consoleTheme === 'light' ? 'moon' : 'sun'} />
                </button>
              </div>
            </header>
            {records.length > 0 ? (
              <div className="logs-console-columns" aria-hidden="true">
                <span>时间</span>
                <span>来源</span>
                <span>传输</span>
                <span>操作</span>
                <span className="is-center">耗时</span>
                <span className="is-end">状态</span>
              </div>
            ) : (
              <div className="logs-empty">
                <AppIcon name="scroll-text" size={24} />
                <strong>当前筛选下没有交互记录</strong>
                <span>详情仍保留在右侧，可关闭详情后调整筛选条件</span>
              </div>
            )}
            {visibleRecords.map((record, index) => {
              const key = keyOf(record)
              const recordIndex = (page - 1) * PAGE_SIZE + index
              return (
                <button
                  className="logs-entry"
                  data-testid={e2eId('e2e/settings/logs/entries/:entry-index#button', {
                    'entry-index': String(recordIndex)
                  })}
                  data-level={record.levelLabel}
                  data-selected={selected ? key === keyOf(selected) : false}
                  key={key}
                  type="button"
                  onClick={() => selectRecord(record)}
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
                  <span
                    className="logs-entry-operation"
                    title={record.operation ?? record.msg ?? '—'}
                  >
                    {highlightText(record.operation ?? record.msg ?? '—', search)}
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
            {records.length > 0 ? (
              <footer className="logs-pagination" aria-label="接口日志分页">
                <span>
                  第 {page} / {totalPages} 页 · 共 {records.length} 条
                </span>
                <div>
                  <button
                    className="plain-icon-action"
                    data-testid="e2e/settings/logs/pagination/previous#button"
                    type="button"
                    aria-label="上一页"
                    disabled={page === 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <AppIcon name="chevron-left" />
                  </button>
                  <button
                    className="plain-icon-action"
                    data-testid="e2e/settings/logs/pagination/next#button"
                    type="button"
                    aria-label="下一页"
                    disabled={page === totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  >
                    <AppIcon name="chevron-right" />
                  </button>
                </div>
              </footer>
            ) : null}
          </section>

          {selected ? (
            <InterfaceLogInspector
              record={selected}
              detailState={detailState}
              copyState={copyState}
              onClose={closeDetail}
              onCopy={copySelected}
              onRetry={() => requestDetail(selected)}
              onFilterChain={() => {
                const chainId = chainIdOf(selected)
                if (!chainId) return
                setSearch(chainId)
                setPage(1)
              }}
            />
          ) : null}
        </div>
      )}

      {files.length > 0 ? (
        <footer className="logs-footer" aria-label="日志文件位置">
          <span className="logs-file-location">
            <AppIcon name="folder" />
            <span>日志文件</span>
            <code title={files[0]}>{files[0]}</code>
          </span>
          <span className="logs-tail-command">
            <span>终端查看</span>
            <code>{`tail -f "${files[0]}"`}</code>
          </span>
        </footer>
      ) : null}
    </section>
  )
}

function InterfaceLogInspector({
  record,
  detailState,
  copyState,
  onClose,
  onCopy,
  onRetry,
  onFilterChain
}: {
  record: InteractionLogRecord
  detailState: {
    eventId: string
    state: 'loading' | 'ready' | 'error'
    detail: InteractionLogDetail | null
    error: string | null
  } | null
  copyState: 'idle' | 'copied'
  onClose(): void
  onCopy(): void
  onRetry(): void
  onFilterChain(): void
}) {
  const detail = detailState?.detail
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
            aria-label={copyState === 'copied' ? '已复制' : '复制条目'}
            onClick={onCopy}
          >
            <AppIcon name={copyState === 'copied' ? 'check' : 'copy'} />
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {copyState === 'copied' ? '已复制' : ''}
          </span>
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
          {record.requestBytes !== undefined || record.responseBytes !== undefined
            ? `请求 ${formatBytes(record.requestBytes ?? 0)} · 响应 ${formatBytes(
                record.responseBytes ?? 0
              )}`
            : record.payloadBytes === undefined
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
        {record.taskId ? (
          <InspectorRow label="任务 ID" mono>
            {record.taskId}
          </InspectorRow>
        ) : null}
        {record.requestId ? (
          <InspectorRow label="请求 ID" mono>
            {record.requestId}
          </InspectorRow>
        ) : null}
        {record.correlationId ? (
          <InspectorRow label="关联 ID" mono>
            {record.correlationId}
          </InspectorRow>
        ) : null}
      </div>

      {chainIdOf(record) ? (
        <div className="logs-chain-action">
          <span>查看同一任务或请求的完整调用链</span>
          <button
            className="plain-text-action"
            data-testid="e2e/settings/logs/inspector/chain#button"
            type="button"
            onClick={onFilterChain}
          >
            筛选此链路
          </button>
        </div>
      ) : null}

      {detailState?.state === 'loading' ? (
        <p className="logs-detail-state">正在读取 Request / Response…</p>
      ) : detailState?.state === 'error' ? (
        <div className="logs-detail-state is-error" role="alert">
          <span>{detailState.error ?? '详情读取失败'}</span>
          <button
            className="plain-text-action"
            data-testid="e2e/settings/logs/inspector/retry#button"
            type="button"
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      ) : null}
      <PayloadSection
        label="请求（Request）"
        side="request"
        payload={detail?.request ?? null}
        absentLabel="无请求载荷"
      />
      <PayloadSection
        label="响应（Response）"
        side="response"
        payload={detail?.response ?? null}
        absentLabel={record.state === 'pending' ? '等待响应' : '无响应载荷'}
      />
      <details className="logs-inspector-raw" open>
        <summary data-testid="e2e/settings/logs/raw#button">
          <AppIcon name="chevron-right" />
          原始记录
        </summary>
        <pre>{JSON.stringify(detail ?? record, null, 2)}</pre>
      </details>
    </aside>
  )
}

function PayloadSection({
  label,
  side,
  payload,
  absentLabel
}: {
  label: string
  side: 'request' | 'response'
  payload: InteractionPayloadView | null
  absentLabel: string
}) {
  const unavailable = payloadUnavailableLabel(payload)
  return (
    <details className="logs-inspector-raw">
      <summary data-testid={e2eId('e2e/settings/logs/inspector/:side#button', { side })}>
        <AppIcon name="chevron-right" />
        {label}
        {payload?.truncated ? <span className="logs-payload-badge">已截断</span> : null}
      </summary>
      {!payload ? (
        <p>{absentLabel}</p>
      ) : unavailable ? (
        <p>{unavailable}</p>
      ) : payload.kind === 'binary-metadata' ? (
        <p>二进制载荷，仅保存元数据 · {formatBytes(payload.byteLength)}</p>
      ) : payload.text === null ? (
        <p>无可显示正文</p>
      ) : (
        <div className="logs-payload-body">
          <button
            className="plain-text-action"
            data-testid={e2eId('e2e/settings/logs/inspector/:side/copy#button', { side })}
            type="button"
            onClick={() => void globalThis.navigator?.clipboard?.writeText(payload.text ?? '')}
          >
            复制正文
          </button>
          <pre className={payload.kind === 'text' ? 'is-text' : ''}>{payload.text}</pre>
        </div>
      )}
    </details>
  )
}

function payloadUnavailableLabel(payload: InteractionPayloadView | null): string | null {
  if (payload?.unavailableReason === 'expired') return '载荷已过期'
  if (payload?.unavailableReason === 'missing') return '载荷不可用'
  if (payload?.unavailableReason === 'unsafe-to-persist') return '载荷因凭据边界未安全保存'
  return null
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
  if (record.state === 'incomplete') return 'failure'
  if (record.state === 'pending') return 'warning'
  if (record.kind === 'one-way-event') return 'success'
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
  if (record.state === 'pending') return '进行中'
  if (record.state === 'incomplete') return '未完成'
  if (record.kind === 'one-way-event') return '单向事件'
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

function transportLabel(transports: InteractionTransport[]): string {
  if (transports.length === 0) return '全部传输'
  if (transports.length === 1) {
    return TRANSPORTS.find((transport) => transport.id === transports[0])?.label ?? '全部传输'
  }
  return `已选 ${transports.length} 项`
}

function keyOf(record: InteractionLogRecord): string {
  return record.id ?? `${record.time}-${record.operation ?? record.msg ?? 'entry'}`
}

function chainIdOf(record: InteractionLogRecord): string | null {
  return record.taskId ?? record.requestId ?? record.correlationId ?? null
}

function readConsoleTheme(): ConsoleTheme {
  try {
    return globalThis.localStorage?.getItem(CONSOLE_THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function highlightText(text: string, query: string): React.ReactNode {
  const needle = query.trim()
  if (!needle) return text
  const lowerText = text.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0
  let match = lowerText.indexOf(lowerNeedle)
  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match))
    parts.push(<mark key={`${match}-${parts.length}`}>{text.slice(match, match + needle.length)}</mark>)
    cursor = match + needle.length
    match = lowerText.indexOf(lowerNeedle, cursor)
  }
  if (parts.length === 0) return text
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
